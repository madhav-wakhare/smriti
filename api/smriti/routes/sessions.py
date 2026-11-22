"""Sessions: time spent on one task, source or revisit. A session with no end is still running."""

import sqlite3
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Query, Response
from pydantic import BaseModel, Field

from .. import clock, db, models
from ..deps import Cfg, Conn
from ..errors import invalid

router = APIRouter(prefix="/api/sessions", tags=["sessions"])


class Subject(BaseModel):
    task_id: int | None = None
    source_id: int | None = None
    revisit_id: int | None = None


class StopIn(BaseModel):
    note: str | None = None


class LogIn(Subject):
    started_at: datetime
    minutes: int = Field(ge=1, le=24 * 60)
    note: str = ""


class SessionPatch(BaseModel):
    minutes: int | None = Field(default=None, ge=1, le=24 * 60)
    note: str | None = None
    started_at: datetime | None = None


def subject_of(conn: sqlite3.Connection, data: Subject) -> tuple[str, int]:
    """The one subject column and id given; the subject must be live."""
    given = [(col, val) for col, val in (("task_id", data.task_id), ("source_id", data.source_id),
                                         ("revisit_id", data.revisit_id)) if val is not None]
    if len(given) != 1:
        raise invalid("Give exactly one of task_id, source_id or revisit_id")
    column, subject_id = given[0]
    if column == "task_id":
        models.task_row(conn, subject_id)
    elif column == "source_id":
        models.source(conn, subject_id)
    else:
        models.revisit(conn, subject_id)
    return column, subject_id


def mark_reviewed(conn: sqlite3.Connection, revisit_id: int | None, at: str) -> None:
    if revisit_id is not None:
        conn.execute("UPDATE revisits SET reviewed_at = ? WHERE id = ? AND (reviewed_at IS NULL OR reviewed_at < ?)",
                     (at, revisit_id, at))


@router.get("")
def list_sessions(conn: Conn, cfg: Cfg, from_: date | None = Query(default=None, alias="from"),
                  to: date | None = None):
    """Sessions that started between the local dates `from` and `to` (default: the last 7 days)."""
    last = to or clock.today(cfg.zone)
    first = from_ or last - timedelta(days=6)
    if first > last:
        raise invalid("from is after to")
    start, end = clock.bounds(first, last, cfg.zone)
    return models.sessions(conn, "x.started_at >= ? AND x.started_at < ?", (start, end))


@router.get("/running")
def running_session(conn: Conn):
    return models.running(conn)


@router.post("/start")
def start_session(data: Subject, conn: Conn):
    """Stop the running session (if it is on something else) and start a new one."""
    column, subject_id = subject_of(conn, data)
    run = db.one(conn, "SELECT * FROM sessions WHERE ended_at IS NULL")
    if run and run[column] == subject_id:
        return models.session(conn, run["id"])
    if run:
        models.end_session(conn, run)
    ts = clock.now()
    session_id = db.insert(conn, "sessions", {column: subject_id, "started_at": ts, "created_at": ts})
    return models.session(conn, session_id)


@router.post("/stop")
def stop_session(conn: Conn, data: StopIn | None = None):
    run = db.one(conn, "SELECT * FROM sessions WHERE ended_at IS NULL")
    if not run:
        return None
    models.end_session(conn, run, (data.note or "").strip() if data else None)
    return models.session(conn, run["id"])


@router.post("", status_code=201)
def log_session(data: LogIn, conn: Conn, cfg: Cfg):
    """Log time by hand: an ended session."""
    column, subject_id = subject_of(conn, data)
    started = clock.from_user(data.started_at, cfg.zone)
    ended = clock.add_minutes(started, data.minutes)
    session_id = db.insert(conn, "sessions", {
        column: subject_id, "started_at": started, "ended_at": ended, "minutes": data.minutes,
        "note": data.note.strip(), "created_at": clock.now()})
    mark_reviewed(conn, data.revisit_id, ended)
    return models.session(conn, session_id)


@router.patch("/{session_id}")
def update_session(session_id: int, data: SessionPatch, conn: Conn, cfg: Cfg):
    row = db.one(conn, "SELECT * FROM sessions WHERE id = ?", (session_id,))
    if not row:
        models.session(conn, session_id)  # raises 404
    values: dict = {}
    if data.note is not None:
        values["note"] = data.note.strip()
    started = clock.from_user(data.started_at, cfg.zone) if data.started_at else row["started_at"]
    if row["ended_at"] is None:
        if data.minutes is not None:
            raise invalid("A running session has no minutes yet; stop it first")
        if data.started_at and started > clock.now():
            raise invalid("started_at is in the future")
        values["started_at"] = started
    else:
        minutes = data.minutes or row["minutes"]
        values.update(started_at=started, minutes=minutes, ended_at=clock.add_minutes(started, minutes))
    db.update(conn, "sessions", session_id, values)
    return models.session(conn, session_id)


@router.delete("/{session_id}", status_code=204)
def delete_session(session_id: int, conn: Conn):
    models.session(conn, session_id)
    conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
    return Response(status_code=204)
