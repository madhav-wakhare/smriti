"""The Smriti API: FastAPI app, request logging, errors, and the built web UI."""

import logging
import time
from contextlib import asynccontextmanager
from pathlib import Path

import mimetypes

from fastapi import FastAPI, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse

from . import __version__, config, db, errors, logs, obsidian
from .config import Config
from .routes import ROUTERS
from .routes.trash import purge_expired

log = logging.getLogger("smriti")
http_log = logging.getLogger("smriti.http")


def startup(cfg: Config) -> None:
    """Migrations run at start (factor 9); old trash goes, and sources without an Obsidian note get one."""
    version = db.migrate(cfg.db_path)
    with db.session(cfg) as conn:
        removed = purge_expired(conn, cfg)
        # Anything added while the vault was away (or before auto-save) gets its note now.
        saved = obsidian.save_missing(conn, cfg)
    log.info("started", extra={"version": __version__, "schema": version, "db": cfg.db_path,
                               "purged": removed, "obsidian_saved": saved, "tz": cfg.tz, "lookup": cfg.lookup})


def add_request_logging(app: FastAPI) -> None:
    @app.middleware("http")
    async def log_request(request: Request, call_next):
        started = time.perf_counter()
        status = 500
        try:
            response = await call_next(request)
            status = response.status_code
            return response
        finally:
            ms = round((time.perf_counter() - started) * 1000, 1)
            http_log.info("request", extra={"method": request.method, "path": request.url.path,
                                            "status": status, "ms": ms})


def add_static(app: FastAPI, static_dir: str) -> None:
    """Serve the built UI, with unknown non-API paths falling back to index.html (SPA)."""
    root = Path(static_dir).resolve()
    index = root / "index.html"
    if not static_dir or not index.is_file():
        if static_dir:
            log.warning("static dir has no index.html; serving the API only", extra={"static_dir": static_dir})
        return

    @app.get("/{path:path}", include_in_schema=False)
    async def spa(path: str, request: Request):
        if path == "api" or path.startswith("api/"):
            raise errors.not_found("Route")
        target = (root / path).resolve()
        if path and target.is_file() and target.is_relative_to(root):
            if path.startswith("assets/"):
                return asset(target, request.headers.get("accept-encoding", ""))
            return FileResponse(target, headers={"Cache-Control": "no-cache"})
        # A missing file (anything with an extension, like /favicon.png) is a 404, not the app's HTML;
        # only page addresses (/tasks, /learn?kind=book) fall back to index.html.
        if "." in path.rsplit("/", 1)[-1]:
            raise errors.not_found("File")
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


def asset(target: Path, accept: str) -> FileResponse:
    """A hashed build file: cached for a year, and sent pre-compressed (Brotli, else gzip) when the
    browser accepts it. The build writes the .br and .gz files, so no request pays for compression."""
    headers = {"Cache-Control": "public, max-age=31536000, immutable", "Vary": "Accept-Encoding"}
    media_type = mimetypes.guess_type(target.name)[0]
    for encoding, suffix in (("br", ".br"), ("gzip", ".gz")):
        packed = target.with_name(target.name + suffix)
        if encoding in accept and packed.is_file():
            return FileResponse(packed, media_type=media_type, headers={**headers, "Content-Encoding": encoding})
    return FileResponse(target, headers=headers)


def create_app(cfg: Config | None = None) -> FastAPI:
    cfg = cfg or config.get()
    logs.setup(cfg.log_level)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        startup(cfg)
        yield
        log.info("stopped")  # uvicorn finishes open requests on SIGTERM before this runs

    app = FastAPI(title="Smriti", version=__version__, lifespan=lifespan, docs_url="/api/docs",
                  openapi_url="/api/openapi.json", redoc_url=None)
    app.state.config = cfg
    errors.install(app)
    # API answers above 1 KB go out gzipped (lists of tasks and sources shrink about 5x).
    app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=6)
    add_request_logging(app)
    for router in ROUTERS:
        app.include_router(router)
    add_static(app, cfg.static_dir)
    return app


app = create_app()
