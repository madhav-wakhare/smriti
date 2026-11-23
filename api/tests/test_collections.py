"""Collections keep sources organised: create, rename, delete, file sources in them, filter by them."""


def test_collections_crud_and_membership(client):
    ai = client.post("/api/collections", json={"name": "  AI   infra "}).json()
    assert ai["name"] == "AI infra" and ai["count"] == 0
    assert client.post("/api/collections", json={"name": "ai INFRA"}).status_code == 409
    sre = client.post("/api/collections", json={"name": "SRE"}).json()
    src = client.post("/api/sources", json={"kind": "article", "title": "Tail sampling"}).json()
    assert src["collections"] == []

    out = client.patch(f"/api/sources/{src['id']}", json={"collection_ids": [sre["id"], ai["id"]]}).json()
    assert [c["name"] for c in out["collections"]] == ["AI infra", "SRE"]
    assert [s["id"] for s in client.get(f"/api/sources?collection_id={sre['id']}").json()] == [src["id"]]
    assert {c["name"]: c["count"] for c in client.get("/api/collections").json()} == {"AI infra": 1, "SRE": 1}

    out = client.delete(f"/api/collections/{ai['id']}/sources/{src['id']}").json()
    assert [c["name"] for c in out["collections"]] == ["SRE"]
    out = client.post(f"/api/collections/{ai['id']}/sources", json={"source_id": src["id"]}).json()
    assert len(out["collections"]) == 2

    assert client.patch(f"/api/collections/{sre['id']}", json={"name": "Reliability"}).json()["name"] == "Reliability"
    assert client.delete(f"/api/collections/{ai['id']}").status_code == 204
    left = client.get(f"/api/sources/{src['id']}").json()
    assert [c["name"] for c in left["collections"]] == ["Reliability"]  # the source stays


def test_unknown_collection_is_refused(client):
    src = client.post("/api/sources", json={"kind": "topic", "title": "eBPF"}).json()
    assert client.patch(f"/api/sources/{src['id']}", json={"collection_ids": [999]}).status_code == 422
