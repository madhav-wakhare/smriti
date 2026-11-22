-- "Card" is renamed "Revisit" everywhere: the table, the columns that point at it, its indexes,
-- its search triggers and the kind stored in the search index.

DROP TRIGGER cards_search_ai;
DROP TRIGGER cards_search_au;
DROP TRIGGER cards_search_ad;
DROP INDEX cards_status;
DROP INDEX sessions_card;

ALTER TABLE cards RENAME TO revisits;
ALTER TABLE sessions RENAME COLUMN card_id TO revisit_id;
ALTER TABLE captures RENAME COLUMN card_id TO revisit_id;

CREATE INDEX revisits_status ON revisits (status, reviewed_at);
CREATE INDEX sessions_revisit ON sessions (revisit_id);

UPDATE search SET kind = 'revisit' WHERE kind = 'card';

CREATE TRIGGER revisits_search_ai AFTER INSERT ON revisits WHEN new.deleted_at IS NULL BEGIN
    INSERT INTO search (kind, ref_id, title, body)
        VALUES ('revisit', new.id, new.title, concat_ws(' ', new.prompt, new.body));
END;
CREATE TRIGGER revisits_search_au AFTER UPDATE OF title, prompt, body, deleted_at ON revisits BEGIN
    DELETE FROM search WHERE kind = 'revisit' AND ref_id = old.id;
    INSERT INTO search (kind, ref_id, title, body)
        SELECT 'revisit', new.id, new.title, concat_ws(' ', new.prompt, new.body) WHERE new.deleted_at IS NULL;
END;
CREATE TRIGGER revisits_search_ad AFTER DELETE ON revisits BEGIN
    DELETE FROM search WHERE kind = 'revisit' AND ref_id = old.id;
END;
