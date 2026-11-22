-- Quotes: short lines that keep you going, shown one at a time on Today.
CREATE TABLE quotes (
    id         INTEGER PRIMARY KEY,
    text       TEXT NOT NULL,
    author     TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
);
