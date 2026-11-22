from smriti import __version__


def test_health_and_config(client):
    assert client.get("/api/health").json() == {"status": "ok", "version": __version__}
    body = client.get("/api/config").json()
    assert body["version"] == "1.0.0" and body["tz"] == "Asia/Kolkata" and body["trash_days"] == 30
    assert len(body["today"]) == 10


def test_error_shape(client):
    r = client.get("/api/tasks/999")
    assert r.status_code == 404
    assert r.json() == {"error": {"code": "not_found", "message": "Task not found"}}
    r = client.post("/api/tasks", json={"title": "no project"})
    assert r.status_code == 422 and r.json()["error"]["code"] == "invalid"
    assert client.get("/api/nope").json()["error"]["code"] == "not_found"


def test_projects(client, project):
    assert project["key"] == "WORK" and project["archived"] is False and project["open_count"] == 0
    assert client.post("/api/projects", json={"key": "WORK", "name": "Again"}).status_code == 409
    assert client.post("/api/projects", json={"key": "1x", "name": "Bad"}).status_code == 422
    r = client.patch(f"/api/projects/{project['id']}", json={"archived": True, "name": "Job"})
    assert r.json()["archived"] is True and r.json()["name"] == "Job"
    assert [p["key"] for p in client.get("/api/projects").json()] == ["WORK"]
