"""Full-text search over tasks, sources, revisits and captures."""

import re

from fastapi import APIRouter, Query

from .. import db
from ..deps import Conn

router = APIRouter(prefix="/api", tags=["search"])
KEY = re.compile(r"^([A-Za-z][A-Za-z0-9]*)-(\d+)$")
LIMIT = 30


def fts_query(text: str) -> str | None:
    """Each word as a quoted prefix term, searched in title and body only."""
    words = re.findall(r"\w+", text)
    if not words:
        return None
    return "{title body} : " + " ".join(f'"{w}"*' for w in words)


def key_match(conn, text: str) -> list[dict]:
    m = KEY.match(text.strip())
    if not m:
        return []
    row = db.one(conn, """SELECT t.id, t.title, p.key || '-' || t.number AS key FROM tasks t
                          JOIN projects p ON p.id = t.project_id
                          WHERE p.key = ? AND t.number = ? AND t.deleted_at IS NULL""",
                 (m.group(1).upper(), int(m.group(2))))
    return [{"kind": "task", "id": row["id"], "title": row["title"], "snippet": "", "key": row["key"]}] if row else []


@router.get("/search")
def search(conn: Conn, q: str = Query(min_length=1, max_length=200)):
    results = key_match(conn, q)
    match = fts_query(q)
    if not match:
        return results
    rows = db.all_rows(conn, """
        SELECT search.kind, search.ref_id AS id, search.title,
               snippet(search, 3, '', '', '…', 12) AS snippet,
               CASE WHEN search.kind = 'task' THEN p.key || '-' || t.number END AS key
        FROM search
        LEFT JOIN tasks t ON search.kind = 'task' AND t.id = search.ref_id
        LEFT JOIN projects p ON p.id = t.project_id
        WHERE search MATCH ? ORDER BY rank LIMIT ?""", (match, LIMIT))
    seen = {(r["kind"], r["id"]) for r in results}
    for r in rows:
        r["id"] = int(r["id"])
        if (r["kind"], r["id"]) not in seen:
            results.append(r)
    return results
