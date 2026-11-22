"""SQLite access: one connection per request, WAL, foreign keys on, numbered migrations."""

import json
import logging
import re
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

from .config import Config

log = logging.getLogger("smriti.db")
MIGRATIONS = Path(__file__).parent / "migrations"
_NAME = re.compile(r"^(\d{3})_[\w-]+\.sql$")


def connect(path: str) -> sqlite3.Connection:
    """Autocommit connection; callers open transactions with `transaction()`."""
    if path != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, isolation_level=None, check_same_thread=False, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 10000")
    if conn.execute("PRAGMA journal_mode").fetchone()[0] != "wal":
        conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


@contextmanager
def transaction(conn: sqlite3.Connection, write: bool = True) -> Iterator[sqlite3.Connection]:
    """Writers take the lock up front (no upgrade failures in WAL); readers do not block anyone."""
    conn.execute("BEGIN IMMEDIATE" if write else "BEGIN")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


@contextmanager
def session(cfg: Config, write: bool = True) -> Iterator[sqlite3.Connection]:
    """A connection inside one transaction, closed afterwards."""
    conn = connect(cfg.db_path)
    try:
        with transaction(conn, write):
            yield conn
    finally:
        conn.close()


def migrations() -> list[tuple[int, Path]]:
    found = []
    for path in sorted(MIGRATIONS.glob("*.sql")):
        if m := _NAME.match(path.name):
            found.append((int(m.group(1)), path))
    return found


def schema_version(conn: sqlite3.Connection) -> int:
    conn.execute("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)")
    return conn.execute("SELECT coalesce(max(version), 0) FROM schema_version").fetchone()[0]


def migrate(path: str) -> int:
    """Apply pending migrations in order, each in its own transaction. Returns the schema version."""
    conn = connect(path)
    try:
        current = schema_version(conn)
        for number, file in migrations():
            if number <= current:
                continue
            script = file.read_text()
            conn.executescript(
                f"BEGIN;\n{script}\nINSERT INTO schema_version (version) VALUES ({number});\nCOMMIT;")
            log.info("migration applied", extra={"version": number, "file": file.name})
            current = number
        return current
    finally:
        conn.close()


# ---------------------------------------------------------------- small query helpers


def one(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> dict | None:
    row = conn.execute(sql, args).fetchone()
    return dict(row) if row else None


def all_rows(conn: sqlite3.Connection, sql: str, args: tuple = ()) -> list[dict]:
    return [dict(r) for r in conn.execute(sql, args)]


def scalar(conn: sqlite3.Connection, sql: str, args: tuple = ()):
    row = conn.execute(sql, args).fetchone()
    return row[0] if row else None


def insert(conn: sqlite3.Connection, table: str, values: dict) -> int:
    cols = ", ".join(values)
    marks = ", ".join("?" for _ in values)
    return conn.execute(f"INSERT INTO {table} ({cols}) VALUES ({marks})", tuple(values.values())).lastrowid


def update(conn: sqlite3.Connection, table: str, row_id: int, values: dict) -> None:
    if not values:
        return
    sets = ", ".join(f"{k} = ?" for k in values)
    conn.execute(f"UPDATE {table} SET {sets} WHERE id = ?", (*values.values(), row_id))


def tags_out(raw: str | None) -> list[str]:
    try:
        value = json.loads(raw or "[]")
    except ValueError:
        return []
    return [str(t) for t in value] if isinstance(value, list) else []


def tags_in(tags: list[str] | None) -> str:
    """Lowercase, trimmed, unique, in the order given."""
    seen: list[str] = []
    for tag in tags or []:
        tag = " ".join(str(tag).split()).lower()
        if tag and tag not in seen:
            seen.append(tag)
    return json.dumps(seen)
