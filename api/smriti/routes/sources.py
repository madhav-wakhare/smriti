"""Sources: topics, articles, books and videos you learn from."""

import sqlite3
from typing import Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from .. import clock, db, lookup, models, obsidian
from ..config import Config
from ..deps import Cfg, Conn
from ..errors import ApiError, invalid

router = APIRouter(prefix="/api/sources", tags=["sources"])

Kind = Literal["topic", "article", "book", "video"]
Status = Literal["queued", "active", "done"]
EVENT_FIELDS = ("status", "title")
ORDER = "CASE s.status WHEN 'active' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, s.updated_at DESC, s.id DESC"


class SourceIn(BaseModel):
    kind: Kind
    title: str = Field(default="", max_length=500)
    url: str | None = None
    author: str = ""
    site: str = ""
    image: str | None = None
    summary: str = ""
    body: str = ""
    status: Status = "queued"
    progress: int = Field(default=0, ge=0)
    total: int | None = Field(default=None, ge=0)
    tags: list[str] = []
    ref: str | None = None


class SourcePatch(BaseModel):
    kind: Kind | None = None
    title: str | None = Field(default=None, min_length=1, max_length=500)
    url: str | None = None
    author: str | None = None
    site: str | None = None
    image: str | None = None
    summary: str | None = None
    body: str | None = None
    status: Status | None = None
    progress: int | None = Field(default=None, ge=0)
    total: int | None = Field(default=None, ge=0)
    tags: list[str] | None = None
    ref: str | None = None
    # The collections this source sits in (replaces the whole set).
    collection_ids: list[int] | None = None


def status_values(kind: str, total: int | None, started_at: str | None, status: str, ts: str) -> dict:
    """active sets started_at once; done sets done_at (and fills a book's progress); leaving done clears it."""
    values: dict = {"status": status, "done_at": ts if status == "done" else None}
    if status == "active" and not started_at:
        values["started_at"] = ts
    if status == "done" and kind == "book" and total:
        values["progress"] = total
    return values


def insert_source(conn: sqlite3.Connection, values: dict) -> int:
    """Insert a source; values use stored column names (tags as a list)."""
    ts = clock.now()
    row = {"status": "queued", **values, "created_at": ts, "updated_at": ts}
    row["tags"] = db.tags_in(row.get("tags"))
    row.update(status_values(row["kind"], row.get("total"), None, row["status"], ts))
    return db.insert(conn, "sources", row)


def fill_from_link(values: dict, cfg: Config) -> None:
    """When a url is given without a title, look the page up and fill the empty fields."""
    if not values.get("url") or values.get("title"):
        return
    found = lookup.link(values["url"], cfg)
    values["title"] = found["title"] or found["site"] or values["url"]
    for field in ("site", "author", "summary"):
        if not values.get(field):
            values[field] = found[field]
    if not values.get("image"):
        values["image"] = found["image"]


def set_collections(conn: sqlite3.Connection, source_id: int, collection_ids: list[int]) -> bool:
    """Put a source in exactly these collections. Returns whether anything changed."""
    wanted = set(collection_ids)
    for cid in wanted:
        if not db.scalar(conn, "SELECT 1 FROM collections WHERE id = ?", (cid,)):
            raise invalid(f"Collection {cid} not found")
    have = {r["collection_id"] for r in db.all_rows(conn, "SELECT collection_id FROM source_collections WHERE source_id = ?", (source_id,))}
    for cid in have - wanted:
        conn.execute("DELETE FROM source_collections WHERE source_id = ? AND collection_id = ?", (source_id, cid))
    for cid in wanted - have:
        conn.execute("INSERT INTO source_collections (source_id, collection_id, added_at) VALUES (?, ?, ?)",
                     (source_id, cid, clock.now()))
    return have != wanted


def _live(conn: sqlite3.Connection, source_id: int) -> dict:
    models.source(conn, source_id)  # 404 when missing
    return db.one(conn, "SELECT * FROM sources WHERE id = ?", (source_id,))


@router.get("")
def list_sources(conn: Conn, kind: Kind | None = None, status: Status | None = None, tag: str | None = None,
                 q: str | None = None, collection_id: int | None = None):
    where, args = [], []
    if collection_id is not None:
        where.append("EXISTS (SELECT 1 FROM source_collections sc WHERE sc.source_id = s.id AND sc.collection_id = ?)")
        args.append(collection_id)
    if kind:
        where.append("s.kind = ?")
        args.append(kind)
    if status:
        where.append("s.status = ?")
        args.append(status)
    if tag:
        where.append("EXISTS (SELECT 1 FROM json_each(s.tags) WHERE value = ?)")
        args.append(tag.strip().lower())
    if q and q.strip():
        like = f"%{q.strip()}%"
        where.append("(s.title LIKE ? OR s.author LIKE ? OR s.summary LIKE ? OR s.body LIKE ? OR s.url LIKE ?)")
        args += [like] * 5
    return models.sources(conn, " AND ".join(where) or "1", tuple(args), ORDER)


@router.post("", status_code=201)
def create_source(data: SourceIn, conn: Conn, cfg: Cfg):
    values = data.model_dump()
    values["title"] = values["title"].strip()
    values["url"] = (values["url"] or "").strip() or None
    fill_from_link(values, cfg)
    if not values["title"]:
        raise invalid("Give a title or a url")
    return models.source(conn, insert_source(conn, values))


@router.get("/{source_id}")
def get_source(source_id: int, conn: Conn):
    out = models.source(conn, source_id)
    out["notes"] = models.notes(conn, "source_id", source_id)
    out["sessions"] = models.sessions(conn, "x.source_id = ?", (source_id,))
    out["events"] = models.events(conn, "source_id", source_id)
    out["revisits"] = models.revisits(conn, "c.source_id = ?", (source_id,))
    return out


@router.patch("/{source_id}")
def update_source(source_id: int, data: SourcePatch, conn: Conn, cfg: Cfg):
    old = _live(conn, source_id)
    changes = data.model_dump(exclude_unset=True)
    collection_ids = changes.pop("collection_ids", None)
    for field in ("kind", "title", "author", "site", "summary", "body", "status", "progress", "tags"):
        if field in changes and changes[field] is None:
            raise invalid(f"{field} cannot be null")
    ts = clock.now()
    values: dict = {}
    for field, value in changes.items():
        if field == "tags":
            value = db.tags_in(value)
        elif field in ("title", "url") and value is not None:
            value = value.strip() or None
            if field == "title" and not value:
                raise invalid("title cannot be empty")
        if old[field] == value:
            continue
        values[field] = value
        if field in EVENT_FIELDS:
            models.log_event(conn, "source_id", source_id, field, old[field], value)
    if "status" in values:
        kind = values.get("kind", old["kind"])
        total = values.get("total", old["total"])
        values.update(status_values(kind, total, old["started_at"], values["status"], ts))
    if collection_ids is not None and set_collections(conn, source_id, collection_ids):
        values.setdefault("updated_at", ts)
        changed_collections = True
    else:
        changed_collections = False
    if values:
        values["updated_at"] = ts
        db.update(conn, "sources", source_id, values)
        changed = set(values) | ({"collections"} if changed_collections else set())
        obsidian.refresh_if_exported(conn, cfg, models.source(conn, source_id, raw=True), changed)
    return models.source(conn, source_id)


@router.post("/{source_id}/obsidian")
def export_to_obsidian(source_id: int, conn: Conn, cfg: Cfg):
    """Write this source to the Obsidian vault (or rewrite its note). Returns the source with its note path."""
    try:
        obsidian.export(conn, cfg, models.source(conn, source_id, raw=True))
    except obsidian.ExportError as exc:
        raise ApiError(409, "vault_unavailable", str(exc)) from exc
    return models.source(conn, source_id)


@router.delete("/{source_id}", status_code=204)
def delete_source(source_id: int, conn: Conn):
    models.source(conn, source_id)
    models.stop_running_on(conn, "source_id", [source_id])
    conn.execute("UPDATE sources SET deleted_at = ? WHERE id = ?", (clock.now(), source_id))
    return Response(status_code=204)
