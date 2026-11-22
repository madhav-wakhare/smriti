"""Time helpers. Timestamps are stored as UTC ISO strings with Z; plain dates are local (TZ)."""

from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo


def to_iso(moment: datetime) -> str:
    """A timezone-aware datetime as '2026-11-22T05:43:17Z'."""
    return moment.astimezone(UTC).replace(microsecond=0, tzinfo=None).isoformat() + "Z"


def now() -> str:
    return to_iso(datetime.now(UTC))


def parse(stamp: str) -> datetime:
    """Parse a stored UTC stamp back into an aware datetime."""
    moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
    return moment if moment.tzinfo else moment.replace(tzinfo=UTC)


def from_user(moment: datetime, zone: ZoneInfo) -> str:
    """A datetime from a request: naive values are read as local time."""
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=zone)
    return to_iso(moment)


def today(zone: ZoneInfo) -> date:
    return datetime.now(zone).date()


def local_date(stamp: str, zone: ZoneInfo) -> date:
    return parse(stamp).astimezone(zone).date()


def day_start(day: date, zone: ZoneInfo) -> str:
    """The UTC stamp of local midnight at the start of `day`."""
    return to_iso(datetime(day.year, day.month, day.day, tzinfo=zone))


def bounds(first: date, last: date, zone: ZoneInfo) -> tuple[str, str]:
    """UTC [start, end) stamps covering the local dates first..last inclusive."""
    return day_start(first, zone), day_start(last + timedelta(days=1), zone)


def minutes_between(start: str, end: str) -> int:
    """Whole minutes from start to end, at least 1."""
    seconds = (parse(end) - parse(start)).total_seconds()
    return max(1, round(seconds / 60))


def add_minutes(stamp: str, minutes: int) -> str:
    return to_iso(parse(stamp) + timedelta(minutes=minutes))


def monday_of(day: date) -> date:
    return day - timedelta(days=day.weekday())
