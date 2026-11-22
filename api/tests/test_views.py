from datetime import date, timedelta


def test_today_shape(client, make_task):
    today = client.get("/api/config").json()["today"]
    yesterday = (date.fromisoformat(today) - timedelta(days=1)).isoformat()
    planned = make_task(title="Planned", planned_on=today)
    make_task(title="Late", due_on=yesterday)
    make_task(title="Busy", status="doing")
    client.post("/api/captures", json={"text": "idea"})
    client.post("/api/revisits", json={"title": "revisit"})
    client.post("/api/sessions/start", json={"task_id": planned["id"]})
    client.post("/api/sessions/stop")
    client.patch(f"/api/tasks/{planned['id']}", json={"status": "done"})

    body = client.get("/api/today").json()
    assert set(body) == {"date", "planned", "overdue", "doing", "running", "open_captures", "revisits_due", "waiting",
                         "counts", "week"}
    assert body["date"] == today
    assert [t["title"] for t in body["planned"]] == ["Planned"]
    assert [t["title"] for t in body["overdue"]] == ["Late"]
    assert [t["title"] for t in body["doing"]] == ["Busy"]
    assert body["running"] is None and body["open_captures"] == 1 and len(body["revisits_due"]) == 1
    assert len(body["waiting"]) == 2
    assert body["counts"] == {"open": 2, "doing": 1, "overdue": 1, "logged_today_min": 1}
    assert body["week"] == {"done": 1, "logged_min": 1, "learning_min": 0}


def test_week_report_shape(client, make_task):
    task = make_task(title="Ship")
    source = client.post("/api/sources", json={"kind": "topic", "title": "Rust"}).json()
    revisit = client.post("/api/revisits", json={"title": "Borrowing"}).json()
    # Wednesday 2026-11-18, local time (Asia/Kolkata).
    for subject, minutes in (({"task_id": task["id"]}, 50), ({"source_id": source["id"]}, 20),
                             ({"revisit_id": revisit["id"]}, 5)):
        client.post("/api/sessions", json={**subject, "started_at": "2026-11-18T10:00:00", "minutes": minutes})
    # 00:30 on Monday 2026-11-16 in Kolkata is still Sunday in UTC; it belongs to this week.
    client.post("/api/sessions", json={"task_id": task["id"], "started_at": "2026-11-16T00:30:00", "minutes": 10})
    client.put("/api/days/2026-11-18", json={"went_well": "shipped", "blockers": "", "tomorrow": "rest"})
    client.put("/api/days/2026-11-19", json={"went_well": "", "blockers": "", "tomorrow": ""})

    body = client.get("/api/report/week?start=2026-11-18").json()  # snaps back to Monday
    assert body["start"] == "2026-11-16" and body["end"] == "2026-11-22"
    assert set(body) == {"start", "end", "days", "by_project", "done", "carried", "sources_done", "days_reviewed",
                         "totals"}
    assert len(body["days"]) == 7
    assert body["days"][0] == {"date": "2026-11-16", "task_min": 10, "source_min": 0, "revisit_min": 0}
    assert body["days"][2] == {"date": "2026-11-18", "task_min": 50, "source_min": 20, "revisit_min": 5}
    assert body["by_project"] == [{"project_key": "WORK", "name": "Work", "minutes": 60}]
    assert [d["date"] for d in body["days_reviewed"]] == ["2026-11-18"]
    assert body["totals"]["logged_min"] == 85 and body["totals"]["learning_min"] == 25
    assert set(body["totals"]) == {"done", "logged_min", "learning_min", "captures"}


def test_days(client):
    empty = client.get("/api/days/2026-11-01").json()
    assert empty == {"date": "2026-11-01", "went_well": "", "blockers": "", "tomorrow": "", "updated_at": None}
    saved = client.put("/api/days/2026-11-01", json={"went_well": "a", "blockers": "b", "tomorrow": "c"}).json()
    assert saved["went_well"] == "a" and saved["updated_at"]
    assert client.get("/api/days/not-a-date").status_code == 422


def test_search(client, make_task):
    make_task(title="Kafka consumer lag", body="partitions and offsets")
    client.post("/api/sources", json={"kind": "article", "title": "Kafka internals"})
    client.post("/api/revisits", json={"title": "Offsets", "prompt": "How does kafka commit offsets?"})
    cap = client.post("/api/captures", json={"text": "kafka connect?"}).json()

    results = client.get("/api/search?q=kafka").json()
    assert {r["kind"] for r in results} == {"task", "source", "revisit", "capture"}
    task = next(r for r in results if r["kind"] == "task")
    assert task["key"] == "WORK-1" and task["title"] == "Kafka consumer lag" and "snippet" in task
    assert [r["kind"] for r in client.get("/api/search?q=offs").json()] .count("revisit") == 1
    assert client.get("/api/search?q=WORK-1").json()[0]["key"] == "WORK-1"

    client.delete(f"/api/captures/{cap['id']}")
    assert "capture" not in {r["kind"] for r in client.get("/api/search?q=kafka").json()}
    assert client.get("/api/search?q=%22%29(*").json() == []


def test_trash_restore_and_purge(client, project, make_task):
    task = make_task(title="Old")
    source = client.post("/api/sources", json={"kind": "topic", "title": "Gone"}).json()
    client.delete(f"/api/tasks/{task['id']}")
    client.delete(f"/api/sources/{source['id']}")

    trash = client.get("/api/trash").json()
    assert {(i["kind"], i["id"]) for i in trash} == {("task", task["id"]), ("source", source["id"])}
    assert all(i["purge_on"] and i["deleted_at"] and i["title"] for i in trash)

    assert client.post(f"/api/trash/task/{task['id']}/restore").status_code == 200
    assert client.get(f"/api/tasks/{task['id']}").json()["title"] == "Old"
    assert client.get("/api/search?q=old").json()[0]["id"] == task["id"]

    assert client.delete(f"/api/trash/source/{source['id']}").status_code == 204
    assert client.get("/api/trash").json() == []
    assert client.delete(f"/api/trash/source/{source['id']}").status_code == 404
    assert client.delete(f"/api/trash/task/{task['id']}").status_code == 404  # not in the trash


def test_project_delete_takes_tasks_and_restores_them(client, project, make_task):
    task = make_task()
    client.delete(f"/api/projects/{project['id']}")
    assert client.get("/api/tasks").json() == []
    trash = client.get("/api/trash").json()
    assert [(i["kind"], i["id"]) for i in trash] == [("project", project["id"])]
    assert client.post(f"/api/trash/task/{task['id']}/restore").status_code == 409
    client.post(f"/api/trash/project/{project['id']}/restore")
    assert [t["id"] for t in client.get("/api/tasks").json()] == [task["id"]]
    client.delete(f"/api/projects/{project['id']}")
    assert client.delete(f"/api/trash/project/{project['id']}").status_code == 204
    assert client.get("/api/trash").json() == []


def test_purge_expired(client, cfg, make_task):
    import sqlite3

    from smriti import db
    from smriti.routes.trash import purge_expired

    task = make_task()
    client.delete(f"/api/tasks/{task['id']}")
    conn = sqlite3.connect(cfg.db_path)
    conn.execute("UPDATE tasks SET deleted_at = '2000-01-01T00:00:00Z'")
    conn.commit()
    conn.close()
    with db.session(cfg) as conn:
        assert purge_expired(conn, cfg) == 1
    assert client.get("/api/trash").json() == []
