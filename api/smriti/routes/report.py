"""The weekly report: where the time went, what got done, what carries over."""

import sqlite3
from datetime import date, timedelta

from fastapi import APIRouter

from .. import clock, db, models
from ..deps import Cfg, Conn

router = APIRouter(prefix="/api/report", tags=["report"])

LOGGED_SQL = """
SELECT x.started_at, x.minutes, x.task_id, x.source_id, x.revisit_id, p.key AS project_key, p.name AS project_name
FROM sessions x
LEFT JOIN tasks t ON t.id = x.task_id
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN sources s ON s.id = x.source_id
LEFT JOIN revisits c ON c.id = x.revisit_id
WHERE x.ended_at IS NOT NULL AND x.started_at >= ? AND x.started_at < ?
  AND t.deleted_at IS NULL AND s.deleted_at IS NULL AND c.deleted_at IS NULL
"""


def logged(conn: sqlite3.Connection, start: str, end: str) -> list[dict]:
    """Ended sessions on live subjects that started in [start, end) (UTC stamps)."""
    return db.all_rows(conn, LOGGED_SQL, (start, end))


def kind_of(row: dict) -> str:
    return "task" if row["task_id"] is not None else "source" if row["source_id"] is not None else "revisit"


def totals(rows: list[dict]) -> tuple[int, int]:
    """(all minutes, learning minutes = sources + revisits)."""
    total = sum(r["minutes"] for r in rows)
    learning = sum(r["minutes"] for r in rows if kind_of(r) != "task")
    return total, learning


def done_count(conn: sqlite3.Connection, start: str, end: str) -> int:
    return db.scalar(conn, """SELECT count(*) FROM tasks WHERE deleted_at IS NULL AND status = 'done'
                              AND done_at >= ? AND done_at < ?""", (start, end))


def per_day(rows: list[dict], first: date, zone) -> list[dict]:
    days = {(first + timedelta(days=n)).isoformat(): {"date": (first + timedelta(days=n)).isoformat(),
                                                      "task_min": 0, "source_min": 0, "revisit_min": 0}
            for n in range(7)}
    for r in rows:
        bucket = days.get(clock.local_date(r["started_at"], zone).isoformat())
        if bucket:
            bucket[f"{kind_of(r)}_min"] += r["minutes"]
    return list(days.values())


def per_project(rows: list[dict]) -> list[dict]:
    found: dict[str, dict] = {}
    for r in rows:
        if r["task_id"] is None:
            continue
        entry = found.setdefault(r["project_key"], {"project_key": r["project_key"], "name": r["project_name"],
                                                    "minutes": 0})
        entry["minutes"] += r["minutes"]
    return sorted(found.values(), key=lambda e: (-e["minutes"], e["project_key"]))


@router.get("/week")
def week(conn: Conn, cfg: Cfg, start: date | None = None):
    """The week from Monday `start` (any date snaps back to its Monday; default this week)."""
    first = clock.monday_of(start or clock.today(cfg.zone))
    last = first + timedelta(days=6)
    lo, hi = clock.bounds(first, last, cfg.zone)
    rows = logged(conn, lo, hi)
    logged_min, learning_min = totals(rows)
    done = models.tasks(conn, "t.status = 'done' AND t.done_at >= ? AND t.done_at < ?", (lo, hi), "t.done_at, t.id")
    carried = models.tasks(
        conn, "t.status != 'done' AND (t.status = 'doing' OR t.planned_on <= ? OR t.due_on <= ?)",
        (last.isoformat(), last.isoformat()), "t.status = 'doing' DESC, t.priority DESC, t.planned_on, t.id")
    sources_done = models.sources(conn, "s.status = 'done' AND s.done_at >= ? AND s.done_at < ?", (lo, hi),
                                  "s.done_at, s.id")
    days_reviewed = db.all_rows(conn, """SELECT * FROM days WHERE date BETWEEN ? AND ?
                                         AND (went_well != '' OR blockers != '' OR tomorrow != '') ORDER BY date""",
                                (first.isoformat(), last.isoformat()))
    captures = db.scalar(conn, "SELECT count(*) FROM captures WHERE deleted_at IS NULL AND created_at >= ? "
                               "AND created_at < ?", (lo, hi))
    return {
        "start": first.isoformat(),
        "end": last.isoformat(),
        "days": per_day(rows, first, cfg.zone),
        "by_project": per_project(rows),
        "done": done,
        "carried": carried,
        "sources_done": sources_done,
        "days_reviewed": days_reviewed,
        "totals": {"done": len(done), "logged_min": logged_min, "learning_min": learning_min, "captures": captures},
    }
