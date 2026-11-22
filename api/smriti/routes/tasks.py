"""Tasks, their checklist lines, board moves and repeats."""

import calendar
import sqlite3
from datetime import date, timedelta
from typing import Literal

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field

from .. import clock, db, models
from ..config import Config
from ..deps import Cfg, Conn
from ..errors import invalid, not_found

router = APIRouter(prefix="/api", tags=["tasks"])

Status = Literal["todo", "doing", "done"]
Repeat = Literal["none", "daily", "weekdays", "weekly", "monthly"]
STEP = 1000.0  # gap between positions in a fresh column
EVENT_FIELDS = ("status", "priority", "planned_on", "due_on", "title")


class TaskIn(BaseModel):
    project_id: int
    title: str = Field(min_length=1, max_length=500)
    body: str = ""
    status: Status = "todo"
    priority: int = Field(default=0, ge=0, le=4)
    planned_on: date | None = None
    due_on: date | None = None
    estimate_min: int | None = Field(default=None, ge=0)
    repeat: Repeat = "none"
    tags: list[str] = []
    url: str | None = None
    parent_id: int | None = None


class TaskPatch(BaseModel):
    project_id: int | None = None
    title: str | None = Field(default=None, min_length=1, max_length=500)
    body: str | None = None
    status: Status | None = None
    priority: int | None = Field(default=None, ge=0, le=4)
    planned_on: date | None = None
    due_on: date | None = None
    estimate_min: int | None = Field(default=None, ge=0)
    repeat: Repeat | None = None
    tags: list[str] | None = None
    url: str | None = None
    parent_id: int | None = None
    position: float | None = None


class MoveIn(BaseModel):
    status: Status
    before_id: int | None = None
    after_id: int | None = None


class CheckIn(BaseModel):
    title: str = Field(min_length=1, max_length=500)


class CheckPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    done: bool | None = None
    position: float | None = None


# ---------------------------------------------------------------- helpers


def _iso(value) -> str | None:
    return value.isoformat() if isinstance(value, date) else value


def _url(value: str | None) -> str | None:
    return (value or "").strip() or None


def live_project(conn: sqlite3.Connection, project_id: int) -> dict:
    row = db.one(conn, "SELECT * FROM projects WHERE id = ? AND deleted_at IS NULL", (project_id,))
    if not row:
        raise invalid("Project not found")
    return row


def take_number(conn: sqlite3.Connection, project_id: int) -> int:
    number = db.scalar(conn, "SELECT next_number FROM projects WHERE id = ?", (project_id,))
    conn.execute("UPDATE projects SET next_number = next_number + 1 WHERE id = ?", (project_id,))
    return number


def end_position(conn: sqlite3.Connection, status: str) -> float:
    top = db.scalar(conn, "SELECT max(position) FROM tasks WHERE status = ? AND deleted_at IS NULL", (status,))
    return (top or 0) + STEP


def check_parent(conn: sqlite3.Connection, task_id: int | None, parent_id: int) -> None:
    """The parent must be a live task, and not the task itself or one of its descendants."""
    seen = set()
    current = parent_id
    while current is not None:
        if current == task_id:
            raise invalid("A task cannot be its own parent or the parent of its parent")
        if current in seen:
            break
        seen.add(current)
        row = db.one(conn, "SELECT parent_id, deleted_at FROM tasks WHERE id = ?", (current,))
        if not row or (current == parent_id and row["deleted_at"]):
            raise invalid("Parent task not found")
        current = row["parent_id"]


def next_date(base: date, repeat: str) -> date:
    if repeat == "daily":
        return base + timedelta(days=1)
    if repeat == "weekdays":
        d = base + timedelta(days=1)
        while d.weekday() >= 5:
            d += timedelta(days=1)
        return d
    if repeat == "weekly":
        return base + timedelta(weeks=1)
    y, m = (base.year + 1, 1) if base.month == 12 else (base.year, base.month + 1)
    return date(y, m, min(base.day, calendar.monthrange(y, m)[1]))


def insert_task(conn: sqlite3.Connection, values: dict) -> int:
    """Insert a task in a live project with the next number; values use stored column names."""
    live_project(conn, values["project_id"])
    if values.get("parent_id") is not None:
        check_parent(conn, None, values["parent_id"])
    ts = clock.now()
    status = values.get("status", "todo")
    row = {
        "number": take_number(conn, values["project_id"]),
        "status": status,
        "position": end_position(conn, status),
        "created_at": ts, "updated_at": ts, "status_at": ts,
        "done_at": ts if status == "done" else None,
        **values,
    }
    row["tags"] = db.tags_in(row.get("tags"))
    task_id = db.insert(conn, "tasks", row)
    models.log_event(conn, "task_id", task_id, "created", None, row["title"])
    return task_id


def spawn_repeat(conn: sqlite3.Connection, task: dict, cfg: Config) -> int | None:
    """The next copy of a repeating task that was just done. The repeat moves onto the copy,
    so marking the old task done again never makes a second copy."""
    if task["repeat"] == "none":
        return None
    today = clock.today(cfg.zone)
    base = date.fromisoformat(task["planned_on"]) if task["planned_on"] else today
    planned = next_date(base, task["repeat"])
    while planned <= today:
        planned = next_date(planned, task["repeat"])
    due = None
    if task["due_on"]:
        due = (date.fromisoformat(task["due_on"]) + (planned - base)).isoformat()
    new_id = insert_task(conn, {
        "project_id": task["project_id"], "parent_id": task["parent_id"], "title": task["title"],
        "body": task["body"], "priority": task["priority"], "planned_on": planned.isoformat(), "due_on": due,
        "estimate_min": task["estimate_min"], "repeat": task["repeat"], "tags": db.tags_out(task["tags"]),
        "url": task["url"],
    })
    conn.execute("INSERT INTO checks (task_id, title, position) SELECT ?, title, position FROM checks "
                 "WHERE task_id = ?", (new_id, task["id"]))
    conn.execute("UPDATE tasks SET repeat = 'none' WHERE id = ?", (task["id"],))
    return new_id


def status_values(new_status: str, ts: str) -> dict:
    return {"status": new_status, "status_at": ts, "done_at": ts if new_status == "done" else None}


def apply_changes(conn: sqlite3.Connection, task_id: int, changes: dict, cfg: Config) -> None:
    """Write changed fields, log events, and run the done/repeat rules."""
    old = models.task_row(conn, task_id)
    ts = clock.now()
    values: dict = {}
    for field, value in changes.items():
        if field == "tags":
            value = db.tags_in(value)
        elif field == "url":
            value = _url(value)
        elif field == "title":
            value = value.strip()
        else:
            value = _iso(value)
        if old[field] == value:
            continue
        values[field] = value
        if field in EVENT_FIELDS:
            models.log_event(conn, "task_id", task_id, field, old[field], value)

    if values.get("parent_id") is not None:
        check_parent(conn, task_id, values["parent_id"])
    if "project_id" in values:
        live_project(conn, values["project_id"])
        values["number"] = take_number(conn, values["project_id"])
        models.log_event(conn, "task_id", task_id, "project",
                         db.scalar(conn, "SELECT key FROM projects WHERE id = ?", (old["project_id"],)),
                         db.scalar(conn, "SELECT key FROM projects WHERE id = ?", (values["project_id"],)))
    if "status" in values:
        values.update(status_values(values["status"], ts))
    if not values:
        return
    values["updated_at"] = ts
    db.update(conn, "tasks", task_id, values)
    if values.get("status") == "done":
        spawn_repeat(conn, models.task_row(conn, task_id), cfg)


def renumber(conn: sqlite3.Connection, status: str) -> None:
    ids = [r["id"] for r in db.all_rows(
        conn, "SELECT id FROM tasks WHERE status = ? AND deleted_at IS NULL ORDER BY position, id", (status,))]
    for n, row_id in enumerate(ids, start=1):
        conn.execute("UPDATE tasks SET position = ? WHERE id = ?", (n * STEP, row_id))


def position_near(conn: sqlite3.Connection, task_id: int, status: str, before_id: int | None,
                  after_id: int | None) -> float | None:
    """A position just before `before_id` or just after `after_id`, among live tasks in `status`.
    None means the gap is too small and the column needs renumbering first."""
    anchor_id = before_id if before_id is not None else after_id
    anchor = db.one(conn, "SELECT id, position FROM tasks WHERE id = ? AND deleted_at IS NULL", (anchor_id,))
    if not anchor or anchor["id"] == task_id:
        raise invalid("Neighbour task not found")
    if before_id is not None:
        other = db.scalar(conn, """SELECT max(position) FROM tasks WHERE status = ? AND deleted_at IS NULL
                                   AND id != ? AND position < ?""", (status, task_id, anchor["position"]))
        new = anchor["position"] - STEP if other is None else (other + anchor["position"]) / 2
    else:
        other = db.scalar(conn, """SELECT min(position) FROM tasks WHERE status = ? AND deleted_at IS NULL
                                   AND id != ? AND position > ?""", (status, task_id, anchor["position"]))
        new = anchor["position"] + STEP if other is None else (other + anchor["position"]) / 2
    if other is not None and abs(other - anchor["position"]) < 1e-6:
        return None
    return new


# ---------------------------------------------------------------- task routes


@router.get("/tasks")
def list_tasks(
    conn: Conn,
    cfg: Cfg,
    status: Status | None = None,
    project_id: int | None = None,
    planned_on: date | None = None,
    parent_id: int | None = None,
    tag: str | None = None,
    q: str | None = None,
    include_done_days: int = Query(default=14, ge=0),
):
    where, args = [], []
    if status:
        where.append("t.status = ?")
        args.append(status)
    if project_id is not None:
        where.append("t.project_id = ?")
        args.append(project_id)
    if planned_on:
        where.append("t.planned_on = ?")
        args.append(planned_on.isoformat())
    if parent_id is not None:
        where.append("t.parent_id = ?")
        args.append(parent_id)
    if tag:
        where.append("EXISTS (SELECT 1 FROM json_each(t.tags) WHERE value = ?)")
        args.append(tag.strip().lower())
    if q and q.strip():
        where.append("(t.title LIKE ? OR t.body LIKE ? OR (p.key || '-' || t.number) = ?)")
        args += [f"%{q.strip()}%", f"%{q.strip()}%", q.strip().upper()]
    cutoff = clock.day_start(clock.today(cfg.zone) - timedelta(days=include_done_days), cfg.zone)
    where.append("(t.status != 'done' OR t.done_at >= ?)")
    args.append(cutoff)
    return models.tasks(conn, " AND ".join(where), tuple(args))


@router.post("/tasks", status_code=201)
def create_task(data: TaskIn, conn: Conn):
    values = data.model_dump()
    values["title"] = values["title"].strip()
    values["url"] = _url(values["url"])
    values["planned_on"] = _iso(values["planned_on"])
    values["due_on"] = _iso(values["due_on"])
    return models.task(conn, insert_task(conn, values))


@router.get("/tasks/{task_id}")
def get_task(task_id: int, conn: Conn):
    task = models.task(conn, task_id)
    task["checks"] = checks_of(conn, task_id)
    task["notes"] = models.notes(conn, "task_id", task_id)
    task["sessions"] = models.sessions(conn, "x.task_id = ?", (task_id,))
    task["events"] = models.events(conn, "task_id", task_id)
    task["subtasks"] = models.tasks(conn, "t.parent_id = ?", (task_id,))
    return task


@router.patch("/tasks/{task_id}")
def update_task(task_id: int, data: TaskPatch, conn: Conn, cfg: Cfg):
    changes = data.model_dump(exclude_unset=True)
    for field in ("project_id", "title", "body", "status", "priority", "repeat", "tags", "position"):
        if field in changes and changes[field] is None:
            raise invalid(f"{field} cannot be null")
    apply_changes(conn, task_id, changes, cfg)
    return models.task(conn, task_id)


@router.post("/tasks/{task_id}/move")
def move_task(task_id: int, data: MoveIn, conn: Conn, cfg: Cfg):
    """Set the status and place the task before `before_id` or after `after_id` (else at the end)."""
    models.task_row(conn, task_id)
    if data.before_id is not None and data.after_id is not None:
        raise invalid("Give before_id or after_id, not both")
    if data.before_id is None and data.after_id is None:
        position = end_position(conn, data.status)
    else:
        position = position_near(conn, task_id, data.status, data.before_id, data.after_id)
        if position is None:
            renumber(conn, data.status)
            position = position_near(conn, task_id, data.status, data.before_id, data.after_id)
    apply_changes(conn, task_id, {"status": data.status, "position": position}, cfg)
    return models.task(conn, task_id)


@router.delete("/tasks/{task_id}", status_code=204)
def delete_task(task_id: int, conn: Conn):
    models.task_row(conn, task_id)
    models.stop_running_on(conn, "task_id", [task_id])
    conn.execute("UPDATE tasks SET deleted_at = ? WHERE id = ?", (clock.now(), task_id))
    return Response(status_code=204)


# ---------------------------------------------------------------- checks


def check_out(row: dict) -> dict:
    return {**row, "done": bool(row["done"])}


def checks_of(conn: sqlite3.Connection, task_id: int) -> list[dict]:
    return [check_out(r) for r in db.all_rows(
        conn, "SELECT * FROM checks WHERE task_id = ? ORDER BY position, id", (task_id,))]


def load_check(conn: sqlite3.Connection, check_id: int) -> dict:
    row = db.one(conn, """SELECT c.* FROM checks c JOIN tasks t ON t.id = c.task_id
                          WHERE c.id = ? AND t.deleted_at IS NULL""", (check_id,))
    if not row:
        raise not_found("Check")
    return row


def touch(conn: sqlite3.Connection, task_id: int) -> None:
    conn.execute("UPDATE tasks SET updated_at = ? WHERE id = ?", (clock.now(), task_id))


@router.post("/tasks/{task_id}/checks", status_code=201)
def add_check(task_id: int, data: CheckIn, conn: Conn):
    models.task_row(conn, task_id)
    position = (db.scalar(conn, "SELECT max(position) FROM checks WHERE task_id = ?", (task_id,)) or 0) + 1
    check_id = db.insert(conn, "checks", {"task_id": task_id, "title": data.title.strip(), "position": position})
    touch(conn, task_id)
    return check_out(load_check(conn, check_id))


@router.patch("/checks/{check_id}")
def update_check(check_id: int, data: CheckPatch, conn: Conn):
    check = load_check(conn, check_id)
    values = data.model_dump(exclude_unset=True, exclude_none=True)
    if "title" in values:
        values["title"] = values["title"].strip()
    if "done" in values:
        values["done"] = int(values["done"])
    db.update(conn, "checks", check_id, values)
    touch(conn, check["task_id"])
    return check_out(load_check(conn, check_id))


@router.delete("/checks/{check_id}", status_code=204)
def delete_check(check_id: int, conn: Conn):
    check = load_check(conn, check_id)
    conn.execute("DELETE FROM checks WHERE id = ?", (check_id,))
    touch(conn, check["task_id"])
    return Response(status_code=204)
