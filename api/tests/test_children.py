"""Child tasks, Jira style: chains, progress, closing and deleting with children, and the trash."""


def test_chain_breadcrumb_and_progress(client, make_task):
    epic = make_task(title="Launch tracing")
    story = make_task(title="Instrument checkout", parent_id=epic["id"])
    sub1 = make_task(title="Add spans", parent_id=story["id"])
    make_task(title="Add sampling", parent_id=story["id"])
    client.patch(f"/api/tasks/{sub1['id']}", json={"status": "done"})

    s = client.get(f"/api/tasks/{story['id']}").json()
    assert [a["id"] for a in s["ancestors"]] == [epic["id"]]
    assert s["children"] == 2 and s["children_done"] == 1 and len(s["subtasks"]) == 2
    leaf = client.get(f"/api/tasks/{sub1['id']}").json()
    assert [a["title"] for a in leaf["ancestors"]] == ["Launch tracing", "Instrument checkout"]
    assert client.get(f"/api/tasks/{epic['id']}").json()["open_descendants"] == 2


def test_no_loops_and_unlink(client, make_task):
    a = make_task(title="A")
    b = make_task(title="B", parent_id=a["id"])
    c = make_task(title="C", parent_id=b["id"])
    assert client.patch(f"/api/tasks/{a['id']}", json={"parent_id": c["id"]}).status_code == 422
    assert client.patch(f"/api/tasks/{a['id']}", json={"parent_id": a["id"]}).status_code == 422
    moved = client.patch(f"/api/tasks/{c['id']}", json={"parent_id": a["id"]}).json()
    assert moved["parent_id"] == a["id"]
    events = client.get(f"/api/tasks/{c['id']}").json()["events"]
    assert any(e["field"] == "parent" and e["old"] == b["key"] and e["new"] == a["key"] for e in events)
    assert client.patch(f"/api/tasks/{c['id']}", json={"parent_id": None}).json()["parent_id"] is None


def test_depth_limit(client, make_task):
    parent = make_task(title="L1")
    for n in range(2, 11):
        parent = make_task(title=f"L{n}", parent_id=parent["id"])
    r = client.post("/api/tasks", json={"project_id": parent["project_id"], "title": "L11", "parent_id": parent["id"]})
    assert r.status_code == 422


def test_close_with_children(client, make_task):
    p = make_task(title="Parent")
    c = make_task(title="Child", parent_id=p["id"])
    g = make_task(title="Grandchild", parent_id=c["id"])
    client.patch(f"/api/tasks/{p['id']}", json={"status": "done", "close_children": True})
    assert client.get(f"/api/tasks/{c['id']}").json()["status"] == "done"
    assert client.get(f"/api/tasks/{g['id']}").json()["status"] == "done"
    q = make_task(title="Other parent")
    k = make_task(title="Its child", parent_id=q["id"])
    client.patch(f"/api/tasks/{q['id']}", json={"status": "done"})
    assert client.get(f"/api/tasks/{k['id']}").json()["status"] == "todo"


def test_delete_takes_children_and_restore_brings_them_back(client, make_task):
    p = make_task(title="Parent")
    c = make_task(title="Child", parent_id=p["id"])
    g = make_task(title="Grandchild", parent_id=c["id"])
    assert client.delete(f"/api/tasks/{p['id']}").status_code == 204
    assert client.get(f"/api/tasks/{g['id']}").status_code == 404
    trash = client.get("/api/trash").json()
    assert [t["title"] for t in trash if t["kind"] == "task"] == ["Parent"]  # children are listed with it
    assert client.post(f"/api/trash/task/{c['id']}/restore").status_code == 409
    client.post(f"/api/trash/task/{p['id']}/restore")
    assert client.get(f"/api/tasks/{g['id']}").json()["parent_id"] == c["id"]


def test_purging_a_parent_purges_its_children(client, make_task):
    p = make_task(title="Parent")
    c = make_task(title="Child", parent_id=p["id"])
    client.delete(f"/api/tasks/{p['id']}")
    client.delete(f"/api/trash/task/{p['id']}")
    assert client.post(f"/api/trash/task/{c['id']}/restore").status_code == 404


def test_child_deleted_alone_restores_alone(client, make_task):
    p = make_task(title="Parent")
    c = make_task(title="Child", parent_id=p["id"])
    client.delete(f"/api/tasks/{c['id']}")
    assert client.get(f"/api/tasks/{p['id']}").json()["children"] == 0
    assert client.post(f"/api/trash/task/{c['id']}/restore").status_code == 200
    assert client.get(f"/api/tasks/{p['id']}").json()["children"] == 1
