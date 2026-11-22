"""Health and public configuration."""

from fastapi import APIRouter

from .. import __version__, clock, db, obsidian
from ..deps import Cfg, Conn

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/health")
def health(conn: Conn):
    db.scalar(conn, "SELECT 1")
    return {"status": "ok", "version": __version__}


@router.get("/config")
def config(cfg: Cfg):
    return {"version": __version__, "tz": cfg.tz, "today": clock.today(cfg.zone).isoformat(),
            "trash_days": cfg.trash_days}


@router.get("/obsidian")
def obsidian_status(cfg: Cfg):
    """Whether a vault is connected, where notes go, and whether edits update notes."""
    return obsidian.status(cfg)
