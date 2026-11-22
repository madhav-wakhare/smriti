"""Today: the one-screen summary of the day."""

from datetime import timedelta

from fastapi import APIRouter

from .. import clock, db, models
from ..deps import Cfg, Conn
from .report import done_count, logged, totals

router = APIRouter(prefix="/api", tags=["today"])

BOARD_ORDER = ("CASE t.status WHEN 'doing' THEN 0 WHEN 'todo' THEN 1 ELSE 2 END, t.priority DESC, "
               "t.position, t.id")


def _count(conn, where: str, args: tuple = ()) -> int:
    return db.scalar(conn, f"SELECT count(*) FROM tasks WHERE deleted_at IS NULL AND {where}", args)


@router.get("/today")
def today(conn: Conn, cfg: Cfg):
    day = clock.today(cfg.zone)
    iso = day.isoformat()
    day_lo, day_hi = clock.bounds(day, day, cfg.zone)
    week_lo, week_hi = clock.bounds(clock.monday_of(day), clock.monday_of(day) + timedelta(days=6), cfg.zone)

    # Planned for today, or planned earlier and still open (it rolls over); done today stays visible.
    planned = models.tasks(conn, "t.planned_on <= ? AND (t.status != 'done' OR t.done_at >= ?)",
                           (iso, day_lo), BOARD_ORDER)
    overdue = models.tasks(conn, "t.status != 'done' AND t.due_on < ?", (iso,), "t.due_on, t.priority DESC, t.id")
    doing = models.tasks(conn, "t.status = 'doing'", (), "t.priority DESC, t.position, t.id")
    waiting = models.tasks(conn, "t.status != 'done'", (), "t.status_at, t.id", limit=5)
    revisits_due = models.revisits(conn, "c.status = 'active'", (), "c.reviewed_at IS NOT NULL, c.reviewed_at, c.id",
                             limit=5)
    week_minutes, week_learning = totals(logged(conn, week_lo, week_hi))
    today_minutes, _ = totals(logged(conn, day_lo, day_hi))
    return {
        "date": iso,
        "planned": planned,
        "overdue": overdue,
        "doing": doing,
        "running": models.running(conn),
        "open_captures": db.scalar(conn, "SELECT count(*) FROM captures WHERE deleted_at IS NULL "
                                         "AND status = 'open'"),
        "revisits_due": revisits_due,
        "waiting": waiting,
        "counts": {
            "open": _count(conn, "status != 'done'"),
            "doing": _count(conn, "status = 'doing'"),
            "overdue": _count(conn, "status != 'done' AND due_on < ?", (iso,)),
            "logged_today_min": today_minutes,
        },
        "week": {"done": done_count(conn, week_lo, week_hi), "logged_min": week_minutes,
                 "learning_min": week_learning},
    }
