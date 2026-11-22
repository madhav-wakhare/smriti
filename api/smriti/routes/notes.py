"""Notes: comments on a task or a source."""

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from .. import clock, db, models
from ..deps import Conn
from ..errors import invalid, not_found

router = APIRouter(prefix="/api/notes", tags=["notes"])


class NoteIn(BaseModel):
    task_id: int | None = None
    source_id: int | None = None
    body: str = Field(min_length=1)


class NotePatch(BaseModel):
    body: str = Field(min_length=1)


def load(conn, note_id: int) -> dict:
    row = db.one(conn, "SELECT id, task_id, source_id, body, created_at, edited_at FROM notes WHERE id = ?",
                 (note_id,))
    if not row:
        raise not_found("Note")
    return row


@router.post("", status_code=201)
def create_note(data: NoteIn, conn: Conn):
    if (data.task_id is None) == (data.source_id is None):
        raise invalid("Give task_id or source_id")
    if data.task_id is not None:
        models.task_row(conn, data.task_id)
    else:
        models.source(conn, data.source_id)
    note_id = db.insert(conn, "notes", {"task_id": data.task_id, "source_id": data.source_id,
                                        "body": data.body, "created_at": clock.now()})
    return load(conn, note_id)


@router.patch("/{note_id}")
def update_note(note_id: int, data: NotePatch, conn: Conn):
    load(conn, note_id)
    db.update(conn, "notes", note_id, {"body": data.body, "edited_at": clock.now()})
    return load(conn, note_id)


@router.delete("/{note_id}", status_code=204)
def delete_note(note_id: int, conn: Conn):
    load(conn, note_id)
    conn.execute("DELETE FROM notes WHERE id = ?", (note_id,))
    return Response(status_code=204)
