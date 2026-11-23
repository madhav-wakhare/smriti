"""Loading rows and shaping them into the API objects of SPEC section 3."""

import sqlite3
from datetime import date

from . import clock, db
from .errors import not_found

# ---------------------------------------------------------------- tasks

# A task's children, their children and so on (Jira-style chains: a parent, its children, their children).
DESCENDANTS = """
WITH RECURSIVE tree(id) AS (
    SELECT id FROM tasks WHERE parent_id = ?
    UNION SELECT t.id FROM tasks t JOIN tree ON t.parent_id = tree.id
)
SELECT id FROM tree
"""


def descendant_ids(conn: sqlite3.Connection, task_id: int, live_only: bool = True) -> list[int]:
    ids = [r["id"] for r in db.all_rows(conn, DESCENDANTS, (task_id,))]
    if live_only and ids:
        marks = ",".join("?" * len(ids))
        ids = [r["id"] for r in db.all_rows(conn, f"SELECT id FROM tasks WHERE id IN ({marks}) AND deleted_at IS NULL", tuple(ids))]
    return ids


def ancestors(conn: sqlite3.Connection, task_id: int) -> list[dict]:
    """The chain above a task, from the top down to its parent: [{id, key, title, status}]."""
    chain, seen = [], {task_id}
    parent = db.scalar(conn, "SELECT parent_id FROM tasks WHERE id = ?", (task_id,))
    while parent and parent not in seen:
        seen.add(parent)
        row = db.one(conn, """SELECT t.id, p.key || '-' || t.number AS key, t.title, t.status, t.parent_id
                              FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?""", (parent,))
        if not row:
            break
        chain.append({k: row[k] for k in ("id", "key", "title", "status")})
        parent = row["parent_id"]
    return list(reversed(chain))

TASK_SELECT = """
SELECT t.*, p.key AS project_key,
       pp.key || '-' || pt.number AS parent_key,
       (SELECT coalesce(sum(s.minutes), 0) FROM sessions s WHERE s.task_id = t.id) AS logged_min,
       (SELECT count(*) FROM checks c WHERE c.task_id = t.id AND c.done) AS checks_done,
       (SELECT count(*) FROM checks c WHERE c.task_id = t.id) AS checks_total,
       (SELECT count(*) FROM tasks ch WHERE ch.parent_id = t.id AND ch.deleted_at IS NULL) AS children,
       (SELECT count(*) FROM tasks ch WHERE ch.parent_id = t.id AND ch.deleted_at IS NULL
                                        AND ch.status = 'done') AS children_done
FROM tasks t
JOIN projects p ON p.id = t.project_id
LEFT JOIN tasks pt ON pt.id = t.parent_id
LEFT JOIN projects pp ON pp.id = pt.project_id
"""

TASK_FIELDS = ("id", "project_id", "project_key", "parent_id", "parent_key", "title", "body", "status",
               "priority", "planned_on", "due_on", "estimate_min", "repeat", "url", "position", "logged_min",
               "checks_done", "checks_total", "children", "children_done", "created_at", "updated_at", "status_at", "done_at",
               "obsidian_path", "exported_at")


def task_out(row: dict) -> dict:
    out = {k: row[k] for k in TASK_FIELDS}
    out["key"] = f"{row['project_key']}-{row['number']}"
    out["tags"] = db.tags_out(row["tags"])
    return out


def tasks(conn: sqlite3.Connection, where: str = "1", args: tuple = (), order: str = "t.position, t.id",
          limit: int | None = None) -> list[dict]:
    sql = f"{TASK_SELECT} WHERE t.deleted_at IS NULL AND ({where}) ORDER BY {order}"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [task_out(r) for r in db.all_rows(conn, sql, args)]


def task_row(conn: sqlite3.Connection, task_id: int) -> dict:
    """The raw row of a live task, or 404."""
    row = db.one(conn, "SELECT * FROM tasks WHERE id = ? AND deleted_at IS NULL", (task_id,))
    if not row:
        raise not_found("Task")
    return row


def task(conn: sqlite3.Connection, task_id: int) -> dict:
    found = tasks(conn, "t.id = ?", (task_id,))
    if not found:
        raise not_found("Task")
    return found[0]


# ---------------------------------------------------------------- sources

SOURCE_SELECT = """
SELECT s.*, (SELECT coalesce(sum(x.minutes), 0) FROM sessions x WHERE x.source_id = s.id) AS logged_min
FROM sources s
"""


def source_out(row: dict, raw: bool = False) -> dict:
    hidden = {"deleted_at"} if raw else {"deleted_at", "obsidian_key"}
    out = {k: v for k, v in row.items() if k not in hidden}
    out["tags"] = db.tags_out(row["tags"])
    return out


def sources(conn: sqlite3.Connection, where: str = "1", args: tuple = (),
            order: str = "s.updated_at DESC, s.id DESC", raw: bool = False) -> list[dict]:
    sql = f"{SOURCE_SELECT} WHERE s.deleted_at IS NULL AND ({where}) ORDER BY {order}"
    return [source_out(r, raw) for r in db.all_rows(conn, sql, args)]


def source(conn: sqlite3.Connection, source_id: int, raw: bool = False) -> dict:
    found = sources(conn, "s.id = ?", (source_id,), raw=raw)
    if not found:
        raise not_found("Source")
    return found[0]


# ---------------------------------------------------------------- revisits

REVISIT_SELECT = """
SELECT c.*,
       (SELECT coalesce(sum(x.minutes), 0) FROM sessions x WHERE x.revisit_id = c.id) AS logged_min,
       (SELECT count(*) FROM sessions x WHERE x.revisit_id = c.id AND x.ended_at IS NOT NULL) AS review_count
FROM revisits c
"""


def revisit_out(row: dict) -> dict:
    return {k: v for k, v in row.items() if k != "deleted_at"}


def revisits(conn: sqlite3.Connection, where: str = "1", args: tuple = (),
          order: str = "c.priority DESC, c.reviewed_at IS NOT NULL, c.reviewed_at, c.id",
          limit: int | None = None) -> list[dict]:
    sql = f"{REVISIT_SELECT} WHERE c.deleted_at IS NULL AND ({where}) ORDER BY {order}"
    if limit:
        sql += f" LIMIT {int(limit)}"
    return [revisit_out(r) for r in db.all_rows(conn, sql, args)]


def revisit(conn: sqlite3.Connection, revisit_id: int) -> dict:
    found = revisits(conn, "c.id = ?", (revisit_id,))
    if not found:
        raise not_found("Revisit")
    return found[0]


# ---------------------------------------------------------------- captures


def capture_out(row: dict) -> dict:
    out = {k: v for k, v in row.items() if k != "deleted_at"}
    out["tags"] = db.tags_out(row["tags"])
    return out


def capture(conn: sqlite3.Connection, capture_id: int) -> dict:
    row = db.one(conn, "SELECT * FROM captures WHERE id = ? AND deleted_at IS NULL", (capture_id,))
    if not row:
        raise not_found("Capture")
    return capture_out(row)


# ---------------------------------------------------------------- sessions

SESSION_SELECT = """
SELECT x.*,
       coalesce(t.title, s.title, c.title) AS label,
       CASE WHEN x.task_id IS NOT NULL THEN p.key || '-' || t.number END AS subject_key
FROM sessions x
LEFT JOIN tasks t ON t.id = x.task_id
LEFT JOIN projects p ON p.id = t.project_id
LEFT JOIN sources s ON s.id = x.source_id
LEFT JOIN revisits c ON c.id = x.revisit_id
"""


def session_out(row: dict) -> dict:
    if row["task_id"] is not None:
        kind, subject_id = "task", row["task_id"]
    elif row["source_id"] is not None:
        kind, subject_id = "source", row["source_id"]
    else:
        kind, subject_id = "revisit", row["revisit_id"]
    return {
        "id": row["id"],
        "subject": {"kind": kind, "id": subject_id, "label": row["label"] or "", "key": row["subject_key"]},
        "started_at": row["started_at"],
        "ended_at": row["ended_at"],
        "minutes": row["minutes"],
        "note": row["note"],
    }


def sessions(conn: sqlite3.Connection, where: str = "1", args: tuple = (),
             order: str = "x.started_at DESC, x.id DESC") -> list[dict]:
    return [session_out(r) for r in db.all_rows(conn, f"{SESSION_SELECT} WHERE {where} ORDER BY {order}", args)]


def session(conn: sqlite3.Connection, session_id: int) -> dict:
    found = sessions(conn, "x.id = ?", (session_id,))
    if not found:
        raise not_found("Session")
    return found[0]


def running(conn: sqlite3.Connection) -> dict | None:
    found = sessions(conn, "x.ended_at IS NULL")
    return found[0] if found else None


# ---------------------------------------------------------------- notes, events, days


def notes(conn: sqlite3.Connection, column: str, subject_id: int) -> list[dict]:
    return db.all_rows(conn, f"""SELECT id, task_id, source_id, body, created_at, edited_at FROM notes
                                 WHERE {column} = ? ORDER BY created_at, id""", (subject_id,))


def events(conn: sqlite3.Connection, column: str, subject_id: int) -> list[dict]:
    return db.all_rows(conn, f"SELECT id, field, old, new, at FROM events WHERE {column} = ? ORDER BY at DESC, id DESC",
                       (subject_id,))


def log_event(conn: sqlite3.Connection, column: str, subject_id: int, field: str, old, new) -> None:
    db.insert(conn, "events", {
        column: subject_id, "field": field,
        "old": None if old is None else str(old), "new": None if new is None else str(new), "at": clock.now()})


def day(conn: sqlite3.Connection, when: date) -> dict:
    row = db.one(conn, "SELECT * FROM days WHERE date = ?", (when.isoformat(),))
    return row or {"date": when.isoformat(), "went_well": "", "blockers": "", "tomorrow": "", "updated_at": None}


# ---------------------------------------------------------------- running sessions on deleted subjects


def stop_running_on(conn: sqlite3.Connection, column: str, ids: list[int]) -> None:
    """Stop the running session if its subject is about to disappear."""
    run = db.one(conn, "SELECT * FROM sessions WHERE ended_at IS NULL")
    if run and run[column] in ids:
        end_session(conn, run)


def end_session(conn: sqlite3.Connection, run: dict, note: str | None = None) -> None:
    ended = clock.now()
    values = {"ended_at": ended, "minutes": clock.minutes_between(run["started_at"], ended)}
    if note:
        values["note"] = note
    db.update(conn, "sessions", run["id"], values)
    if run["revisit_id"] is not None:
        conn.execute("UPDATE revisits SET reviewed_at = ? WHERE id = ?", (ended, run["revisit_id"]))
