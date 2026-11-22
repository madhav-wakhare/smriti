"""FastAPI dependencies: the configuration and a per-request database connection."""

import sqlite3
from collections.abc import Iterator
from typing import Annotated

from fastapi import Depends, Request

from . import db
from .config import Config


def get_config(request: Request) -> Config:
    return request.app.state.config


def get_conn(request: Request) -> Iterator[sqlite3.Connection]:
    """One connection and one transaction per request; committed before the response is sent."""
    write = request.method not in ("GET", "HEAD")
    with db.session(request.app.state.config, write) as conn:
        yield conn


Conn = Annotated[sqlite3.Connection, Depends(get_conn, scope="function")]
Cfg = Annotated[Config, Depends(get_config)]
