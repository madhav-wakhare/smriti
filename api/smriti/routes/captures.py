"""Captures: quick notes, later kept as a task, source or revisit, or dismissed."""

from typing import Literal

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from .. import clock, db, lookup, models
from ..deps import Conn
from ..errors import conflict, invalid
from .revisits import insert_revisit
from .sources import insert_source
from .tasks import insert_task

router = APIRouter(prefix="/api/captures", tags=["captures"])


class CaptureIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    details: str = ""
    url: str | None = None
    tags: list[str] = []


class CapturePatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=2000)
    details: str | None = None
    url: str | None = None
    tags: list[str] | None = None


class KeepIn(BaseModel):
    as_: Literal["task", "source", "revisit"] = Field(alias="as")
    project_id: int | None = None
    kind: Literal["topic", "article", "book", "video"] | None = None


def _url(value: str | None) -> str | None:
    return (value or "").strip() or None


@router.get("")
def list_captures(conn: Conn, status: Literal["open", "kept", "dismissed", "all"] = "open"):
    where, args = ("1", ()) if status == "all" else ("status = ?", (status,))
    rows = db.all_rows(conn, f"""SELECT * FROM captures WHERE deleted_at IS NULL AND {where}
                                 ORDER BY created_at DESC, id DESC""", args)
    return [models.capture_out(r) for r in rows]


@router.post("", status_code=201)
def create_capture(data: CaptureIn, conn: Conn):
    capture_id = db.insert(conn, "captures", {
        "text": data.text.strip(), "details": data.details, "url": _url(data.url),
        "tags": db.tags_in(data.tags), "created_at": clock.now()})
    return models.capture(conn, capture_id)


@router.patch("/{capture_id}")
def update_capture(capture_id: int, data: CapturePatch, conn: Conn):
    models.capture(conn, capture_id)
    values = data.model_dump(exclude_unset=True)
    for field in ("text", "details", "tags"):
        if field in values and values[field] is None:
            raise invalid(f"{field} cannot be null")
    if "text" in values:
        values["text"] = values["text"].strip()
    if "url" in values:
        values["url"] = _url(values["url"])
    if "tags" in values:
        values["tags"] = db.tags_in(values["tags"])
    db.update(conn, "captures", capture_id, values)
    return models.capture(conn, capture_id)


@router.post("/{capture_id}/keep")
def keep_capture(capture_id: int, data: KeepIn, conn: Conn):
    """Turn the capture into a task, source or revisit and link it."""
    cap = models.capture(conn, capture_id)
    if cap["status"] == "kept":
        raise conflict("This capture was already kept")
    link: dict = {}
    if data.as_ == "task":
        if data.project_id is None:
            raise invalid("project_id is needed to keep a capture as a task")
        link["task_id"] = insert_task(conn, {
            "project_id": data.project_id, "title": cap["text"], "body": cap["details"], "url": cap["url"],
            "tags": cap["tags"]})
    elif data.as_ == "source":
        kind = data.kind or ("video" if lookup.is_video(cap["url"]) else "article" if cap["url"] else "topic")
        link["source_id"] = insert_source(conn, {
            "kind": kind, "title": cap["text"], "body": cap["details"], "url": cap["url"],
            "site": lookup.site_of(cap["url"]) if cap["url"] else "", "tags": cap["tags"]})
    else:
        link["revisit_id"] = insert_revisit(conn, {"title": cap["text"], "body": cap["details"], "url": cap["url"]})
    db.update(conn, "captures", capture_id, {**link, "status": "kept", "sorted_at": clock.now()})
    return models.capture(conn, capture_id)


@router.post("/{capture_id}/dismiss")
def dismiss_capture(capture_id: int, conn: Conn):
    cap = models.capture(conn, capture_id)
    if cap["status"] == "kept":
        raise conflict("This capture was already kept")
    if cap["status"] != "dismissed":
        db.update(conn, "captures", capture_id, {"status": "dismissed", "sorted_at": clock.now()})
    return models.capture(conn, capture_id)


@router.delete("/{capture_id}", status_code=204)
def delete_capture(capture_id: int, conn: Conn):
    models.capture(conn, capture_id)
    conn.execute("UPDATE captures SET deleted_at = ? WHERE id = ?", (clock.now(), capture_id))
    return Response(status_code=204)
