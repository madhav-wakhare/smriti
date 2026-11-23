"""Trash: soft-deleted projects, tasks, sources, captures and revisits."""

import sqlite3
from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, Response

from .. import clock, db, models
from ..config import Config
from ..deps import Cfg, Conn
from ..errors import conflict, not_found

router = APIRouter(prefix="/api/trash", tags=["trash"])

Kind = Literal["project", "task", "source", "capture", "revisit"]
TABLES = {"project": ("projects", "name"), "task": ("tasks", "title"), "source": ("sources", "title"),
          "capture": ("captures", "text"), "revisit": ("revisits", "title")}


def purge_on(deleted_at: str, cfg: Config) -> str:
    return (clock.local_date(deleted_at, cfg.zone) + timedelta(days=cfg.trash_days)).isoformat()


def trashed(conn: sqlite3.Connection, kind: str, item_id: int) -> dict:
    table, _ = TABLES[kind]
    row = db.one(conn, f"SELECT * FROM {table} WHERE id = ? AND deleted_at IS NOT NULL", (item_id,))
    if not row:
        raise not_found(f"{kind.capitalize()} in the trash")
    return row


def deleted_with(conn: sqlite3.Connection, task_id: int, deleted_at: str) -> list[int]:
    """The children (and theirs) that went to the trash together with this task."""
    return [i for i in models.descendant_ids(conn, task_id, live_only=False)
            if db.scalar(conn, "SELECT deleted_at FROM tasks WHERE id = ?", (i,)) == deleted_at]


def purge(conn: sqlite3.Connection, kind: str, item_id: int) -> None:
    """Delete for good. A project takes all its tasks with it; a task, the children deleted with it."""
    table, _ = TABLES[kind]
    if kind == "project":
        conn.execute("DELETE FROM tasks WHERE project_id = ?", (item_id,))
    if kind == "task":
        stamp = db.scalar(conn, "SELECT deleted_at FROM tasks WHERE id = ?", (item_id,))
        for child in deleted_with(conn, item_id, stamp) if stamp else []:
            conn.execute("DELETE FROM tasks WHERE id = ?", (child,))
    conn.execute(f"DELETE FROM {table} WHERE id = ?", (item_id,))


def purge_expired(conn: sqlite3.Connection, cfg: Config) -> int:
    """Remove everything deleted more than SMRITI_TRASH_DAYS ago. Returns how many rows went."""
    cutoff = clock.to_iso(clock.parse(clock.now()) - timedelta(days=cfg.trash_days))
    removed = 0
    for kind, (table, _) in TABLES.items():
        for row in db.all_rows(conn, f"SELECT id FROM {table} WHERE deleted_at IS NOT NULL AND deleted_at < ?",
                               (cutoff,)):
            purge(conn, kind, row["id"])
            removed += 1
    return removed


@router.get("")
def list_trash(conn: Conn, cfg: Cfg):
    items = []
    for kind, (table, title) in TABLES.items():
        where = "x.deleted_at IS NOT NULL"
        if kind == "task":  # tasks deleted with their project, or with their parent, come back with it
            where += (" AND x.project_id NOT IN (SELECT id FROM projects WHERE deleted_at IS NOT NULL)"
                      " AND NOT EXISTS (SELECT 1 FROM tasks pt WHERE pt.id = x.parent_id AND pt.deleted_at = x.deleted_at)")
        for row in db.all_rows(conn, f"SELECT x.id, x.{title} AS title, x.deleted_at FROM {table} x WHERE {where}"):
            items.append({"kind": kind, **row, "purge_on": purge_on(row["deleted_at"], cfg)})
    return sorted(items, key=lambda i: i["deleted_at"], reverse=True)


@router.post("/{kind}/{item_id}/restore")
def restore(kind: Kind, item_id: int, conn: Conn):
    row = trashed(conn, kind, item_id)
    table, _ = TABLES[kind]
    if kind == "task" and db.scalar(conn, "SELECT deleted_at FROM projects WHERE id = ?", (row["project_id"],)):
        raise conflict("Its project is in the trash; restore the project")
    if kind == "task" and row["parent_id"] and db.scalar(
            conn, "SELECT deleted_at FROM tasks WHERE id = ?", (row["parent_id"],)) == row["deleted_at"]:
        raise conflict("It was deleted together with its parent; restore the parent")
    if kind == "task":
        for child in deleted_with(conn, item_id, row["deleted_at"]):
            conn.execute("UPDATE tasks SET deleted_at = NULL WHERE id = ?", (child,))
    if kind == "project":
        conn.execute("UPDATE tasks SET deleted_at = NULL WHERE project_id = ? AND deleted_at = ?",
                     (item_id, row["deleted_at"]))
    conn.execute(f"UPDATE {table} SET deleted_at = NULL WHERE id = ?", (item_id,))
    return {"kind": kind, "id": item_id, "restored": True}


@router.delete("/{kind}/{item_id}", status_code=204)
def delete_for_good(kind: Kind, item_id: int, conn: Conn):
    trashed(conn, kind, item_id)
    purge(conn, kind, item_id)
    return Response(status_code=204)
