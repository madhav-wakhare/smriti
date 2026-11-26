"""Write sources (topics, videos, articles, books) and tasks to an Obsidian vault, one Markdown note each.

The vault is a folder mounted at SMRITI_VAULT_DIR. A note is named after its title and carries
`smriti_id: SRC-<id>` (or `TASK-<id>`) in its front matter, so Smriti only ever overwrites or removes
notes it wrote.
Notes Arc wrote (`arc_id:` or `smriti_id:` with Arc's key) are recognised too, so exporting a source that
came from Arc updates Arc's note in place instead of making a second one.
"""

import os
import re
import sqlite3

from . import clock, models
from .config import Config

ID_FIELDS = ("smriti_id", "arc_id")
_ILLEGAL = re.compile(r'[\\/:*?"<>|#^\[\]\x00-\x1f]')


class ExportError(Exception):
    pass


def status(cfg: Config) -> dict:
    # Docker always mounts something at the vault dir (a placeholder when no vault is set), so the vault
    # only counts as connected when SMRITI_VAULT_PATH names one.
    mounted = bool(cfg.vault_host) and os.path.isdir(cfg.vault_dir)
    return {
        "vault_dir": cfg.vault_dir,
        "vault_path": cfg.vault_host,
        "mounted": mounted,
        "writable": mounted and os.access(cfg.vault_dir, os.W_OK),
        "is_obsidian_vault": mounted and os.path.isdir(os.path.join(cfg.vault_dir, ".obsidian")),
        "folder": cfg.obsidian_folder,
        "articles_folder": cfg.obsidian_articles_folder,
        "tasks_folder": cfg.obsidian_tasks_folder,
        "auto": cfg.obsidian_auto,
    }


def key_of(source_id: int) -> str:
    return f"SRC-{source_id}"


def safe_filename(title: str) -> str:
    name = re.sub(r"\s+", " ", _ILLEGAL.sub(" ", title)).strip().strip(".")
    return (name[:150] or "Untitled").strip()


def _q(value: str) -> str:
    return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'


def render(s: dict, key: str) -> str:
    """The note: front matter Obsidian can query, then the link, summary and your notes."""
    tags = ", ".join(_q(t) for t in s["tags"])
    lines = ["---", f"title: {_q(s['title'])}", f"kind: {s['kind']}"]
    if s.get("url"):
        lines.append(f"url: {_q(s['url'])}")
    if s.get("author"):
        lines.append(f"author: {_q(s['author'])}")
    if s.get("site"):
        lines.append(f"site: {_q(s['site'])}")
    lines.append(f"tags: [{tags}]")
    if s.get("collections"):
        lines.append("collections: [" + ", ".join(_q(c["name"]) for c in s["collections"]) + "]")
    lines += [f"status: {s['status']}", f"saved: {s['created_at'][:10]}"]
    if s.get("done_at"):
        lines.append(f"done: {s['done_at'][:10]}")
    if s["kind"] == "book" and s.get("total"):
        lines.append(f"pages: {s['total']}")
        lines.append(f"progress: {s['progress']}")
    lines += [f"smriti_id: {key}", "---", "", f"# {s['title']}"]
    if s.get("url"):
        label = {"video": "Watch the video", "article": "Read the article"}.get(s["kind"], "Open the link")
        lines += ["", f"[{label}]({s['url']})"]
    if s.get("author") and s["kind"] == "book":
        lines += ["", f"By {s['author']}"]
    if (s.get("summary") or "").strip():
        lines += ["", "> " + s["summary"].strip().replace("\n", " ")]
    if (s.get("body") or "").strip():
        lines += ["", "## Notes", "", s["body"].strip()]
    return "\n".join(lines) + "\n"


def _ours(path: str, keys: set[str]) -> bool:
    try:
        with open(path, encoding="utf-8") as fh:
            head = fh.read(4096)
    except OSError:
        return False
    return any(f"{field}: {k}\n" in head for field in ID_FIELDS for k in keys)


def write_note(conn: sqlite3.Connection, cfg: Config, table: str, row: dict, key: str, default_folder: str, text: str,
               move: bool = False) -> str:
    """Write `text` as the note for `row` of `table`, named after its title. Returns its path inside the vault."""
    info = status(cfg)
    if not info["writable"]:
        raise ExportError("No vault is connected, or it is read-only. Set SMRITI_VAULT_PATH in .env and run make restart.")
    keys = {key} | ({row["obsidian_key"]} if row.get("obsidian_key") else set())
    old_rel = row.get("obsidian_path")
    # A note that exists keeps its folder (Arc filed articles by collection, and you may have moved it);
    # a new one, or one asked to `move`, goes to the default.
    folder = os.path.dirname(old_rel) if old_rel and not move else default_folder
    vault = os.path.realpath(cfg.vault_dir)
    target_dir = os.path.realpath(os.path.join(vault, folder))
    if target_dir != vault and not target_dir.startswith(vault + os.sep):
        raise ExportError("The export folder must be inside the vault.")
    os.makedirs(target_dir, exist_ok=True)

    base = safe_filename(row["title"])
    rel = os.path.join(folder, base + ".md") if folder else base + ".md"
    path = os.path.join(vault, rel)
    if os.path.exists(path) and rel != old_rel and not _ours(path, keys):
        rel = os.path.join(folder, f"{base} ({key}).md") if folder else f"{base} ({key}).md"
        path = os.path.join(vault, rel)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)
    if old_rel and old_rel != rel and _ours(os.path.join(vault, old_rel), keys):
        os.remove(os.path.join(vault, old_rel))  # renamed: the old note goes
    conn.execute(f"UPDATE {table} SET obsidian_path = ?, obsidian_key = ?, exported_at = ? WHERE id = ?",
                 (rel, key, clock.now(), row["id"]))
    return rel


def default_folder(cfg: Config, s: dict) -> str:
    """Where a new note goes. Articles go to a subfolder named after their first collection, as in Arc."""
    if s["kind"] != "article":
        return cfg.obsidian_folder
    if s.get("collections"):
        return f"{cfg.obsidian_articles_folder.rstrip('/')}/{safe_filename(s['collections'][0]['name'])}".strip("/")
    return cfg.obsidian_articles_folder


def export(conn: sqlite3.Connection, cfg: Config, s: dict) -> str:
    """Write (or rewrite) the note for source `s`."""
    key = key_of(s["id"])
    folder = default_folder(cfg, s)
    # An article saved before it had a collection sits in the plain Articles folder; once it gets one,
    # it moves into that collection's folder. Notes anywhere else stay where they are.
    old = s.get("obsidian_path")
    move = bool(old) and s["kind"] == "article" and os.path.dirname(old) == cfg.obsidian_articles_folder.strip("/") and folder != os.path.dirname(old)
    return write_note(conn, cfg, "sources", s, key, folder, render(s, key), move=move)


PRIORITY_WORD = {0: "none", 1: "low", 2: "medium", 3: "high", 4: "urgent"}


def _duration(minutes: int | None) -> str:
    m = int(minutes or 0)
    return f"{m // 60}h {m % 60}m" if m >= 60 and m % 60 else (f"{m // 60}h" if m >= 60 else f"{m}m")


def render_task(t: dict, project: str, checks: list[dict], notes: list[dict], key: str) -> str:
    """A task's note: front matter for Dataview and the like, then the description, checklist and notes."""
    tags = ", ".join(_q(g) for g in t["tags"])
    lines = ["---", f"title: {_q(t['title'])}", f"key: {t['key']}", f"project: {_q(project)}",
             f"status: {t['status']}", f"priority: {PRIORITY_WORD.get(t['priority'], 'none')}"]
    if t.get("planned_on"):
        lines.append(f"planned: {t['planned_on']}")
    if t.get("due_on"):
        lines.append(f"due: {t['due_on']}")
        if t.get("due_time"):
            lines.append(f"due_time: {_q(t['due_time'])}")
    if t.get("estimate_min"):
        lines.append(f"estimate: {_q(_duration(t['estimate_min']))}")
    if t.get("url"):
        lines.append(f"url: {_q(t['url'])}")
    if t.get("parent_key"):
        lines.append(f"parent: {t['parent_key']}")
    lines += [f"tags: [{tags}]", f"created: {t['created_at'][:10]}"]
    if t.get("done_at"):
        lines.append(f"done: {t['done_at'][:10]}")
    lines += [f"smriti_id: {key}", "---", "", f"# {t['title']}"]
    if t.get("url"):
        lines += ["", f"[Open the link]({t['url']})"]
    if (t.get("body") or "").strip():
        lines += ["", t["body"].strip()]
    if checks:
        lines += ["", "## Checklist", ""] + [f"- [{'x' if c['done'] else ' '}] {c['title']}" for c in checks]
    if notes:
        lines += ["", "## Notes"]
        for n in notes:
            lines += ["", f"### {n['created_at'][:10]}", "", n["body"].strip()]
    return "\n".join(lines) + "\n"


def export_task(conn: sqlite3.Connection, cfg: Config, task_id: int) -> str:
    """Write (or rewrite) the note for a task, with its checklist and notes."""
    from . import models  # models imports nothing from here; a local import keeps the module graph simple

    t = models.task(conn, task_id)
    raw = models.task_row(conn, task_id)
    project = conn.execute("SELECT name FROM projects WHERE id = ?", (t["project_id"],)).fetchone()[0]
    checks = [dict(r) for r in conn.execute("SELECT title, done FROM checks WHERE task_id = ? ORDER BY position, id", (task_id,))]
    notes = [dict(r) for r in conn.execute("SELECT body, created_at FROM notes WHERE task_id = ? ORDER BY created_at, id", (task_id,))]
    key = f"TASK-{task_id}"
    row = {**t, "obsidian_key": raw["obsidian_key"], "obsidian_path": raw["obsidian_path"]}
    return write_note(conn, cfg, "tasks", row, key, cfg.obsidian_tasks_folder, render_task(t, project, checks, notes, key))


def refresh_task(conn: sqlite3.Connection, cfg: Config, task_id: int) -> None:
    """After a change to a task, its checklist or its notes: rewrite its note, if it has one."""
    if not cfg.obsidian_auto:
        return
    row = conn.execute("SELECT obsidian_path FROM tasks WHERE id = ? AND deleted_at IS NULL", (task_id,)).fetchone()
    if row and row[0]:
        try:
            export_task(conn, cfg, task_id)
        except ExportError:
            pass  # the vault is not connected right now; the next manual export will catch up


NOTE_FIELDS = {"title", "url", "author", "site", "summary", "body", "status", "tags", "kind", "progress", "total", "collections"}


def sync(conn: sqlite3.Connection, cfg: Config, s: dict, changed: set[str] | None = None) -> None:
    """Keep a source's note in step with it: with auto-save on, write the note when the source is new
    (`changed` is None), has no note yet, or changed something the note shows. A vault that is not
    connected is skipped quietly; `save_missing` catches up at the next start."""
    if not cfg.obsidian_auto:
        return
    if changed is not None and s.get("obsidian_path") and not changed & NOTE_FIELDS:
        return
    try:
        export(conn, cfg, s)
    except ExportError:
        pass


def save_missing(conn: sqlite3.Connection, cfg: Config) -> int:
    """Write a note for every live source that has none yet. Returns how many were written."""
    if not cfg.obsidian_auto or not status(cfg)["writable"]:
        return 0
    saved = 0
    for (source_id,) in conn.execute("SELECT id FROM sources WHERE deleted_at IS NULL AND obsidian_path IS NULL ORDER BY id").fetchall():
        try:
            export(conn, cfg, models.source(conn, source_id, raw=True))
            saved += 1
        except ExportError:
            break
    return saved
