-- Smriti schema, version 1 (SPEC section 2).
-- Timestamps: ISO-8601 UTC text with Z. Plain dates: YYYY-MM-DD in the user's time zone.

CREATE TABLE projects (
    id          INTEGER PRIMARY KEY,
    key         TEXT UNIQUE NOT NULL,
    name        TEXT NOT NULL,
    next_number INTEGER NOT NULL DEFAULT 1,
    archived    INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT,
    deleted_at  TEXT
);

CREATE TABLE tasks (
    id           INTEGER PRIMARY KEY,
    project_id   INTEGER NOT NULL REFERENCES projects,
    number       INTEGER NOT NULL,
    parent_id    INTEGER REFERENCES tasks ON DELETE SET NULL,
    title        TEXT NOT NULL,
    body         TEXT NOT NULL DEFAULT '',
    status       TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'doing', 'done')),
    priority     INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
    planned_on   TEXT,
    due_on       TEXT,
    estimate_min INTEGER,
    repeat       TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none', 'daily', 'weekdays', 'weekly', 'monthly')),
    tags         TEXT NOT NULL DEFAULT '[]',
    url          TEXT,
    position     REAL NOT NULL DEFAULT 0,
    created_at   TEXT,
    updated_at   TEXT,
    status_at    TEXT,
    done_at      TEXT,
    deleted_at   TEXT,
    UNIQUE (project_id, number)
);
CREATE INDEX tasks_status ON tasks (status, position);
CREATE INDEX tasks_planned ON tasks (planned_on);
CREATE INDEX tasks_parent ON tasks (parent_id);
CREATE INDEX tasks_done ON tasks (done_at);

CREATE TABLE checks (
    id       INTEGER PRIMARY KEY,
    task_id  INTEGER NOT NULL REFERENCES tasks ON DELETE CASCADE,
    title    TEXT NOT NULL,
    done     INTEGER NOT NULL DEFAULT 0,
    position REAL NOT NULL DEFAULT 0
);
CREATE INDEX checks_task ON checks (task_id);

CREATE TABLE sources (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('topic', 'article', 'book', 'video')),
    title      TEXT NOT NULL,
    url        TEXT,
    author     TEXT NOT NULL DEFAULT '',
    site       TEXT NOT NULL DEFAULT '',
    image      TEXT,
    summary    TEXT NOT NULL DEFAULT '',
    body       TEXT NOT NULL DEFAULT '',
    status     TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'active', 'done')),
    progress   INTEGER NOT NULL DEFAULT 0,
    total      INTEGER,
    tags       TEXT NOT NULL DEFAULT '[]',
    ref        TEXT,
    created_at TEXT,
    updated_at TEXT,
    started_at TEXT,
    done_at    TEXT,
    deleted_at TEXT
);
CREATE INDEX sources_status ON sources (status);

CREATE TABLE cards (
    id          INTEGER PRIMARY KEY,
    title       TEXT NOT NULL,
    prompt      TEXT NOT NULL DEFAULT '',
    body        TEXT NOT NULL DEFAULT '',
    url         TEXT,
    priority    INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
    status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'retired')),
    task_id     INTEGER REFERENCES tasks ON DELETE SET NULL,
    source_id   INTEGER REFERENCES sources ON DELETE SET NULL,
    created_at  TEXT,
    updated_at  TEXT,
    reviewed_at TEXT,
    retired_at  TEXT,
    deleted_at  TEXT
);
CREATE INDEX cards_status ON cards (status, reviewed_at);

CREATE TABLE captures (
    id         INTEGER PRIMARY KEY,
    text       TEXT NOT NULL,
    details    TEXT NOT NULL DEFAULT '',
    url        TEXT,
    tags       TEXT NOT NULL DEFAULT '[]',
    status     TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'kept', 'dismissed')),
    task_id    INTEGER REFERENCES tasks ON DELETE SET NULL,
    source_id  INTEGER REFERENCES sources ON DELETE SET NULL,
    card_id    INTEGER REFERENCES cards ON DELETE SET NULL,
    created_at TEXT,
    sorted_at  TEXT,
    deleted_at TEXT
);
CREATE INDEX captures_status ON captures (status);

CREATE TABLE sessions (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER REFERENCES tasks ON DELETE CASCADE,
    source_id  INTEGER REFERENCES sources ON DELETE CASCADE,
    card_id    INTEGER REFERENCES cards ON DELETE CASCADE,
    started_at TEXT NOT NULL,
    ended_at   TEXT,
    minutes    INTEGER CHECK (minutes IS NULL OR minutes >= 1),
    note       TEXT NOT NULL DEFAULT '',
    created_at TEXT,
    CHECK ((task_id IS NOT NULL) + (source_id IS NOT NULL) + (card_id IS NOT NULL) = 1)
);
-- At most one running session.
CREATE UNIQUE INDEX one_running ON sessions ((1)) WHERE ended_at IS NULL;
CREATE INDEX sessions_started ON sessions (started_at);
CREATE INDEX sessions_task ON sessions (task_id);
CREATE INDEX sessions_source ON sessions (source_id);
CREATE INDEX sessions_card ON sessions (card_id);

CREATE TABLE notes (
    id         INTEGER PRIMARY KEY,
    task_id    INTEGER REFERENCES tasks ON DELETE CASCADE,
    source_id  INTEGER REFERENCES sources ON DELETE CASCADE,
    body       TEXT NOT NULL,
    created_at TEXT,
    edited_at  TEXT,
    CHECK ((task_id IS NOT NULL) + (source_id IS NOT NULL) = 1)
);
CREATE INDEX notes_task ON notes (task_id);
CREATE INDEX notes_source ON notes (source_id);

CREATE TABLE events (
    id        INTEGER PRIMARY KEY,
    task_id   INTEGER REFERENCES tasks ON DELETE CASCADE,
    source_id INTEGER REFERENCES sources ON DELETE CASCADE,
    field     TEXT NOT NULL,
    old       TEXT,
    new       TEXT,
    at        TEXT NOT NULL
);
CREATE INDEX events_task ON events (task_id);
CREATE INDEX events_source ON events (source_id);

CREATE TABLE days (
    date       TEXT PRIMARY KEY,
    went_well  TEXT NOT NULL DEFAULT '',
    blockers   TEXT NOT NULL DEFAULT '',
    tomorrow   TEXT NOT NULL DEFAULT '',
    updated_at TEXT
);

-- Full-text search over live (not deleted) tasks, sources, cards and captures.
CREATE VIRTUAL TABLE search USING fts5 (kind, ref_id UNINDEXED, title, body);

CREATE TRIGGER tasks_search_ai AFTER INSERT ON tasks WHEN new.deleted_at IS NULL BEGIN
    INSERT INTO search (kind, ref_id, title, body) VALUES ('task', new.id, new.title, new.body);
END;
CREATE TRIGGER tasks_search_au AFTER UPDATE OF title, body, deleted_at ON tasks BEGIN
    DELETE FROM search WHERE kind = 'task' AND ref_id = old.id;
    INSERT INTO search (kind, ref_id, title, body)
        SELECT 'task', new.id, new.title, new.body WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER tasks_search_ad AFTER DELETE ON tasks BEGIN
    DELETE FROM search WHERE kind = 'task' AND ref_id = old.id;
END;

CREATE TRIGGER sources_search_ai AFTER INSERT ON sources WHEN new.deleted_at IS NULL BEGIN
    INSERT INTO search (kind, ref_id, title, body)
        VALUES ('source', new.id, new.title, concat_ws(' ', new.author, new.summary, new.body));
END;
CREATE TRIGGER sources_search_au AFTER UPDATE OF title, author, summary, body, deleted_at ON sources BEGIN
    DELETE FROM search WHERE kind = 'source' AND ref_id = old.id;
    INSERT INTO search (kind, ref_id, title, body)
        SELECT 'source', new.id, new.title, concat_ws(' ', new.author, new.summary, new.body)
        WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER sources_search_ad AFTER DELETE ON sources BEGIN
    DELETE FROM search WHERE kind = 'source' AND ref_id = old.id;
END;

CREATE TRIGGER cards_search_ai AFTER INSERT ON cards WHEN new.deleted_at IS NULL BEGIN
    INSERT INTO search (kind, ref_id, title, body)
        VALUES ('card', new.id, new.title, concat_ws(' ', new.prompt, new.body));
END;
CREATE TRIGGER cards_search_au AFTER UPDATE OF title, prompt, body, deleted_at ON cards BEGIN
    DELETE FROM search WHERE kind = 'card' AND ref_id = old.id;
    INSERT INTO search (kind, ref_id, title, body)
        SELECT 'card', new.id, new.title, concat_ws(' ', new.prompt, new.body) WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER cards_search_ad AFTER DELETE ON cards BEGIN
    DELETE FROM search WHERE kind = 'card' AND ref_id = old.id;
END;

CREATE TRIGGER captures_search_ai AFTER INSERT ON captures WHEN new.deleted_at IS NULL BEGIN
    INSERT INTO search (kind, ref_id, title, body) VALUES ('capture', new.id, new.text, new.details);
END;
CREATE TRIGGER captures_search_au AFTER UPDATE OF text, details, deleted_at ON captures BEGIN
    DELETE FROM search WHERE kind = 'capture' AND ref_id = old.id;
    INSERT INTO search (kind, ref_id, title, body)
        SELECT 'capture', new.id, new.text, new.details WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER captures_search_ad AFTER DELETE ON captures BEGIN
    DELETE FROM search WHERE kind = 'capture' AND ref_id = old.id;
END;
