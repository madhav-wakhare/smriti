-- Tasks can be saved to Obsidian too: same columns as sources (note path, the id inside the note, last write).
ALTER TABLE tasks ADD COLUMN obsidian_path TEXT;
ALTER TABLE tasks ADD COLUMN obsidian_key TEXT;
ALTER TABLE tasks ADD COLUMN exported_at TEXT;
