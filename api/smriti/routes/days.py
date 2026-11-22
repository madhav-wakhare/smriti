"""Days: the end-of-day review."""

from datetime import date

from fastapi import APIRouter
from pydantic import BaseModel

from .. import clock, models
from ..deps import Conn

router = APIRouter(prefix="/api/days", tags=["days"])


class DayIn(BaseModel):
    went_well: str = ""
    blockers: str = ""
    tomorrow: str = ""


@router.get("/{day}")
def get_day(day: date, conn: Conn):
    return models.day(conn, day)


@router.put("/{day}")
def save_day(day: date, data: DayIn, conn: Conn):
    conn.execute(
        """INSERT INTO days (date, went_well, blockers, tomorrow, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (date) DO UPDATE SET went_well = excluded.went_well, blockers = excluded.blockers,
                                            tomorrow = excluded.tomorrow, updated_at = excluded.updated_at""",
        (day.isoformat(), data.went_well, data.blockers, data.tomorrow, clock.now()))
    return models.day(conn, day)
