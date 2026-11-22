def test_capture_keep_as_task_source_revisit(client, project):
    def capture(text, **extra):
        r = client.post("/api/captures", json={"text": text, **extra})
        assert r.status_code == 201
        return r.json()

    c1 = capture("Fix the flaky test", details="CI only", tags=["CI"])
    c2 = capture("Paged attention", url="https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    c3 = capture("Why does TCP need 3 steps?")
    c4 = capture("Never mind")
    assert c1["status"] == "open" and c1["tags"] == ["ci"]
    assert len(client.get("/api/captures").json()) == 4

    assert client.post(f"/api/captures/{c1['id']}/keep", json={"as": "task"}).status_code == 422
    kept = client.post(f"/api/captures/{c1['id']}/keep", json={"as": "task", "project_id": project["id"]}).json()
    assert kept["status"] == "kept" and kept["task_id"] and kept["sorted_at"]
    task = client.get(f"/api/tasks/{kept['task_id']}").json()
    assert task["title"] == "Fix the flaky test" and task["body"] == "CI only" and task["tags"] == ["ci"]
    assert client.post(f"/api/captures/{c1['id']}/keep", json={"as": "revisit"}).status_code == 409

    kept = client.post(f"/api/captures/{c2['id']}/keep", json={"as": "source"}).json()
    source = client.get(f"/api/sources/{kept['source_id']}").json()
    assert source["kind"] == "video" and source["title"] == "Paged attention" and source["status"] == "queued"

    kept = client.post(f"/api/captures/{c3['id']}/keep", json={"as": "revisit"}).json()
    assert client.get(f"/api/revisits/{kept['revisit_id']}").json()["title"] == "Why does TCP need 3 steps?"

    dismissed = client.post(f"/api/captures/{c4['id']}/dismiss").json()
    assert dismissed["status"] == "dismissed"
    assert client.get("/api/captures").json() == []
    assert len(client.get("/api/captures?status=kept").json()) == 3


def test_capture_patch_and_delete(client):
    c = client.post("/api/captures", json={"text": "x"}).json()
    c = client.patch(f"/api/captures/{c['id']}", json={"text": "y", "url": " "}).json()
    assert c["text"] == "y" and c["url"] is None
    assert client.delete(f"/api/captures/{c['id']}").status_code == 204
    assert client.get("/api/captures?status=all").json() == []
