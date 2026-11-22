"""API errors, always shaped {"error": {"code", "message"}}."""

import logging
import sqlite3

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("smriti")

CODES = {400: "bad_request", 404: "not_found", 405: "method_not_allowed", 409: "conflict",
         422: "invalid", 502: "upstream", 503: "unavailable"}


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def not_found(what: str) -> ApiError:
    return ApiError(404, "not_found", f"{what} not found")


def invalid(message: str) -> ApiError:
    return ApiError(422, "invalid", message)


def conflict(message: str) -> ApiError:
    return ApiError(409, "conflict", message)


def body(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status)


def _validation_message(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors()[:3]:
        where = ".".join(str(p) for p in err.get("loc", ()) if p not in ("body", "query", "path"))
        parts.append(f"{where}: {err.get('msg', 'invalid')}" if where else err.get("msg", "invalid"))
    return "; ".join(parts) or "Invalid request"


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api(_req: Request, exc: ApiError):
        return body(exc.status, exc.code, exc.message)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_req: Request, exc: StarletteHTTPException):
        code = CODES.get(exc.status_code, "error")
        message = exc.detail if isinstance(exc.detail, str) else code.replace("_", " ")
        return body(exc.status_code, code, message)

    @app.exception_handler(RequestValidationError)
    async def _validation(_req: Request, exc: RequestValidationError):
        return body(422, "invalid", _validation_message(exc))

    @app.exception_handler(sqlite3.IntegrityError)
    async def _integrity(_req: Request, exc: sqlite3.IntegrityError):
        return body(409, "conflict", f"Conflicts with existing data ({exc})")

    @app.exception_handler(Exception)
    async def _any(req: Request, exc: Exception):
        log.exception("unhandled error", extra={"path": req.url.path})
        return body(500, "internal", "Something went wrong on the server")
