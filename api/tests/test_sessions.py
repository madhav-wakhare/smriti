import sqlite3

import pytest


def test_start_stop_and_one_running(client, make_task):
    a, b = make_task(title="a"), make_task(title="b")
    assert client.get("/api/sessions/running").json() is None

    first = client.post("/api/sessions/start", json={"task_id": a["id"]}).json()
    assert first["ended_at"] is None and first["subject"] == {"kind": "task", "id": a["id"], "label": "a",
                                                              "key": "WORK-1"}
    # Starting the same subject again keeps the running session.
    assert client.post("/api/sessions/start", json={"task_id": a["id"]}).json()["id"] == first["id"]

    second = client.post("/api/sessions/start", json={"task_id": b["id"]}).json()
    assert second["id"] != first["id"]
    sessions = {s["id"]: s for s in client.get("/api/sessions").json()}
    assert sessions[first["id"]]["minutes"] == 1 and sessions[first["id"]]["ended_at"]
    assert client.get("/api/sessions/running").json()["id"] == second["id"]

    stopped = client.post("/api/sessions/stop", json={"note": "done for now"}).json()
    assert stopped["minutes"] >= 1 and stopped["note"] == "done for now"
    assert client.post("/api/sessions/stop").json() is None
    assert client.get(f"/api/tasks/{a['id']}").json()["logged_min"] == 1


def test_database_allows_one_running(client, cfg, make_task):
    task = make_task()
    client.post("/api/sessions/start", json={"task_id": task["id"]})
    conn = sqlite3.connect(cfg.db_path)
    with pytest.raises(sqlite3.IntegrityError):
        conn.execute("INSERT INTO sessions (task_id, started_at) VALUES (?, '2026-01-01T00:00:00Z')", (task["id"],))
    conn.close()


def test_revisit_session_sets_reviewed_at(client):
    revisit = client.post("/api/revisits", json={"title": "TCP handshake", "prompt": "What are the steps?"}).json()
    assert revisit["reviewed_at"] is None and revisit["review_count"] == 0
    client.post("/api/sessions/start", json={"revisit_id": revisit["id"]})
    client.post("/api/sessions/stop")
    revisit = client.get(f"/api/revisits/{revisit['id']}").json()
    assert revisit["reviewed_at"] and revisit["review_count"] == 1 and len(revisit["sessions"]) == 1
    assert revisit["sessions"][0]["subject"]["kind"] == "revisit"


def test_manual_log_patch_delete(client, make_task):
    task = make_task()
    r = client.post("/api/sessions", json={"task_id": task["id"], "started_at": "2026-11-20T09:00:00+05:30",
                                           "minutes": 45, "note": "pairing"})
    assert r.status_code == 201
    s = r.json()
    assert s["started_at"] == "2026-11-20T03:30:00Z" and s["ended_at"] == "2026-11-20T04:15:00Z"
    s = client.patch(f"/api/sessions/{s['id']}", json={"minutes": 60}).json()
    assert s["ended_at"] == "2026-11-20T04:30:00Z"
    listed = client.get("/api/sessions?from=2026-11-20&to=2026-11-20").json()
    assert [x["id"] for x in listed] == [s["id"]]
    assert client.get("/api/sessions?from=2026-11-21&to=2026-11-21").json() == []
    assert client.post("/api/sessions", json={"task_id": task["id"], "revisit_id": 1, "started_at": "2026-11-20T09:00",
                                              "minutes": 5}).status_code == 422
    assert client.delete(f"/api/sessions/{s['id']}").status_code == 204


def test_deleting_subject_stops_timer(client, make_task):
    task = make_task()
    client.post("/api/sessions/start", json={"task_id": task["id"]})
    client.delete(f"/api/tasks/{task['id']}")
    assert client.get("/api/sessions/running").json() is None


def test_mark_revisit_reviewed_without_time(client):
    r = client.post("/api/revisits", json={"title": "TCP handshake"}).json()
    assert r["reviewed_at"] is None
    out = client.post(f"/api/revisits/{r['id']}/reviewed").json()
    assert out["reviewed_at"] and out["logged_min"] == 0
