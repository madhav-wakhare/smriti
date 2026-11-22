import os
import sqlite3

import pytest

from smriti import db
from smriti.importer_arc import ImportRefused, run

ARC = os.environ.get("SMRITI_TEST_ARC", "/import/arc.db")
pytestmark = pytest.mark.skipif(not os.path.isfile(ARC), reason="no Arc snapshot mounted")


def arc_rows(sql):
    conn = sqlite3.connect(f"file:{ARC}?mode=ro&immutable=1", uri=True)
    try:
        return conn.execute(sql).fetchall()
    finally:
        conn.close()


@pytest.fixture
def imported(cfg):
    db.migrate(cfg.db_path)
    counts = run(ARC, cfg)
    conn = db.connect(cfg.db_path)
    yield counts, conn
    conn.close()


def test_counts(imported):
    counts, conn = imported
    for table in ("projects", "tasks", "sources", "sessions", "notes", "events", "captures", "revisits", "days"):
        assert counts[table] > 0, table
        assert db.scalar(conn, f"SELECT count(*) FROM {table}") == counts[table]
    assert counts["sources.article"] == arc_rows("SELECT count(*) FROM articles")[0][0]
    assert counts["sources.book"] == arc_rows("SELECT count(*) FROM books")[0][0]
    assert counts["quotes"] == arc_rows("SELECT count(*) FROM quotes")[0][0]


def test_keys_preserved(imported):
    _, conn = imported
    arc = {f"{k}-{n}": t for k, n, t in arc_rows(
        """SELECT p.key, i.number, i.title FROM items i JOIN projects p ON p.id = i.project_id
           WHERE i.type IN ('task', 'note') AND p.deleted_at IS NULL""")}  # trash included, still deleted
    smriti = {r["key"]: r["title"] for r in db.all_rows(
        conn, "SELECT p.key || '-' || t.number AS key, t.title FROM tasks t JOIN projects p ON p.id = t.project_id")}
    assert smriti == arc
    for key, number in arc_rows("SELECT key, next_number FROM projects WHERE deleted_at IS NULL"):
        assert db.scalar(conn, "SELECT next_number FROM projects WHERE key = ?", (key,)) == number


def test_no_learning_tickets_duplicated(imported):
    _, conn = imported
    tickets = arc_rows("""SELECT i.title FROM items i WHERE i.id IN
                          (SELECT item_id FROM articles WHERE item_id IS NOT NULL
                           UNION SELECT item_id FROM books WHERE item_id IS NOT NULL)""")
    for (title,) in tickets:
        assert db.scalar(conn, "SELECT count(*) FROM tasks WHERE title = ?", (title,)) == 0
        assert db.scalar(conn, "SELECT count(*) FROM sources WHERE kind IN ('topic', 'video') AND title = ?",
                         (title,)) == 0
    learning = arc_rows("""SELECT count(*) FROM items WHERE type = 'learning' AND id NOT IN
                           (SELECT item_id FROM articles WHERE item_id IS NOT NULL
                            UNION SELECT item_id FROM books WHERE item_id IS NOT NULL)""")[0][0]
    assert db.scalar(conn, "SELECT count(*) FROM sources WHERE kind IN ('topic', 'video')") == learning
    # A ticket's time moved onto its book or article.
    ticket_min = arc_rows("""SELECT coalesce(sum(w.minutes), 0) FROM worklogs w JOIN items i ON i.id = w.item_id
                             WHERE i.deleted_at IS NULL AND i.id IN (SELECT item_id FROM books WHERE item_id IS NOT NULL
                             UNION SELECT item_id FROM articles WHERE item_id IS NOT NULL)""")[0][0]
    smriti_min = db.scalar(conn, """SELECT coalesce(sum(x.minutes), 0) FROM sessions x JOIN sources s ON s.id = x.source_id
                                  WHERE s.kind IN ('book', 'article')""")
    assert smriti_min == ticket_min


def test_times_are_utc_and_sessions_ended(imported):
    _, conn = imported
    assert db.scalar(conn, "SELECT count(*) FROM sessions WHERE ended_at IS NULL") == 0
    assert db.scalar(conn, "SELECT count(*) FROM sessions WHERE minutes < 1") == 0
    for stamp in (r[0] for r in conn.execute("SELECT created_at FROM tasks UNION SELECT started_at FROM sessions")):
        assert stamp.endswith("Z")


def test_import_runs_through_api_and_refuses_twice(imported, cfg):
    from fastapi.testclient import TestClient

    from smriti.main import create_app

    with TestClient(create_app(cfg)) as client:
        assert client.get("/api/today").status_code == 200
        assert client.get("/api/report/week").status_code == 200
        assert len(client.get("/api/projects").json()) > 0
        assert client.get("/api/search?q=observability").json()
    with pytest.raises(ImportRefused):
        run(ARC, cfg)


def test_arc_trash_lands_in_smriti_trash(imported):
    counts, conn = imported
    deleted = arc_rows("SELECT count(*) FROM items WHERE deleted_at IS NOT NULL AND type IN ('task', 'note')")[0][0]
    assert db.scalar(conn, "SELECT count(*) FROM tasks WHERE deleted_at IS NOT NULL") == deleted


def test_videos_get_thumbnails(imported):
    _, conn = imported
    missing = db.scalar(conn, "SELECT count(*) FROM sources WHERE kind = 'video' AND image IS NULL")
    assert missing == 0


def test_import_trash_is_safe_to_repeat(imported, cfg):
    from smriti.importer_arc import import_trash

    first = import_trash(ARC, cfg)
    assert first["tasks"] == 0 and first["sources"] == 0  # a full import already brought the trash across


def test_arc_obsidian_notes_are_linked(imported):
    _, conn = imported
    arc_notes = arc_rows("""SELECT (SELECT count(*) FROM items WHERE type = 'learning' AND obsidian_path IS NOT NULL)
                                 + (SELECT count(*) FROM articles WHERE obsidian_path IS NOT NULL)""")[0][0]
    assert db.scalar(conn, "SELECT count(*) FROM sources WHERE obsidian_path IS NOT NULL AND obsidian_key IS NOT NULL") == arc_notes
