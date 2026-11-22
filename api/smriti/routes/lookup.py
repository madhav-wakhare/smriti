"""Lookups for the add dialogs: a link preview and an Open Library book search."""

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from .. import lookup as remote
from ..deps import Cfg
from ..errors import ApiError, invalid

router = APIRouter(prefix="/api/lookup", tags=["lookup"])


class LinkIn(BaseModel):
    url: str = Field(min_length=1, max_length=2000)


@router.post("/link")
def lookup_link(data: LinkIn, cfg: Cfg):
    """With SMRITI_LOOKUP=off this still answers, from the URL alone (site and kind)."""
    url = data.url.strip()
    if not url.startswith(("http://", "https://")):
        raise invalid("url must start with http:// or https://")
    return remote.link(url, cfg)


@router.get("/books")
def lookup_books(cfg: Cfg, q: str = Query(min_length=2, max_length=200)):
    if not cfg.lookup:
        raise ApiError(503, "lookup_off", "Lookups are turned off (SMRITI_LOOKUP=off). Add the book by hand.")
    try:
        return remote.books(q)
    except remote.LookupFailed as exc:
        raise ApiError(502, "upstream", "Could not reach Open Library. Add the book by hand.") from exc
