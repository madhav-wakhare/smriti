"""Quotes: short lines that keep you going. Today shows one at a time."""

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from .. import clock, db
from ..deps import Conn
from ..errors import not_found

router = APIRouter(prefix="/api/quotes", tags=["quotes"])


class QuoteIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)
    author: str = Field(default="", max_length=200)


class QuotePatch(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=2000)
    author: str | None = Field(default=None, max_length=200)


def get_quote(conn, quote_id: int) -> dict:
    row = db.one(conn, "SELECT * FROM quotes WHERE id = ?", (quote_id,))
    if not row:
        raise not_found("quote")
    return row


@router.get("")
def list_quotes(conn: Conn):
    return db.all_rows(conn, "SELECT * FROM quotes ORDER BY id")


@router.post("", status_code=201)
def create_quote(data: QuoteIn, conn: Conn):
    quote_id = db.insert(conn, "quotes", {"text": data.text.strip(), "author": data.author.strip(), "created_at": clock.now()})
    return get_quote(conn, quote_id)


@router.patch("/{quote_id}")
def update_quote(quote_id: int, data: QuotePatch, conn: Conn):
    get_quote(conn, quote_id)
    values = {k: v.strip() for k, v in data.model_dump(exclude_unset=True).items() if v is not None}
    if values:
        db.update(conn, "quotes", quote_id, values)
    return get_quote(conn, quote_id)


@router.delete("/{quote_id}", status_code=204)
def delete_quote(quote_id: int, conn: Conn):
    get_quote(conn, quote_id)
    conn.execute("DELETE FROM quotes WHERE id = ?", (quote_id,))
    return Response(status_code=204)
