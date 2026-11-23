"""Import an Arc database into an empty Smriti database (SPEC section 6).

Arc stored naive timestamps in its local time zone; they are read as local time (TZ) and stored as UTC.
Items in Arc's trash come across too, still deleted (deleted_at kept), so they land in Smriti's trash.
Everything happens in one transaction on the Smriti side; the Arc file is opened read-only.
"""

import sqlite3
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

from . import clock, db, lookup
from .config import Config

TASK_STATUS = {"backlog": "todo", "today": "todo", "in_progress": "doing", "done": "done"}
TOPIC_STATUS = {"backlog": "queued", "today": "active", "in_progress": "active", "done": "done"}
ARTICLE_STATUS = {"unread": "queued", "reading": "active", "read": "done"}
BOOK_STATUS = {"want": "queued", "reading": "active", "finished": "done"}
JOT_STATUS = {"open": "open", "converted": "kept", "archived": "dismissed"}
REVISIT_STATUS = {"active": "active", "revised": "retired"}
PRIORITY = {"none": 0, "low": 1, "medium": 2, "high": 3, "urgent": 4}
# Arc history field names in Smriti words; fields not listed keep their name, None means skip.
EVENT_FIELD = {"due_date": "due_on", "estimate_minutes": "estimate_min", "labels": "tags",
               "description": "body", "project_id": "project", "obsidian": None}
SMRITI_TABLES = ("projects", "tasks", "sources", "captures", "revisits", "sessions", "notes", "days")


class ImportRefused(Exception):
    pass


def open_arc(path: str) -> sqlite3.Connection:
    """Read-only. A WAL database on a read-only mount may need immutable mode to open at all."""
    if not Path(path).is_file():
        raise ImportRefused(f"{path} is not a file")
    uri = Path(path).resolve().as_uri()
    for suffix in ("?mode=ro", "?mode=ro&immutable=1"):
        try:
            conn = sqlite3.connect(uri + suffix, uri=True)
            conn.row_factory = sqlite3.Row
            conn.execute("SELECT count(*) FROM items").fetchone()
            return conn
        except sqlite3.DatabaseError as exc:
            error = exc
    raise ImportRefused(f"cannot read {path} as an Arc database ({error})")


class ArcImport:
    def __init__(self, arc: sqlite3.Connection, smriti: sqlite3.Connection, cfg: Config, scope: str = "all"):
        self.arc, self.smriti, self.cfg = arc, smriti, cfg
        # "all": everything, Arc's trash included. "trash": only Arc's deleted items, for a Smriti database
        # imported before trash came across (see import_trash).
        self.scope = scope
        self.zone = cfg.zone
        self.today = clock.today(self.zone).isoformat()
        self.counts: Counter = Counter()
        self.task_ids: dict[int, int] = {}    # Arc item id -> Smriti task id
        self.source_ids: dict[int, int] = {}  # Arc item id (topic or ticket) -> Smriti source id
        self.revisit_ids: dict[int, int] = {}    # Arc revision id -> Smriti revisit id

    # ------------------------------------------------------------ helpers

    def rows(self, sql: str, args: tuple = ()) -> list[dict]:
        return [dict(r) for r in self.arc.execute(sql, args)]

    def has_column(self, table: str, column: str) -> bool:
        return any(r["name"] == column for r in self.arc.execute(f"PRAGMA table_info({table})"))

    def utc(self, stamp: str | None) -> str | None:
        """An Arc timestamp (naive local time) as a Smriti UTC stamp."""
        if not stamp:
            return None
        moment = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
        if moment.tzinfo is None:
            moment = moment.replace(tzinfo=self.zone)
        return clock.to_iso(moment)

    def insert(self, table: str, values: dict) -> int:
        self.counts[table] += 1
        return db.insert(self.smriti, table, values)

    def subject(self, item_id: int) -> tuple[str, int] | None:
        """Where an Arc item's worklogs, comments and history land in Smriti."""
        if item_id in self.task_ids:
            return "task_id", self.task_ids[item_id]
        if item_id in self.source_ids:
            return "source_id", self.source_ids[item_id]
        return None

    @staticmethod
    def tags(raw: str | None, extra: list[str] = ()) -> str:
        return db.tags_in(db.tags_out(raw) + list(extra))

    # ------------------------------------------------------------ steps

    def run(self) -> dict:
        self.projects()
        tickets = self.ticket_items()
        self.tasks()
        self.topics(tickets)
        self.collections()
        self.articles()
        self.books()
        self.checks()
        self.worklogs()
        self.comments()
        self.history()
        self.revisits()
        self.captures()
        self.days()
        self.quotes()
        return self.summary()

    def projects(self) -> None:
        archived = self.has_column("projects", "archived")
        deleted = "deleted_at IS NULL" if self.has_column("projects", "deleted_at") else "1"
        self.project_ids: set[int] = set()
        for p in self.rows(f"SELECT * FROM projects WHERE {deleted} ORDER BY id"):
            self.project_ids.add(self.insert("projects", {
                "id": p["id"], "key": p["key"], "name": p["name"], "next_number": p["next_number"],
                "archived": int(bool(p["archived"])) if archived else 0, "created_at": self.utc(p["created_at"])}))

    def ticket_items(self) -> set[int]:
        """Learning items that only stood for an article or a book (Arc's duplicate 'tickets')."""
        found = self.rows("SELECT item_id FROM articles WHERE item_id IS NOT NULL "
                          "UNION SELECT item_id FROM books WHERE item_id IS NOT NULL")
        return {r["item_id"] for r in found}

    def tasks(self) -> None:
        items = self.rows(f"""SELECT * FROM items WHERE type IN ('task', 'note') AND {self.item_scope()}
                              ORDER BY id""")
        items = [i for i in items if i["project_id"] in self.project_ids and not self.has_task(i["id"])]
        for i in items:
            status = TASK_STATUS[i["status"]]
            done_at = self.utc(i["completed_at"] or i["status_changed_at"]) if status == "done" else None
            self.task_ids[i["id"]] = self.insert("tasks", {
                "id": i["id"], "project_id": i["project_id"], "number": i["number"], "title": i["title"],
                "body": i["description"] or "", "status": status, "priority": PRIORITY.get(i["priority"], 0),
                "planned_on": self.today if i["status"] == "today" else None, "due_on": i["due_date"],
                "estimate_min": i["estimate_minutes"], "repeat": i["recurrence"] or "none",
                "tags": self.tags(i["labels"]), "url": i["url"], "position": i["position"],
                "created_at": self.utc(i["created_at"]), "updated_at": self.utc(i["updated_at"]),
                "status_at": self.utc(i["status_changed_at"]), "done_at": done_at,
                "deleted_at": self.utc(i["deleted_at"])})
        for i in items:  # parents once every task exists; a parent that is not a task is dropped
            if i.get("parent_id") in self.task_ids:
                self.smriti.execute("UPDATE tasks SET parent_id = ? WHERE id = ?",
                                  (self.task_ids[i["parent_id"]], self.task_ids[i["id"]]))

    def first_worklog(self, item_id: int) -> str | None:
        row = self.arc.execute("SELECT min(started_at) FROM worklogs WHERE item_id = ?", (item_id,)).fetchone()
        return self.utc(row[0]) if row else None

    def topics(self, tickets: set[int]) -> None:
        items = self.rows(f"SELECT * FROM items WHERE type = 'learning' AND {self.item_scope()} ORDER BY id")
        for i in items:
            if i["id"] in tickets:
                continue
            status = TOPIC_STATUS[i["status"]]
            started = None
            if status != "queued":
                started = self.first_worklog(i["id"]) or self.utc(i["status_changed_at"])
            self.source_ids[i["id"]] = self.insert("sources", {
                "kind": "video" if lookup.is_video(i["url"]) else "topic", "title": i["title"], "url": i["url"],
                "site": lookup.site_of(i["url"]) if i["url"] else "", "image": video_thumb(i["url"]),
                "body": i["description"] or "",
                "status": status, "tags": self.tags(i["labels"]), "created_at": self.utc(i["created_at"]),
                "updated_at": self.utc(i["updated_at"]), "started_at": started,
                "done_at": self.utc(i["completed_at"] or i["status_changed_at"]) if status == "done" else None,
                "deleted_at": self.utc(i["deleted_at"]), **self.note_of(i, self.item_key(i))})

    def item_key(self, item: dict) -> str:
        """Arc's key for an item (WORK-12), which Arc wrote into its Obsidian note as arc_id."""
        row = self.arc.execute("SELECT key FROM projects WHERE id = ?", (item["project_id"],)).fetchone()
        return f"{row[0]}-{item['number']}" if row else ""

    def note_of(self, row: dict, key: str) -> dict:
        """Where Arc put this thing's Obsidian note, so Smriti updates that note instead of writing a second one."""
        if not row.get("obsidian_path"):
            return {}
        return {"obsidian_path": row["obsidian_path"], "obsidian_key": key, "exported_at": self.utc(row.get("exported_at"))}

    def item_scope(self) -> str:
        return "deleted_at IS NOT NULL" if self.scope == "trash" else "1"

    def has_task(self, item_id: int) -> bool:
        """Smriti tasks keep Arc's item ids, so an item already brought across is skipped."""
        return self.scope == "trash" and bool(db.scalar(self.smriti, "SELECT count(*) FROM tasks WHERE id = ?", (item_id,)))

    def live_ticket(self, item_id: int | None) -> int | None:
        """The ticket item id, if it exists and is not deleted (deleted rows are not imported)."""
        if item_id is None:
            return None
        row = self.arc.execute("SELECT id FROM items WHERE id = ? AND deleted_at IS NULL", (item_id,)).fetchone()
        return row[0] if row else None

    def collections(self) -> None:
        """Arc's collections come across as Smriti collections (Arc id -> Smriti id in self.collection_ids)."""
        self.collection_ids: dict[int, int] = {}
        for c in self.rows("SELECT * FROM collections ORDER BY id"):
            found = db.scalar(self.smriti, "SELECT id FROM collections WHERE name = ? COLLATE NOCASE", (c["name"],))
            self.collection_ids[c["id"]] = found or self.insert("collections", {"name": c["name"], "created_at": self.utc(c["created_at"])})

    def arc_collections_of(self, article: dict) -> list[int]:
        """The Arc collection ids an article is in: its list, plus the one its Obsidian note was filed under."""
        ids = [r["collection_id"] for r in self.rows("SELECT collection_id FROM article_collections WHERE article_id = ?", (article["id"],))]
        if article.get("collection_id") and article["collection_id"] not in ids:
            ids.append(article["collection_id"])
        return ids

    def link_collections(self, source_id: int, arc_ids: list[int]) -> None:
        for cid in arc_ids:
            if cid in self.collection_ids:
                self.smriti.execute("INSERT OR IGNORE INTO source_collections (source_id, collection_id, added_at) VALUES (?, ?, ?)",
                                  (source_id, self.collection_ids[cid], clock.now()))

    def articles(self) -> None:
        for a in self.rows("SELECT * FROM articles ORDER BY id"):
            status = ARTICLE_STATUS[a["status"]]
            source_id = self.insert("sources", {
                "kind": "video" if lookup.is_video(a["url"]) else "article", "title": a["title"], "url": a["url"],
                "author": a["author"] or "", "site": a["site"] or "", "image": a["image"] or video_thumb(a["url"]),
                "summary": a["description"] or "", "body": a["notes"] or "", "status": status,
                "tags": self.tags(a["tags"]), "created_at": self.utc(a["created_at"]),
                "updated_at": self.utc(a["updated_at"]),
                "started_at": self.utc(a["updated_at"]) if status == "active" else None,
                "done_at": self.utc(a["read_at"] or a["updated_at"]) if status == "done" else None,
                **self.note_of(a, f"ART-{a['id']}")})
            self.link_collections(source_id, self.arc_collections_of(a))
            if ticket := self.live_ticket(a.get("item_id")):
                self.source_ids[ticket] = source_id

    def books(self) -> None:
        for b in self.rows("SELECT * FROM books ORDER BY id"):
            status = BOOK_STATUS[b["status"]]
            source_id = self.insert("sources", {
                "kind": "book", "title": b["title"], "author": b["author"] or "", "image": b["cover"],
                "body": b["notes"] or "", "status": status, "progress": b["current_page"] or 0,
                "total": b["pages"], "ref": b["olid"], "tags": "[]", "created_at": self.utc(b["created_at"]),
                "updated_at": self.utc(b["updated_at"]),
                "started_at": self.utc(b["started_at"]) if status != "queued" else None,
                "done_at": self.utc(b["finished_at"] or b["updated_at"]) if status == "done" else None})
            if ticket := self.live_ticket(b.get("item_id")):
                self.source_ids[ticket] = source_id

    def checks(self) -> None:
        for s in self.rows("SELECT * FROM subtasks ORDER BY item_id, position, id"):
            if s["item_id"] in self.task_ids:
                self.insert("checks", {"task_id": self.task_ids[s["item_id"]], "title": s["title"],
                                       "done": int(bool(s["done"])), "position": s["position"]})

    def worklogs(self) -> None:
        for w in self.rows("SELECT * FROM worklogs ORDER BY started_at, id"):
            target = self.subject(w["item_id"])
            if not target:
                continue
            started = self.utc(w["started_at"])
            self.insert("sessions", {
                target[0]: target[1], "started_at": started, "ended_at": clock.add_minutes(started, w["minutes"]),
                "minutes": max(1, w["minutes"]), "note": w["comment"] or "", "created_at": self.utc(w["created_at"])})

    def comments(self) -> None:
        edited = self.has_column("comments", "edited_at")
        for c in self.rows("SELECT * FROM comments ORDER BY id"):
            if target := self.subject(c["item_id"]):
                self.insert("notes", {target[0]: target[1], "body": c["body"], "created_at": self.utc(c["created_at"]),
                                      "edited_at": self.utc(c["edited_at"]) if edited else None})

    def event_value(self, field: str, value: str | None, column: str) -> str | None:
        if value is None:
            return None
        if field == "status":
            vocab = TASK_STATUS if column == "task_id" else TOPIC_STATUS
            return vocab.get(value, value)
        if field == "priority":
            return str(PRIORITY.get(value, value))
        return value

    def history(self) -> None:
        for h in self.rows("SELECT * FROM history ORDER BY id"):
            target = self.subject(h["item_id"])
            field = EVENT_FIELD.get(h["field"], h["field"])
            if not target or field is None:
                continue
            self.insert("events", {
                target[0]: target[1], "field": field,
                "old": self.event_value(field, h["old_value"], target[0]),
                "new": self.event_value(field, h["new_value"], target[0]), "at": self.utc(h["created_at"])})

    def revisits(self) -> None:
        sessions: dict[int, list[dict]] = {}
        for s in self.rows("SELECT * FROM revision_sessions ORDER BY created_at, id"):
            sessions.setdefault(s["revision_id"], []).append(s)
        for r in self.rows("SELECT * FROM revisions ORDER BY id"):
            mine = sessions.get(r["id"], [])
            reviewed = self.utc(mine[-1]["created_at"]) if mine else self.utc(r["revised_at"])
            target = self.subject(r["item_id"]) if r["item_id"] else None
            revisit_id = self.insert("revisits", {
                "id": r["id"], "title": r["title"], "prompt": r["question"] or "", "body": r["notes"] or "",
                "url": r["url"], "priority": PRIORITY.get(r.get("priority") or "none", 0),
                "status": REVISIT_STATUS[r["status"]],
                "task_id": target[1] if target and target[0] == "task_id" else None,
                "source_id": target[1] if target and target[0] == "source_id" else None,
                "created_at": self.utc(r["created_at"]), "updated_at": self.utc(r["updated_at"]),
                "reviewed_at": reviewed,
                "retired_at": self.utc(r["revised_at"] or r["updated_at"]) if r["status"] == "revised" else None})
            self.revisit_ids[r["id"]] = revisit_id
            for s in mine:  # Arc logged a revision session when it ended
                ended = self.utc(s["created_at"])
                started = clock.to_iso(clock.parse(ended) - timedelta(minutes=s["minutes"]))
                self.insert("sessions", {"revisit_id": revisit_id, "started_at": started, "ended_at": ended,
                                         "minutes": max(1, s["minutes"]), "created_at": ended})

    def captures(self) -> None:
        has_url = self.has_column("jots", "url")
        for j in self.rows("SELECT * FROM jots ORDER BY id"):
            status = JOT_STATUS[j["status"]]
            target = self.subject(j["item_id"]) if j["item_id"] else None
            sorted_at = None
            if status != "open":
                sorted_at = self.utc(j["converted_at"] or j["updated_at"])
            self.insert("captures", {
                "id": j["id"], "text": j["body"], "details": j["details"] or "",
                "url": j["url"] if has_url else None, "tags": "[]", "status": status,
                "task_id": target[1] if target and target[0] == "task_id" else None,
                "source_id": target[1] if target and target[0] == "source_id" else None,
                "created_at": self.utc(j["created_at"]), "sorted_at": sorted_at})

    def days(self) -> None:
        for d in self.rows("SELECT * FROM daily_reviews ORDER BY date"):
            self.insert("days", {"date": d["date"], "went_well": d["went_well"] or "", "blockers": d["blockers"] or "",
                                 "tomorrow": d["tomorrow"] or "", "updated_at": self.utc(d["updated_at"])})

    def quotes(self) -> None:
        if "quotes" not in {r["name"] for r in self.rows("SELECT name FROM sqlite_master WHERE type = 'table'")}:
            return
        for q in self.rows("SELECT * FROM quotes ORDER BY id"):
            self.insert("quotes", {"text": q["text"], "author": q["author"] or "", "created_at": self.utc(q["created_at"])})

    def summary(self) -> dict:
        """Counts per table, with sources also split by kind."""
        out = {t: self.counts[t] for t in ("projects", "tasks", "checks", "sources")}
        for kind in ("topic", "video", "article", "book"):
            out[f"sources.{kind}"] = db.scalar(self.smriti, "SELECT count(*) FROM sources WHERE kind = ?", (kind,))
        out.update({t: self.counts[t] for t in ("sessions", "notes", "events", "captures", "revisits", "days", "quotes")})
        return out


def is_empty(smriti: sqlite3.Connection) -> bool:
    return all(db.scalar(smriti, f"SELECT count(*) FROM {t}") == 0 for t in SMRITI_TABLES)


def run(path: str, cfg: Config) -> dict:
    """Import Arc at `path` into the (migrated, empty) Smriti database. Returns counts."""
    arc = open_arc(path)
    smriti = db.connect(cfg.db_path)
    try:
        if not is_empty(smriti):
            raise ImportRefused(f"{cfg.db_path} already has data; import only runs on an empty database")
        with db.transaction(smriti):
            return ArcImport(arc, smriti, cfg).run()
    finally:
        smriti.close()
        arc.close()



def import_quotes(path: str, cfg: Config) -> int:
    """Copy only Arc's quotes into Smriti; for a Smriti database made before quotes existed. Runs once."""
    arc = open_arc(path)
    smriti = db.connect(cfg.db_path)
    try:
        if db.scalar(smriti, "SELECT count(*) FROM quotes"):
            raise ImportRefused("Smriti already has quotes")
        with db.transaction(smriti):
            importer = ArcImport(arc, smriti, cfg)
            importer.quotes()
            return importer.counts["quotes"]
    finally:
        smriti.close()
        arc.close()


def video_thumb(url: str | None) -> str | None:
    """YouTube's own thumbnail for a video link (Arc kept local copies; Smriti links to the original)."""
    video = lookup.youtube_id(url)
    return f"https://i.ytimg.com/vi/{video}/hqdefault.jpg" if video else None


def import_trash(path: str, cfg: Config) -> dict:
    """For a Smriti database imported before Arc's trash came across: add Arc's deleted tasks and topics
    (still deleted, with their time, comments and history), and give video sources their thumbnails.
    Safe to run twice: items already present are skipped."""
    arc = open_arc(path)
    smriti = db.connect(cfg.db_path)
    try:
        with db.transaction(smriti):
            imp = ArcImport(arc, smriti, cfg, scope="trash")
            imp.project_ids = {r[0] for r in smriti.execute("SELECT id FROM projects")}
            known = {(r[0], r[1]) for r in smriti.execute("SELECT title, created_at FROM sources")}
            imp.tasks()
            before = set(imp.source_ids)
            imp.topics(imp.ticket_items())
            for item_id in set(imp.source_ids) - before:  # a topic already present: drop the copy
                row = db.one(smriti, "SELECT title, created_at FROM sources WHERE id = ?", (imp.source_ids[item_id],))
                if (row["title"], row["created_at"]) in known:
                    smriti.execute("DELETE FROM sources WHERE id = ?", (imp.source_ids.pop(item_id),))
                    imp.counts["sources"] -= 1
            imp.worklogs()
            imp.comments()
            imp.history()
            thumbs = 0
            for sid, url in smriti.execute("SELECT id, url FROM sources WHERE kind = 'video' AND image IS NULL").fetchall():
                if thumb := video_thumb(url):
                    smriti.execute("UPDATE sources SET image = ? WHERE id = ?", (thumb, sid))
                    thumbs += 1
            return {"tasks": imp.counts["tasks"], "sources": imp.counts["sources"], "sessions": imp.counts["sessions"],
                    "notes": imp.counts["notes"], "events": imp.counts["events"], "video thumbnails": thumbs}
    finally:
        smriti.close()
        arc.close()


def import_obsidian_notes(path: str, cfg: Config) -> int:
    """For a Smriti database imported before notes came across: record where Arc wrote each source's
    Obsidian note (matched by title and creation time). Sources that already know their note are left alone."""
    arc = open_arc(path)
    smriti = db.connect(cfg.db_path)
    try:
        imp = ArcImport(arc, smriti, cfg)
        found = 0
        with db.transaction(smriti):
            rows = [(r, imp.item_key(r)) for r in imp.rows("SELECT * FROM items WHERE type = 'learning' AND obsidian_path IS NOT NULL")]
            rows += [(r, f"ART-{r['id']}") for r in imp.rows("SELECT * FROM articles WHERE obsidian_path IS NOT NULL")]
            for row, key in rows:
                note = imp.note_of(row, key)
                cur = smriti.execute(
                    """UPDATE sources SET obsidian_path = ?, obsidian_key = ?, exported_at = ?
                       WHERE title = ? AND created_at = ? AND obsidian_path IS NULL""",
                    (note["obsidian_path"], note["obsidian_key"], note["exported_at"], row["title"], imp.utc(row["created_at"])))
                found += cur.rowcount
        return found
    finally:
        smriti.close()
        arc.close()


def import_collections(path: str, cfg: Config) -> dict:
    """For a Smriti database imported before collections came across: create Arc's collections, put each
    article in its collections (matched by title and creation time), and drop the collection names that an
    earlier import added to its tags. Safe to run twice."""
    arc = open_arc(path)
    smriti = db.connect(cfg.db_path)
    try:
        with db.transaction(smriti):
            imp = ArcImport(arc, smriti, cfg)
            imp.collections()
            names = {c["id"]: c["name"].strip().lower() for c in imp.rows("SELECT id, name FROM collections")}
            linked = 0
            for a in imp.rows("SELECT * FROM articles ORDER BY id"):
                sid = db.scalar(smriti, "SELECT id FROM sources WHERE title = ? AND created_at = ?", (a["title"], imp.utc(a["created_at"])))
                if not sid:
                    continue
                arc_ids = imp.arc_collections_of(a)
                before = db.scalar(smriti, "SELECT count(*) FROM source_collections WHERE source_id = ?", (sid,))
                imp.link_collections(sid, arc_ids)
                linked += db.scalar(smriti, "SELECT count(*) FROM source_collections WHERE source_id = ?", (sid,)) - before
                own = set(db.tags_out(a["tags"]))
                drop = {names[i] for i in arc_ids if i in names} - own
                tags = db.tags_out(db.scalar(smriti, "SELECT tags FROM sources WHERE id = ?", (sid,)))
                kept = [t for t in tags if t not in drop]
                if kept != tags:
                    smriti.execute("UPDATE sources SET tags = ? WHERE id = ?", (db.tags_in(kept), sid))
            return {"collections": len(imp.collection_ids), "links": linked}
    finally:
        smriti.close()
        arc.close()
