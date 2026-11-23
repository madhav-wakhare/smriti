# Smriti: specification

Smriti is a personal tracker for work and learning. It runs as one container and stores everything
in one SQLite file. It is a redesign of an earlier app ("Arc"). Smriti keeps the parts that were
used and makes them clearer. It merges overlapping ideas into a few named concepts and drops the
rest.

This file is the contract between the API (`api/`) and the web UI (`web/`). If the code and this
file disagree, fix one of them so they agree again.

---

## 1. Concepts (the whole vocabulary)

| Concept     | What it is                                                      | Replaces in Arc                                            |
|-------------|-----------------------------------------------------------------|------------------------------------------------------------|
| **Project** | A named group of tasks with a short key (`WORK`).              | projects                                                   |
| **Task**    | Work to do, in a project. Board: Todo → Doing → Done.            | items of type task or note                                 |
| **Plan**    | A task's `planned_on` date. "Today" lists tasks planned for today. | the `today` status                                     |
| **Source**  | Something you learn from: a topic, article, book or video.      | learning items, articles, books (and their duplicate "tickets") |
| **Capture** | A quick note to sort out later: keep it as a task, source or revisit, or dismiss it. | Radar (jots)                               |
| **Revisit** | Something you want to keep fresh: a question or idea you come back to again and again. | Revisit (revisions); same name as in Arc       |
| **Session** | A stretch of time spent on one task, source or revisit. If it has no end, it is still running. | worklogs, active timer, revision sessions, revision timer |
| **Note**    | A comment on a task or source.                                  | comments                                                   |
| **Check**   | One checklist line on a task.                                   | subtasks                                                   |
| **Event**   | A logged change to a task or source (field, old, new).          | history                                                    |
| **Day**     | The end-of-day review: went well, blockers, tomorrow.           | daily reviews                                              |
| **Quote**   | A short line that keeps you going; Today shows one, changing every 2 minutes. | quotes                                                     |
| **Tag**     | A free word on tasks, sources and captures.                     | labels, article collections, article tags                  |

Dropped on purpose: the weekend planner, thumbnail caching, the settings
table (configuration now comes from environment variables, and UI preferences are kept in the
browser) and the in-app backup scheduler (backups are now an admin command).

## 2. Database (SQLite, `SMRITI_DB_PATH`)

Timestamps are stored as ISO-8601 UTC strings (`2026-11-22T05:43:17Z`). Plain dates are `YYYY-MM-DD`
in the user's time zone (`TZ`). Every table has `id INTEGER PRIMARY KEY` unless noted otherwise.
Soft-deleted rows have a `deleted_at` value. They are hidden everywhere except the trash, and are
removed for good after `SMRITI_TRASH_DAYS`. Tags are stored as a JSON array of lowercase strings.

```sql
projects(id, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL, next_number INTEGER NOT NULL DEFAULT 1,
         archived INTEGER NOT NULL DEFAULT 0, created_at, deleted_at)

tasks(id, project_id REFERENCES projects NOT NULL, number INTEGER NOT NULL,      -- key = PROJECT-number
      parent_id REFERENCES tasks ON DELETE SET NULL,
      title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',                         -- markdown
      status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done')),
      priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),       -- 0 none,1 low,2 medium,3 high,4 urgent
      planned_on TEXT, due_on TEXT, estimate_min INTEGER,
      repeat TEXT NOT NULL DEFAULT 'none' CHECK (repeat IN ('none','daily','weekdays','weekly','monthly')),
      tags TEXT NOT NULL DEFAULT '[]', url TEXT, position REAL NOT NULL DEFAULT 0,
      created_at, updated_at, status_at, done_at, deleted_at,
      UNIQUE(project_id, number))

checks(id, task_id REFERENCES tasks ON DELETE CASCADE NOT NULL, title TEXT NOT NULL,
       done INTEGER NOT NULL DEFAULT 0, position REAL NOT NULL DEFAULT 0)

sources(id, kind TEXT NOT NULL CHECK (kind IN ('topic','article','book','video')),
        title TEXT NOT NULL, url TEXT, author TEXT NOT NULL DEFAULT '', site TEXT NOT NULL DEFAULT '',
        image TEXT, summary TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '',   -- body = your notes
        status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','active','done')),
        progress INTEGER NOT NULL DEFAULT 0, total INTEGER,                           -- pages for books
        tags TEXT NOT NULL DEFAULT '[]', ref TEXT,                                    -- e.g. Open Library id
        created_at, updated_at, started_at, done_at, deleted_at)

captures(id, text TEXT NOT NULL, details TEXT NOT NULL DEFAULT '', url TEXT, tags TEXT NOT NULL DEFAULT '[]',
         status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','kept','dismissed')),
         task_id REFERENCES tasks ON DELETE SET NULL, source_id REFERENCES sources ON DELETE SET NULL,
         revisit_id REFERENCES revisits ON DELETE SET NULL,
         created_at, sorted_at, deleted_at)

revisits(id, title TEXT NOT NULL, prompt TEXT NOT NULL DEFAULT '', body TEXT NOT NULL DEFAULT '', url TEXT,
      priority INTEGER NOT NULL DEFAULT 0 CHECK (priority BETWEEN 0 AND 4),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
      task_id REFERENCES tasks ON DELETE SET NULL, source_id REFERENCES sources ON DELETE SET NULL,
      created_at, updated_at, reviewed_at, retired_at, deleted_at)

sessions(id, task_id REFERENCES tasks ON DELETE CASCADE, source_id REFERENCES sources ON DELETE CASCADE,
         revisit_id REFERENCES revisits ON DELETE CASCADE,
         started_at TEXT NOT NULL, ended_at TEXT, minutes INTEGER,   -- minutes set when ended (>= 1)
         note TEXT NOT NULL DEFAULT '', created_at,
         CHECK ((task_id IS NOT NULL) + (source_id IS NOT NULL) + (revisit_id IS NOT NULL) = 1))
-- at most one running session:
CREATE UNIQUE INDEX one_running ON sessions((1)) WHERE ended_at IS NULL;

notes(id, task_id REFERENCES tasks ON DELETE CASCADE, source_id REFERENCES sources ON DELETE CASCADE,
      body TEXT NOT NULL, created_at, edited_at,
      CHECK ((task_id IS NOT NULL) + (source_id IS NOT NULL) = 1))

events(id, task_id REFERENCES tasks ON DELETE CASCADE, source_id REFERENCES sources ON DELETE CASCADE,
       field TEXT NOT NULL, old TEXT, new TEXT, at TEXT NOT NULL)

days(date TEXT PRIMARY KEY, went_well TEXT NOT NULL DEFAULT '', blockers TEXT NOT NULL DEFAULT '',
     tomorrow TEXT NOT NULL DEFAULT '', updated_at)

search  -- FTS5(kind, ref_id UNINDEXED, title, body), kept in step by triggers on tasks, sources, revisits, captures
schema_version(version INTEGER)   -- numbered migrations in api/smriti/migrations/NNN_*.sql
```

Rules:
- Setting a task to `done` sets `done_at`. If the task repeats, the next copy is created with
  `planned_on` set to the next date. Leaving `done` clears `done_at`.
- Starting a session first stops any running one (with `minutes = max(1, round(elapsed))`).
- Stopping a session on a revisit item sets `revisits.reviewed_at`.
- Changes to status, priority, planned_on, due_on, project and title are written as events.
- Setting a source to `active` sets `started_at` if it is empty. Setting it to `done` sets `done_at`
  and, for a book with `total`, sets `progress = total`.

## 3. API (`/api`, JSON)

Errors look like `{"error": {"code": "not_found", "message": "..."}}` with a matching HTTP status.
Lists return arrays. Times in responses are ISO UTC. Every object has `id`.

**Shapes**

```ts
Project  { id, key, name, archived: boolean, open_count: number, created_at }
Task     { id, key: "WORK-12", project_id, project_key, parent_id|null, parent_key|null, title, body,
           status: "todo"|"doing"|"done", priority: 0..4, planned_on|null, due_on|null, estimate_min|null,
           repeat, tags: string[], url|null, position, logged_min: number, checks_done: number,
           checks_total: number, children: number, children_done: number, created_at, updated_at, status_at, done_at|null }
TaskFull Task & { checks: Check[], notes: Note[], sessions: Session[], events: Event[], subtasks: Task[],
           ancestors: [{id, key, title, status}] (top first, ending with the parent), open_descendants: number }
Check    { id, task_id, title, done: boolean, position }
Source   { id, kind, title, url|null, author, site, image|null, summary, body, status: "queued"|"active"|"done",
           progress, total|null, tags: string[], ref|null, logged_min, created_at, updated_at, started_at|null, done_at|null }
SourceFull Source & { notes: Note[], sessions: Session[], events: Event[], revisits: Revisit[] }
Capture  { id, text, details, url|null, tags, status: "open"|"kept"|"dismissed", task_id|null, source_id|null,
           revisit_id|null, created_at, sorted_at|null }
Revisit  { id, title, prompt, body, url|null, priority, status: "active"|"retired", task_id|null, source_id|null,
           logged_min, review_count, created_at, updated_at, reviewed_at|null, retired_at|null }
Session  { id, subject: { kind: "task"|"source"|"revisit", id, label: string, key|null }, started_at, ended_at|null,
           minutes|null, note }
Note     { id, task_id|null, source_id|null, body, created_at, edited_at|null }
Event    { id, field, old|null, new|null, at }
Day      { date, went_well, blockers, tomorrow, updated_at|null }
```

**Routes**

```
GET    /api/health                         {status:"ok", version}
GET    /api/config                         {version, tz, today, trash_days}

GET    /api/projects                       Project[] (not deleted)
POST   /api/projects                       {key, name}
PATCH  /api/projects/{id}                  {name?, archived?}
DELETE /api/projects/{id}                  soft delete, with its tasks

GET    /api/tasks                          ?status=&project_id=&planned_on=&parent_id=&tag=&q=&include_done_days=14
POST   /api/tasks                          {project_id, title, body?, status?, priority?, planned_on?, due_on?, estimate_min?, repeat?, tags?, url?, parent_id?}
GET    /api/tasks/{id}                     TaskFull
PATCH  /api/tasks/{id}                     any writable Task field
POST   /api/tasks/{id}/move                {status, before_id?|after_id?}  -> Task (sets position between neighbours)
DELETE /api/tasks/{id}                     soft delete
POST   /api/tasks/{id}/checks              {title} -> Check
PATCH  /api/checks/{id}                    {title?, done?, position?}
DELETE /api/checks/{id}

GET    /api/sources                        ?kind=&status=&tag=&q=
POST   /api/sources                        {kind, title?, url?, ...}  (if url given and title empty, the title and site are looked up)
GET    /api/sources/{id}                   SourceFull
PATCH  /api/sources/{id}
DELETE /api/sources/{id}
POST   /api/lookup/link                    {url} -> {title, site, author, summary, image, kind: "article"|"video"}
POST   /api/sources/{id}/obsidian         write (or rewrite) its note in the vault -> Source (obsidian_path, exported_at); 409 vault_unavailable
GET    /api/obsidian                       {vault_path, mounted, writable, is_obsidian_vault, folder, articles_folder, auto}
GET    /api/lookup/books                   ?q= -> [{title, author, year, total, image, ref}]   (Open Library)

POST   /api/notes                          {task_id|source_id, body} -> Note
PATCH  /api/notes/{id}                     {body}
DELETE /api/notes/{id}

GET    /api/captures                       ?status=open
POST   /api/captures                       {text, details?, url?, tags?}
PATCH  /api/captures/{id}
POST   /api/captures/{id}/keep             {as: "task"|"source"|"revisit", project_id?, kind?} -> Capture (linked)
POST   /api/captures/{id}/dismiss
DELETE /api/captures/{id}

GET    /api/revisits                       ?status=active
POST   /api/revisits                       {title, prompt?, body?, url?, priority?, task_id?, source_id?}
GET    /api/revisits/{id}                  Revisit & {sessions: Session[]}
PATCH  /api/revisits/{id}
POST   /api/revisits/{id}/reviewed         sets reviewed_at = now (no time logged) -> Revisit
DELETE /api/revisits/{id}

GET    /api/sessions                       ?from=YYYY-MM-DD&to=YYYY-MM-DD
GET    /api/sessions/running               Session | null
POST   /api/sessions/start                 {task_id|source_id|revisit_id} -> Session
POST   /api/sessions/stop                  {note?} -> Session | null
POST   /api/sessions                       {task_id|source_id|revisit_id, started_at, minutes, note?}  (log time by hand)
PATCH  /api/sessions/{id}                  {minutes?, note?, started_at?}
DELETE /api/sessions/{id}

GET    /api/days/{date}                    Day (empty fields if none)
PUT    /api/days/{date}                    {went_well, blockers, tomorrow}

GET    /api/today                          {date, planned: Task[], overdue: Task[], doing: Task[], running: Session|null,
                                            open_captures: number, revisits_due: Revisit[] (active, oldest reviewed first, max 5),
                                            waiting: Task[] (open, oldest status_at, max 5),
                                            counts: {open, doing, overdue, logged_today_min},
                                            week: {done, logged_min, learning_min}}
GET    /api/report/week                    ?start=YYYY-MM-DD (Monday; default this week)
                                           {start, end, days: [{date, task_min, source_min, revisit_min}], by_project: [{project_key, name, minutes}],
                                            done: Task[], carried: Task[], sources_done: Source[], days_reviewed: Day[],
                                            totals: {done, logged_min, learning_min, captures}}
GET    /api/quotes                         Quote[] {id, text, author, created_at}
POST   /api/quotes                         {text, author?}
PATCH  /api/quotes/{id}                    {text?, author?}
DELETE /api/quotes/{id}                    deleted for good (no trash)

GET    /api/search                         ?q= -> [{kind: "task"|"source"|"revisit"|"capture", id, title, snippet, key|null}]
GET    /api/trash                          [{kind, id, title, deleted_at, purge_on}]
POST   /api/trash/{kind}/{id}/restore
DELETE /api/trash/{kind}/{id}              delete for good
```

The API also serves the built web UI from `SMRITI_STATIC_DIR` (with an SPA fallback to `index.html`).

## 4. Configuration (12-factor, env only)

| Variable          | Default            | Meaning                                         |
|-------------------|--------------------|-------------------------------------------------|
| `PORT`            | `8000`             | Port the process binds inside the container      |
| `SMRITI_DB_PATH`    | `/data/smriti.db`    | The SQLite file (the attached backing store)     |
| `SMRITI_STATIC_DIR` | `/app/static`      | Built UI; empty means API only                   |
| `SMRITI_TRASH_DAYS` | `30`               | Days before trash is removed for good            |
| `SMRITI_LOG_LEVEL`  | `info`             | Logs are JSON lines on stdout                    |
| `SMRITI_LOOKUP`     | `on`               | `off` disables outbound link and book lookups    |
| `TZ`              | `UTC`              | Time zone for "today" and plain dates           |
| `SMRITI_VAULT_DIR` | `/vault`          | Where the Obsidian vault is mounted in the container |
| `SMRITI_VAULT_PATH` | (empty)          | The vault on the host; export is off while this is empty |
| `SMRITI_OBSIDIAN_FOLDER` | `Smriti/Learning` | Vault folder for topic, video and book notes |
| `SMRITI_OBSIDIAN_ARTICLES_FOLDER` | `Smriti/Articles` | Vault folder for article notes |
| `SMRITI_OBSIDIAN_AUTO` | `on`       | Rewrite a source's note when the source changes |

On the host, `.env` holds `SMRITI_PORT` (the published port, default `8090`) and `TZ`.

## 5. The twelve factors, as Smriti applies them

1. **Codebase:** one repo, one app, many deploys (dev and prod from the same compose files).
2. **Dependencies:** declared and locked (`api/uv.lock`, `web/package-lock.json`) and installed only
   inside images. The host needs nothing but Docker.
3. **Config:** environment variables only (section 4). No config files in the image.
4. **Backing services:** the database is a file at `SMRITI_DB_PATH` on a mounted volume. Switching
   files is a config change.
5. **Build, release, run:** `docker compose build` builds the image; image plus `.env` is the
   release; `docker compose up` runs it.
6. **Processes:** stateless. All state is in the database; the running timer is a database row, not
   memory, and nothing is cached on local disk.
7. **Port binding:** uvicorn binds `$PORT`; compose publishes it as `$SMRITI_PORT`.
8. **Concurrency:** one `web` process type. SQLite has a single writer, so it runs as a single
   process with WAL mode.
9. **Disposability:** starts in under a second, runs migrations at start, and shuts down cleanly on
   SIGTERM.
10. **Dev/prod parity:** `make dev` runs the same Python and Node images with source mounted and
    reload on; `make up` runs the built image.
11. **Logs:** a stream of JSON lines on stdout. No log files.
12. **Admin processes:** one-off commands in the same image:
    `docker compose run --rm smriti smriti import-arc /import/arc.db`, `smriti backup /data/backups`,
    `smriti purge-trash`, `smriti migrate`.

## 6. Importing from Arc (`smriti import-arc <path>`)

This command runs only on an empty Smriti database. It opens the Arc file read-only and imports in
one transaction.

- projects → projects (same key and name; `next_number` is kept).
- Items of type `task` or `note`, not deleted → tasks:
  - Status: `backlog` → `todo`; `today` → `todo` with `planned_on` = the import date; `in_progress` → `doing`; `done` → `done`.
  - Priority: none 0, low 1, medium 2, high 3, urgent 4.
  - Kept as they were: `labels` → `tags`, `description` → `body`, `recurrence` → `repeat`, `parent_id`,
    the project number (so keys stay the same), and the timestamps.
- Items of type `learning`, not deleted, and not the ticket of a book or article → sources of kind `topic`
  (or `video` when the url is YouTube):
  - Status: `backlog` → `queued`, `in_progress` or `today` → `active`, `done` → `done`.
- articles → sources of kind `article` (or `video` when the url is YouTube):
  - Status: `unread` → `queued`, `reading` → `active`, `read` → `done`.
  - The names of the article's collections, plus its tags → `tags`. `notes` → `body`, `description` → `summary`.
- books → sources of kind `book`:
  - Status: `want` → `queued`, `reading` → `active`, `finished` → `done`.
  - `pages` → `total`, `current_page` → `progress`, `olid` → `ref`, `cover` → `image`.
- A book's or article's ticket item: its worklogs, comments and history move onto that source; the
  ticket itself is not imported.
- worklogs → ended sessions: `started_at`, `ended_at = started_at + minutes`, `minutes`,
  `comment` → `note`, on the matching task or source.
- comments → notes. history → events (only for imported subjects).
- subtasks → checks.
- jots → captures:
  - Status: `open` → `open`, `converted` → `kept` (linked to the imported task or source), `archived` → `dismissed`.
  - `body` → `text`.
- revisions → revisits:
  - `question` → `prompt`, `notes` → `body`.
  - Status: `active` → `active`, `revised` → `retired`.
  - revision_sessions → revisit sessions.
- daily_reviews → days.
- quotes → quotes. `smriti import-quotes PATH` copies only the quotes, for a database that already had data.
- Items in Arc's trash come across still deleted, so they sit in Smriti's trash with their time, comments
  and history and are purged on the usual schedule. `smriti import-arc-trash PATH` adds them (and video
  thumbnails) to a database imported before this rule, and running it twice changes nothing.
- Video sources get YouTube's own thumbnail as `image`.
- Arc's Obsidian note paths come across on their sources (with Arc's key, which the note carries as
  `arc_id`), so exporting a source rewrites Arc's note in place. `smriti import-arc-obsidian PATH` adds
  them to a database imported before this rule.
- The rest is not imported: weekend tables, settings, the active timer.

It prints a count of what was imported.

## 7. Changes

- Schema 2 (`002_revisit.sql`): "card" is renamed "revisit" everywhere. That covers the table,
  `revisit_id` in sessions and captures, the search kind, `/api/revisits` and `revisits_due`.
- Schema 3 (`003_quotes.sql`): adds quotes back, with `/api/quotes` and a quote line on Today.
- The app is renamed from Kiln to Smriti: the package (`api/smriti`), the `smriti` admin command,
  `SMRITI_*` settings, `/data/smriti.db`, the `smriti-*` browser keys (old `kiln-*` ones are copied over
  once), and the `smriti-app` container.
- Schema 4 (`004_obsidian.sql`): Obsidian export is back. Sources gain `obsidian_path`, `obsidian_key`
  and `exported_at`; a note carries `smriti_id: SRC-<id>`, and Smriti only overwrites or removes notes
  that carry its id (or Arc's).
- Child tasks, Jira style: a task's `parent_id` can point at another task, and that one at another, up
  to 10 levels; the API refuses loops. `PATCH /api/tasks/{id}` with `{"status": "done", "close_children": true}`
  also closes every open child, grandchild and so on. Deleting a task sends its children to the trash
  with it (same `deleted_at`); the trash lists them under the parent, restoring the parent brings them
  back, and a child deleted with its parent cannot be restored on its own (409). Changing a task's parent
  is logged as a `parent` event.
