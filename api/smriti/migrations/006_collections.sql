-- Collections: named groups (AI, SRE, Databases...) to keep sources organised, as Arc had for articles.
-- A source can sit in several collections; deleting a collection leaves its sources alone.
CREATE TABLE collections (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
    created_at TEXT NOT NULL
);
CREATE TABLE source_collections (
    source_id     INTEGER NOT NULL REFERENCES sources ON DELETE CASCADE,
    collection_id INTEGER NOT NULL REFERENCES collections ON DELETE CASCADE,
    added_at      TEXT NOT NULL,
    PRIMARY KEY (source_id, collection_id)
);
CREATE INDEX source_collections_collection ON source_collections (collection_id);
