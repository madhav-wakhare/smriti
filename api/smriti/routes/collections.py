"""Collections: named groups that keep sources organised (AI, SRE, Databases...)."""

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from .. import clock, db, models, obsidian
from ..deps import Cfg, Conn
from ..errors import conflict, invalid, not_found

router = APIRouter(prefix="/api/collections", tags=["collections"])


class CollectionIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class MemberIn(BaseModel):
    source_id: int


def one(conn, collection_id: int) -> dict:
    row = db.one(conn, """SELECT c.*, (SELECT count(*) FROM source_collections sc JOIN sources s ON s.id = sc.source_id
                                       WHERE sc.collection_id = c.id AND s.deleted_at IS NULL) AS count
                          FROM collections c WHERE c.id = ?""", (collection_id,))
    if not row:
        raise not_found("Collection")
    return row


def clean(name: str) -> str:
    name = " ".join(name.split())
    if not name or obsidian.safe_filename(name) == "Untitled":
        raise invalid("Give the collection a name")
    return name


def _taken(conn, name: str, but: int | None = None) -> None:
    other = db.scalar(conn, "SELECT id FROM collections WHERE name = ? COLLATE NOCASE", (name,))
    if other and other != but:
        raise conflict(f"There is already a collection called {name}")


@router.get("")
def list_collections(conn: Conn):
    return db.all_rows(conn, """SELECT c.*, (SELECT count(*) FROM source_collections sc JOIN sources s ON s.id = sc.source_id
                                             WHERE sc.collection_id = c.id AND s.deleted_at IS NULL) AS count
                                FROM collections c ORDER BY c.name COLLATE NOCASE""")


@router.post("", status_code=201)
def create_collection(data: CollectionIn, conn: Conn):
    name = clean(data.name)
    _taken(conn, name)
    return one(conn, db.insert(conn, "collections", {"name": name, "created_at": clock.now()}))


@router.patch("/{collection_id}")
def rename_collection(collection_id: int, data: CollectionIn, conn: Conn, cfg: Cfg):
    one(conn, collection_id)
    name = clean(data.name)
    _taken(conn, name, but=collection_id)
    conn.execute("UPDATE collections SET name = ? WHERE id = ?", (name, collection_id))
    # Notes list their collections, so saved notes of its live sources are rewritten with the new name.
    for r in db.all_rows(conn, """SELECT sc.source_id FROM source_collections sc JOIN sources s ON s.id = sc.source_id
                                  WHERE sc.collection_id = ? AND s.deleted_at IS NULL""", (collection_id,)):
        obsidian.refresh_if_exported(conn, cfg, models.source(conn, r["source_id"], raw=True), {"collections"})
    return one(conn, collection_id)


@router.delete("/{collection_id}", status_code=204)
def delete_collection(collection_id: int, conn: Conn):
    """The collection goes; its sources stay where they are."""
    one(conn, collection_id)
    conn.execute("DELETE FROM collections WHERE id = ?", (collection_id,))
    return Response(status_code=204)


@router.post("/{collection_id}/sources")
def add_source(collection_id: int, data: MemberIn, conn: Conn, cfg: Cfg):
    """Add a source to this collection (dragging a card onto a collection does this)."""
    one(conn, collection_id)
    models.source(conn, data.source_id)
    cur = conn.execute("INSERT OR IGNORE INTO source_collections (source_id, collection_id, added_at) VALUES (?, ?, ?)",
                       (data.source_id, collection_id, clock.now()))
    if cur.rowcount:
        obsidian.refresh_if_exported(conn, cfg, models.source(conn, data.source_id, raw=True), {"collections"})
    return models.source(conn, data.source_id)


@router.delete("/{collection_id}/sources/{source_id}")
def remove_source(collection_id: int, source_id: int, conn: Conn, cfg: Cfg):
    one(conn, collection_id)
    cur = conn.execute("DELETE FROM source_collections WHERE source_id = ? AND collection_id = ?", (source_id, collection_id))
    if cur.rowcount:
        obsidian.refresh_if_exported(conn, cfg, models.source(conn, source_id, raw=True), {"collections"})
    return models.source(conn, source_id)
