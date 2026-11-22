"""Projects: named groups of tasks with a short key."""

import re

from fastapi import APIRouter, Response
from pydantic import BaseModel, Field

from .. import clock, db, models
from ..deps import Conn
from ..errors import conflict, invalid, not_found

router = APIRouter(prefix="/api/projects", tags=["projects"])
KEY = re.compile(r"^[A-Z][A-Z0-9]{0,9}$")

SELECT = """
SELECT p.*, (SELECT count(*) FROM tasks t
             WHERE t.project_id = p.id AND t.deleted_at IS NULL AND t.status != 'done') AS open_count
FROM projects p
"""


class ProjectIn(BaseModel):
    key: str = Field(min_length=1, max_length=10)
    name: str = Field(min_length=1, max_length=200)


class ProjectPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    archived: bool | None = None


def project_out(row: dict) -> dict:
    return {"id": row["id"], "key": row["key"], "name": row["name"], "archived": bool(row["archived"]),
            "open_count": row["open_count"], "created_at": row["created_at"]}


def load(conn, project_id: int) -> dict:
    row = db.one(conn, SELECT + " WHERE p.id = ? AND p.deleted_at IS NULL", (project_id,))
    if not row:
        raise not_found("Project")
    return project_out(row)


@router.get("")
def list_projects(conn: Conn):
    rows = db.all_rows(conn, SELECT + " WHERE p.deleted_at IS NULL ORDER BY p.archived, p.name COLLATE NOCASE")
    return [project_out(r) for r in rows]


@router.post("", status_code=201)
def create_project(data: ProjectIn, conn: Conn):
    key = data.key.strip().upper()
    if not KEY.match(key):
        raise invalid("Key must be 1 to 10 letters or digits, starting with a letter")
    if db.one(conn, "SELECT id FROM projects WHERE key = ?", (key,)):
        raise conflict(f"Key {key} is already used (look in the trash too)")
    project_id = db.insert(conn, "projects", {"key": key, "name": data.name.strip(), "created_at": clock.now()})
    return load(conn, project_id)


@router.patch("/{project_id}")
def update_project(project_id: int, data: ProjectPatch, conn: Conn):
    load(conn, project_id)
    values = data.model_dump(exclude_unset=True, exclude_none=True)
    if "name" in values:
        values["name"] = values["name"].strip()
    if "archived" in values:
        values["archived"] = int(values["archived"])
    db.update(conn, "projects", project_id, values)
    return load(conn, project_id)


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: int, conn: Conn):
    """Soft delete the project and its live tasks, with one shared timestamp so they restore together."""
    load(conn, project_id)
    task_ids = [r["id"] for r in db.all_rows(
        conn, "SELECT id FROM tasks WHERE project_id = ? AND deleted_at IS NULL", (project_id,))]
    models.stop_running_on(conn, "task_id", task_ids)
    ts = clock.now()
    conn.execute("UPDATE tasks SET deleted_at = ? WHERE project_id = ? AND deleted_at IS NULL", (ts, project_id))
    conn.execute("UPDATE projects SET deleted_at = ? WHERE id = ?", (ts, project_id))
    return Response(status_code=204)
