def test_quote_crud(client):
    q = client.post("/api/quotes", json={"text": "  Well begun is half done. ", "author": "Aristotl"}).json()
    assert q["text"] == "Well begun is half done." and q["author"] == "Aristotl"
    assert [x["id"] for x in client.get("/api/quotes").json()] == [q["id"]]
    assert client.patch(f"/api/quotes/{q['id']}", json={"author": "Aristotle"}).json()["author"] == "Aristotle"
    assert client.delete(f"/api/quotes/{q['id']}").status_code == 204
    assert client.get("/api/quotes").json() == []
    assert client.delete(f"/api/quotes/{q['id']}").status_code == 404


def test_quote_needs_text(client):
    assert client.post("/api/quotes", json={"text": ""}).status_code == 422
