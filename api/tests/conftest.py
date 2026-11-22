import pytest
from fastapi.testclient import TestClient

from smriti import config
from smriti.main import create_app


@pytest.fixture
def cfg(tmp_path):
    return config.from_env({"SMRITI_DB_PATH": str(tmp_path / "smriti.db"), "SMRITI_STATIC_DIR": "",
                            "SMRITI_LOOKUP": "off", "TZ": "Asia/Kolkata", "SMRITI_TRASH_DAYS": "30",
                            "SMRITI_VAULT_DIR": str(tmp_path / "no-vault")})


@pytest.fixture
def client(cfg):
    with TestClient(create_app(cfg)) as c:
        yield c


@pytest.fixture
def project(client):
    r = client.post("/api/projects", json={"key": "work", "name": "Work"})
    assert r.status_code == 201, r.text
    return r.json()


@pytest.fixture
def make_task(client, project):
    def make(**fields):
        r = client.post("/api/tasks", json={"project_id": project["id"], "title": "A task", **fields})
        assert r.status_code == 201, r.text
        return r.json()
    return make
