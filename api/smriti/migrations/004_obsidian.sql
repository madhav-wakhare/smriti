-- Obsidian export: where a source's note lives in the vault (relative path), the id written into the
-- note so Smriti recognises its own notes (Arc's key for notes Arc wrote), and when it was last written.
ALTER TABLE sources ADD COLUMN obsidian_path TEXT;
ALTER TABLE sources ADD COLUMN obsidian_key TEXT;
ALTER TABLE sources ADD COLUMN exported_at TEXT;
