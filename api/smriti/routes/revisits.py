"""Revisits: questions or ideas to recall, reviewed again and again."""

import sqlite3
from typing import Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from .. import clock, db, models
from ..deps import Conn
from ..errors import invalid

router = APIRouter(prefix="/api/revisits", tags=["revisits"])


class RevisitIn(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    prompt: str = ""
    body: str = ""
    url: str | None = None
    priority: int = Field(default=0, ge=0, le=4)
    task_id: int | None = None
    source_id: int | None = None


class RevisitPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=500)
    prompt: str | None = None
    body: str | None = None
    url: str | None = None
    priority: int | None = Field(default=None, ge=0, le=4)
    status: Literal["active", "retired"] | None = None
    task_id: int | None = None
    source_id: int | None = None


def check_links(conn: sqlite3.Connection, values: dict) -> None:
    if values.get("task_id") is not None:
        models.task_row(conn, values["task_id"])
    if values.get("source_id") is not None:
        models.source(conn, values["source_id"])


def insert_revisit(conn: sqlite3.Connection, values: dict) -> int:
    check_links(conn, values)
    ts = clock.now()
    row = {**values, "created_at": ts, "updated_at": ts}
    row["title"] = row["title"].strip()
    row["url"] = (row.get("url") or "").strip() or None
    return db.insert(conn, "revisits", row)


@router.get("")
def list_revisits(conn: Conn, status: Literal["active", "retired", "all"] = "active"):
    if status == "all":
        return models.revisits(conn)
    return models.revisits(conn, "c.status = ?", (status,))


@router.post("", status_code=201)
def create_revisit(data: RevisitIn, conn: Conn):
    return models.revisit(conn, insert_revisit(conn, data.model_dump()))


@router.get("/{revisit_id}")
def get_revisit(revisit_id: int, conn: Conn):
    out = models.revisit(conn, revisit_id)
    out["sessions"] = models.sessions(conn, "x.revisit_id = ?", (revisit_id,))
    return out


@router.patch("/{revisit_id}")
def update_revisit(revisit_id: int, data: RevisitPatch, conn: Conn):
    old = models.revisit(conn, revisit_id)
    values = data.model_dump(exclude_unset=True)
    for field in ("title", "prompt", "body", "priority", "status"):
        if field in values and values[field] is None:
            raise invalid(f"{field} cannot be null")
    check_links(conn, values)
    if "title" in values:
        values["title"] = values["title"].strip()
    if "url" in values:
        values["url"] = (values["url"] or "").strip() or None
    ts = clock.now()
    if values.get("status") and values["status"] != old["status"]:
        values["retired_at"] = ts if values["status"] == "retired" else None
    if values:
        values["updated_at"] = ts
        db.update(conn, "revisits", revisit_id, values)
    return models.revisit(conn, revisit_id)


@router.post("/{revisit_id}/reviewed")
def mark_reviewed(revisit_id: int, conn: Conn):
    """You looked at it again today: set reviewed_at to now, without logging time."""
    models.revisit(conn, revisit_id)
    ts = clock.now()
    conn.execute("UPDATE revisits SET reviewed_at = ?, updated_at = ? WHERE id = ?", (ts, ts, revisit_id))
    return models.revisit(conn, revisit_id)


@router.delete("/{revisit_id}", status_code=204)
def delete_revisit(revisit_id: int, conn: Conn):
    models.revisit(conn, revisit_id)
    models.stop_running_on(conn, "revisit_id", [revisit_id])
    conn.execute("UPDATE revisits SET deleted_at = ? WHERE id = ?", (clock.now(), revisit_id))
    return Response(status_code=204)
