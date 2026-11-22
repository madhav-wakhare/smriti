"""Configuration from environment variables only (SPEC section 4), read once."""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from functools import lru_cache
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


@dataclass(frozen=True)
class Config:
    port: int = 8000
    db_path: str = "/data/smriti.db"
    static_dir: str = "/app/static"
    trash_days: int = 30
    log_level: str = "info"
    lookup: bool = True
    tz: str = "UTC"
    # Obsidian export (an attached resource, factor 4): the vault is mounted at vault_dir; vault_host is
    # only shown in the UI so you know where notes land. Folders are inside the vault.
    vault_dir: str = "/vault"
    vault_host: str = ""
    obsidian_folder: str = "Smriti/Learning"
    obsidian_articles_folder: str = "Smriti/Articles"
    obsidian_tasks_folder: str = "Smriti/Tasks"
    obsidian_auto: bool = True

    @property
    def zone(self) -> ZoneInfo:
        return _zone(self.tz)


@lru_cache(maxsize=8)
def _zone(name: str) -> ZoneInfo:
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo("UTC")


def _int(env: Mapping[str, str], name: str, default: int) -> int:
    raw = (env.get(name) or "").strip()
    try:
        return int(raw) if raw else default
    except ValueError:
        return default


def from_env(env: Mapping[str, str] | None = None) -> Config:
    """Build a Config from the environment (or from a mapping, for tests)."""
    env = os.environ if env is None else env
    return Config(
        port=_int(env, "PORT", 8000),
        db_path=(env.get("SMRITI_DB_PATH") or "/data/smriti.db").strip(),
        static_dir=env.get("SMRITI_STATIC_DIR", "/app/static").strip(),
        trash_days=max(1, _int(env, "SMRITI_TRASH_DAYS", 30)),
        log_level=(env.get("SMRITI_LOG_LEVEL") or "info").strip().lower(),
        lookup=(env.get("SMRITI_LOOKUP") or "on").strip().lower() not in ("off", "0", "false", "no"),
        tz=(env.get("TZ") or "UTC").strip(),
        vault_dir=(env.get("SMRITI_VAULT_DIR") or "/vault").strip(),
        vault_host=(env.get("SMRITI_VAULT_PATH") or "").strip(),
        obsidian_folder=(env.get("SMRITI_OBSIDIAN_FOLDER") or "Smriti/Learning").strip().strip("/"),
        obsidian_articles_folder=(env.get("SMRITI_OBSIDIAN_ARTICLES_FOLDER") or "Smriti/Articles").strip().strip("/"),
        obsidian_tasks_folder=(env.get("SMRITI_OBSIDIAN_TASKS_FOLDER") or "Smriti/Tasks").strip().strip("/"),
        obsidian_auto=(env.get("SMRITI_OBSIDIAN_AUTO") or "on").strip().lower() not in ("off", "0", "false", "no"),
    )


@lru_cache(maxsize=1)
def get() -> Config:
    """The process configuration, read from the environment the first time it is asked for."""
    return from_env()
