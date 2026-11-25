import pytest
from fastapi.testclient import TestClient

from smriti import config
from smriti.main import create_app


@pytest.fixture
def vault(tmp_path):
    v = tmp_path / "vault"
    (v / ".obsidian").mkdir(parents=True)
    return v


@pytest.fixture
def vclient(tmp_path, vault):
    cfg = config.from_env({"SMRITI_DB_PATH": str(tmp_path / "v.db"), "SMRITI_STATIC_DIR": "", "SMRITI_LOOKUP": "off",
                           "TZ": "Asia/Kolkata", "SMRITI_VAULT_DIR": str(vault), "SMRITI_VAULT_PATH": "/Users/me/vault",
                           "SMRITI_OBSIDIAN_FOLDER": "learn", "SMRITI_OBSIDIAN_ARTICLES_FOLDER": "articles"})
    with TestClient(create_app(cfg)) as c:
        yield c


def test_status_without_vault(client):
    s = client.get("/api/obsidian").json()
    assert s["mounted"] is False and s["writable"] is False
    src = client.post("/api/sources", json={"kind": "topic", "title": "eBPF"}).json()
    r = client.post(f"/api/sources/{src['id']}/obsidian")
    assert r.status_code == 409 and r.json()["error"]["code"] == "vault_unavailable"


def test_export_writes_a_note(vclient, vault):
    assert vclient.get("/api/obsidian").json()["is_obsidian_vault"] is True
    src = vclient.post("/api/sources", json={"kind": "article", "title": "Tail sampling: a guide", "url": "https://example.com/t",
                                             "summary": "Why and how.", "body": "My notes.", "tags": ["tracing"]}).json()
    out = vclient.post(f"/api/sources/{src['id']}/obsidian").json()
    assert out["obsidian_path"] == "articles/Tail sampling a guide.md" and out["exported_at"]
    text = (vault / out["obsidian_path"]).read_text()
    assert f"smriti_id: SRC-{src['id']}" in text and '[Read the article](https://example.com/t)' in text
    assert "## Notes\n\nMy notes." in text and 'tags: ["tracing"]' in text


def test_edit_updates_note_and_rename_moves_it(vclient, vault):
    src = vclient.post("/api/sources", json={"kind": "topic", "title": "Raft"}).json()
    first = vclient.post(f"/api/sources/{src['id']}/obsidian").json()["obsidian_path"]
    vclient.patch(f"/api/sources/{src['id']}", json={"body": "Leader election notes"})
    assert "Leader election notes" in (vault / first).read_text()
    renamed = vclient.patch(f"/api/sources/{src['id']}", json={"title": "Raft consensus"}).json()
    assert renamed["obsidian_path"] == "learn/Raft consensus.md"
    assert not (vault / first).exists() and (vault / renamed["obsidian_path"]).exists()


def test_never_overwrites_someone_elses_note(vclient, vault):
    (vault / "learn").mkdir()
    (vault / "learn" / "CRDTs.md").write_text("my own hand-written note\n")
    src = vclient.post("/api/sources", json={"kind": "topic", "title": "CRDTs"}).json()
    out = vclient.post(f"/api/sources/{src['id']}/obsidian").json()
    assert out["obsidian_path"] == f"learn/CRDTs (SRC-{src['id']}).md"
    assert (vault / "learn" / "CRDTs.md").read_text() == "my own hand-written note\n"


def test_article_note_goes_to_its_collection_folder(vclient, vault):
    col = vclient.post("/api/collections", json={"name": "Inference engineering"}).json()
    src = vclient.post("/api/sources", json={"kind": "article", "title": "GPU Glossary", "url": "https://example.com/g"}).json()
    vclient.patch(f"/api/sources/{src['id']}", json={"collection_ids": [col["id"]]})
    out = vclient.post(f"/api/sources/{src['id']}/obsidian").json()
    assert out["obsidian_path"] == "articles/Inference engineering/GPU Glossary.md"
    assert 'collections: ["Inference engineering"]' in (vault / out["obsidian_path"]).read_text()
    vclient.patch(f"/api/collections/{col['id']}", json={"name": "Inference"})
    assert 'collections: ["Inference"]' in (vault / out["obsidian_path"]).read_text()  # note refreshed, file stays put


def test_new_sources_are_saved_on_their_own(vclient, vault):
    out = vclient.post("/api/sources", json={"kind": "topic", "title": "Raft"}).json()
    assert out["obsidian_path"] == "learn/Raft.md" and (vault / "learn/Raft.md").exists()
    cap = vclient.post("/api/captures", json={"text": "Paxos made simple"}).json()
    kept = vclient.post(f"/api/captures/{cap['id']}/keep", json={"as": "source", "kind": "topic"}).json()
    src = vclient.get(f"/api/sources/{kept['source_id']}").json()
    assert src["obsidian_path"] == "learn/Paxos made simple.md"


def test_auto_off_leaves_the_vault_alone(tmp_path, vault):
    cfg = config.from_env({"SMRITI_DB_PATH": str(tmp_path / "o.db"), "SMRITI_STATIC_DIR": "", "SMRITI_LOOKUP": "off",
                           "TZ": "Asia/Kolkata", "SMRITI_VAULT_DIR": str(vault), "SMRITI_VAULT_PATH": "/Users/me/vault",
                           "SMRITI_OBSIDIAN_FOLDER": "learn", "SMRITI_OBSIDIAN_AUTO": "off"})
    with TestClient(create_app(cfg)) as c:
        out = c.post("/api/sources", json={"kind": "topic", "title": "Raft"}).json()
    assert out["obsidian_path"] is None and not (vault / "learn").exists()


def test_start_saves_sources_added_while_the_vault_was_away(tmp_path, vault):
    db_path = str(tmp_path / "away.db")
    base = {"SMRITI_DB_PATH": db_path, "SMRITI_STATIC_DIR": "", "SMRITI_LOOKUP": "off", "TZ": "Asia/Kolkata"}
    with TestClient(create_app(config.from_env(base))) as c:  # no vault connected
        c.post("/api/sources", json={"kind": "book", "title": "Designing Data-Intensive Applications"})
    cfg = config.from_env({**base, "SMRITI_VAULT_DIR": str(vault), "SMRITI_VAULT_PATH": "/Users/me/vault",
                           "SMRITI_OBSIDIAN_FOLDER": "learn"})
    with TestClient(create_app(cfg)) as c:
        out = c.get("/api/sources").json()[0]
    assert out["obsidian_path"] == "learn/Designing Data-Intensive Applications.md"
