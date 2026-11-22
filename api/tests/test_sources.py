def test_source_status_rules(client):
    book = client.post("/api/sources", json={"kind": "book", "title": "The Phoenix Project", "total": 345,
                                             "progress": 10}).json()
    assert book["status"] == "queued" and book["started_at"] is None and book["done_at"] is None

    active = client.patch(f"/api/sources/{book['id']}", json={"status": "active"}).json()
    assert active["started_at"]
    again = client.patch(f"/api/sources/{book['id']}", json={"status": "queued"}).json()
    again = client.patch(f"/api/sources/{book['id']}", json={"status": "active"}).json()
    assert again["started_at"] == active["started_at"]  # set once

    done = client.patch(f"/api/sources/{book['id']}", json={"status": "done"}).json()
    assert done["done_at"] and done["progress"] == 345
    reopened = client.patch(f"/api/sources/{book['id']}", json={"status": "active"}).json()
    assert reopened["done_at"] is None

    events = client.get(f"/api/sources/{book['id']}").json()["events"]
    assert {e["new"] for e in events if e["field"] == "status"} == {"active", "queued", "done"}


def test_article_done_keeps_progress(client):
    a = client.post("/api/sources", json={"kind": "article", "title": "Notes", "total": 10}).json()
    assert client.patch(f"/api/sources/{a['id']}", json={"status": "done"}).json()["progress"] == 0


def test_source_from_url_without_lookup(client):
    r = client.post("/api/sources", json={"kind": "article", "url": "https://www.example.com/post"})
    assert r.status_code == 201
    s = r.json()
    assert s["title"] == "example.com" and s["site"] == "example.com"
    assert client.post("/api/sources", json={"kind": "topic"}).status_code == 422


def test_source_full_and_filters(client):
    s = client.post("/api/sources", json={"kind": "topic", "title": "vLLM", "tags": ["AI"]}).json()
    client.post("/api/notes", json={"source_id": s["id"], "body": "read the paper"})
    client.post("/api/revisits", json={"title": "KV cache", "source_id": s["id"]})
    client.post("/api/sessions", json={"source_id": s["id"], "started_at": "2026-11-20T10:00:00Z", "minutes": 30})
    full = client.get(f"/api/sources/{s['id']}").json()
    assert len(full["notes"]) == 1 and len(full["revisits"]) == 1 and full["logged_min"] == 30
    assert len(full["sessions"]) == 1
    assert [x["title"] for x in client.get("/api/sources?tag=ai").json()] == ["vLLM"]
    assert client.get("/api/sources?kind=book").json() == []
    assert len(client.get("/api/sources?q=vll").json()) == 1


def test_lookup_off(client):
    r = client.post("/api/lookup/link", json={"url": "https://youtu.be/dQw4w9WgXcQ"})
    assert r.json()["kind"] == "video" and r.json()["site"] == "YouTube"
    r = client.get("/api/lookup/books?q=phoenix")
    assert r.status_code == 503 and r.json()["error"]["code"] == "lookup_off"
