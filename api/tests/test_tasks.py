from datetime import date, timedelta


def test_task_crud_and_events(client, project, make_task):
    task = make_task(title="Write spec", priority=2, tags=["Work", "work", " Docs "])
    assert task["key"] == "WORK-1" and task["project_key"] == "WORK"
    assert task["tags"] == ["work", "docs"] and task["status"] == "todo" and task["done_at"] is None
    assert task["logged_min"] == 0 and task["checks_total"] == 0 and task["children"] == 0

    r = client.patch(f"/api/tasks/{task['id']}", json={"title": "Write the spec", "priority": 3,
                                                       "due_on": "2026-12-01", "body": "markdown"})
    assert r.status_code == 200
    assert r.json()["title"] == "Write the spec" and r.json()["due_on"] == "2026-12-01"

    full = client.get(f"/api/tasks/{task['id']}").json()
    fields = {e["field"] for e in full["events"]}
    assert {"created", "title", "priority", "due_on"} <= fields and "body" not in fields
    for key in ("checks", "notes", "sessions", "events", "subtasks"):
        assert isinstance(full[key], list)

    assert client.delete(f"/api/tasks/{task['id']}").status_code == 204
    assert client.get(f"/api/tasks/{task['id']}").status_code == 404
    assert client.get("/api/tasks").json() == []


def test_done_sets_and_clears_done_at(client, make_task):
    task = make_task()
    done = client.patch(f"/api/tasks/{task['id']}", json={"status": "done"}).json()
    assert done["done_at"] and done["status_at"]
    back = client.patch(f"/api/tasks/{task['id']}", json={"status": "doing"}).json()
    assert back["done_at"] is None


def test_subtasks_checks_and_notes(client, make_task):
    parent = make_task(title="Parent")
    child = make_task(title="Child", parent_id=parent["id"])
    assert child["parent_key"] == "WORK-1"
    assert client.patch(f"/api/tasks/{parent['id']}", json={"parent_id": child["id"]}).status_code == 422

    check = client.post(f"/api/tasks/{parent['id']}/checks", json={"title": "step"}).json()
    assert check["done"] is False
    assert client.patch(f"/api/checks/{check['id']}", json={"done": True}).json()["done"] is True
    note = client.post("/api/notes", json={"task_id": parent["id"], "body": "hello"}).json()
    assert client.patch(f"/api/notes/{note['id']}", json={"body": "edited"}).json()["edited_at"]

    full = client.get(f"/api/tasks/{parent['id']}").json()
    assert full["checks_done"] == 1 and full["checks_total"] == 1 and full["children"] == 1
    assert [t["key"] for t in full["subtasks"]] == ["WORK-2"] and full["notes"][0]["body"] == "edited"
    assert client.delete(f"/api/checks/{check['id']}").status_code == 204
    assert client.delete(f"/api/notes/{note['id']}").status_code == 204


def test_move_between_neighbours(client, make_task):
    a, b, c = make_task(title="a"), make_task(title="b"), make_task(title="c")
    moved = client.post(f"/api/tasks/{c['id']}/move", json={"status": "todo", "before_id": a["id"]}).json()
    assert moved["position"] < a["position"]
    order = [t["title"] for t in client.get("/api/tasks?status=todo").json()]
    assert order == ["c", "a", "b"]

    client.post(f"/api/tasks/{c['id']}/move", json={"status": "todo", "after_id": a["id"]})
    assert [t["title"] for t in client.get("/api/tasks?status=todo").json()] == ["a", "c", "b"]

    doing = client.post(f"/api/tasks/{b['id']}/move", json={"status": "doing"}).json()
    assert doing["status"] == "doing"
    done = client.post(f"/api/tasks/{a['id']}/move", json={"status": "done"}).json()
    assert done["done_at"]
    assert client.post(f"/api/tasks/{a['id']}/move",
                       json={"status": "todo", "before_id": b["id"], "after_id": c["id"]}).status_code == 422


def test_move_renumbers_when_gap_closes(client, make_task):
    a, b = make_task(title="a"), make_task(title="b")
    names = []
    for n in range(40):  # each new task goes just before b, halving the gap every time
        t = make_task(title=f"t{n}")
        client.post(f"/api/tasks/{t['id']}/move", json={"status": "todo", "before_id": b["id"]})
        names.append(f"t{n}")
    assert [t["title"] for t in client.get("/api/tasks?status=todo").json()] == ["a", *names, "b"]


def test_repeat_on_done(client, make_task):
    today = date.fromisoformat(client.get("/api/config").json()["today"])
    task = make_task(title="Standup", repeat="daily", planned_on=today.isoformat())
    client.post(f"/api/tasks/{task['id']}/checks", json={"title": "notes"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})

    tasks = client.get("/api/tasks").json()
    copy = next(t for t in tasks if t["id"] != task["id"])
    assert copy["title"] == "Standup" and copy["status"] == "todo" and copy["repeat"] == "daily"
    assert copy["planned_on"] == (today + timedelta(days=1)).isoformat()
    assert copy["key"] == "WORK-2" and copy["checks_total"] == 1

    # Done -> todo -> done again must not make a second copy.
    client.patch(f"/api/tasks/{task['id']}", json={"status": "todo"})
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    assert len(client.get("/api/tasks").json()) == 2


def test_repeat_weekly_keeps_cadence(client, make_task):
    today = date.fromisoformat(client.get("/api/config").json()["today"])
    start = today - timedelta(days=10)
    task = make_task(title="Review", repeat="weekly", planned_on=start.isoformat())
    client.patch(f"/api/tasks/{task['id']}", json={"status": "done"})
    copy = next(t for t in client.get("/api/tasks").json() if t["id"] != task["id"])
    planned = date.fromisoformat(copy["planned_on"])
    assert planned > today and planned.weekday() == start.weekday()


def test_filters(client, project, make_task):
    make_task(title="Alpha", tags=["x"], planned_on="2026-01-02")
    make_task(title="Beta", status="doing")
    assert [t["title"] for t in client.get("/api/tasks?tag=x").json()] == ["Alpha"]
    assert [t["title"] for t in client.get("/api/tasks?status=doing").json()] == ["Beta"]
    assert [t["title"] for t in client.get("/api/tasks?q=alp").json()] == ["Alpha"]
    assert [t["title"] for t in client.get("/api/tasks?planned_on=2026-01-02").json()] == ["Alpha"]
    assert len(client.get(f"/api/tasks?project_id={project['id']}").json()) == 2
    assert client.get("/api/projects").json()[0]["open_count"] == 2


def test_change_project_gives_new_key(client, make_task):
    other = client.post("/api/projects", json={"key": "HOME", "name": "Home"}).json()
    task = make_task()
    moved = client.patch(f"/api/tasks/{task['id']}", json={"project_id": other["id"]}).json()
    assert moved["key"] == "HOME-1"
    events = client.get(f"/api/tasks/{task['id']}").json()["events"]
    assert any(e["field"] == "project" and e["old"] == "WORK" and e["new"] == "HOME" for e in events)
