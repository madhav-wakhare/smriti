/** Dialogs for creating a task, source, revisit or capture. Short forms: the rest can be set once it is open. */
import clsx from "clsx";
import { ChevronDown, Link2, Search } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { api, qs, type BookHit, type Capture, type Revisit, type LinkInfo, type Priority, type Source, type SourceKind, type Task, type TaskStatus } from "../lib/api";
import { PRIORITY, SOURCE_KIND } from "../lib/format";
import { useLocalState, useProjects } from "../lib/hooks";
import { errText, parseTags, useTodayDate, useWrite } from "./common";
import { useActions } from "./Layout";
import { Button, Checkbox, DateInput, Input, Modal, Select, Textarea, useToast } from "./ui";

export type NewTaskDefaults = { project_id?: number; status?: TaskStatus; planned_on?: string; parent_id?: number; priority?: Priority };

function Label({ text, hint, children }: { text: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[12px] font-medium text-fg-2">{text}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-fg-3">{hint}</span>}
    </label>
  );
}

function MoreToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} aria-expanded={open} className="flex items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg">
      <ChevronDown size={14} className={clsx("transition-transform", !open && "-rotate-90")} />
      More
    </button>
  );
}

// ---------------------------------------------------------------- task

export function NewTaskModal({ defaults, onClose }: { defaults: NewTaskDefaults | null; onClose: () => void }) {
  const open = defaults !== null;
  const { data: projects } = useProjects();
  const today = useTodayDate();
  const write = useWrite();
  const toast = useToast();
  const a = useActions();
  const [lastProject, setLastProject] = useLocalState<number | null>("smriti-last-project", null);

  const [projectId, setProjectId] = useState<number | "">("");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>(0);
  const [planToday, setPlanToday] = useState(false);
  const [due, setDue] = useState("");
  const [tags, setTags] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const active = (projects ?? []).filter((p) => !p.archived);

  // A fresh form each time the dialog opens.
  useEffect(() => {
    if (!defaults) return;
    setTitle("");
    setPriority(defaults.priority ?? 0);
    setPlanToday(defaults.planned_on ? defaults.planned_on === today : false);
    setDue("");
    setTags("");
    setMore(false);
    setBusy(false);
  }, [defaults]);

  // Project: the default, else the last one used, else the first.
  useEffect(() => {
    if (!defaults) return;
    const pick = defaults.project_id ?? (active.some((p) => p.id === lastProject) ? lastProject : active[0]?.id);
    setProjectId(pick ?? "");
  }, [defaults, projects]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !projectId || busy) return;
    setBusy(true);
    const planned = planToday ? today : defaults?.planned_on && defaults.planned_on !== today ? defaults.planned_on : null;
    const t = await write(() =>
      api.post<Task>("/tasks", {
        project_id: projectId,
        title: title.trim(),
        status: defaults?.status ?? "todo",
        priority,
        planned_on: planned,
        due_on: due || null,
        tags: parseTags(tags),
        parent_id: defaults?.parent_id ?? null,
      }),
    );
    setBusy(false);
    if (!t) return;
    setLastProject(Number(projectId));
    toast(`Created ${t.key}`, "default", { label: "Open", onClick: () => a.openTask(t.id) });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={defaults?.parent_id ? "New subtask" : "New task"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-task" disabled={!title.trim() || !projectId || busy}>
            Create task
          </Button>
        </>
      }
    >
      {projects && !active.length ? (
        <p className="text-[14px] text-fg-2">
          You need a project first.{" "}
          <Link to="/settings" onClick={onClose} className="text-accent hover:underline">
            Add one in Settings
          </Link>
          .
        </p>
      ) : (
        <form id="new-task" onSubmit={submit} className="space-y-4">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What needs doing?" aria-label="Title" className="!h-10 text-[15px]" />
          <div className="grid gap-4 sm:grid-cols-3">
            <Label text="Project">
              <Select value={projectId} onChange={(e) => setProjectId(Number(e.target.value) || "")} disabled={!!defaults?.parent_id}>
                {active.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </Label>
            <Label text="Priority">
              <Select value={priority} onChange={(e) => setPriority(Number(e.target.value) as Priority)}>
                {PRIORITY.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </Label>
            <Label text="Due date">
              <DateInput value={due} onChange={setDue} placeholder="None" />
            </Label>
          </div>
          <Checkbox checked={planToday} onChange={setPlanToday} label={<span className="text-[14px]">Add to today</span>} />
          <MoreToggle open={more} onToggle={() => setMore(!more)} />
          {more && (
            <Label text="Tags" hint="Separate with commas.">
              <Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="e.g. writing, infra" />
            </Label>
          )}
          {/* Enter in any field submits. */}
          <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------- source

type SourceDraft = { title: string; url: string; author: string; site: string; summary: string; image: string | null; total: string; ref: string | null; tags: string };
const EMPTY_SOURCE: SourceDraft = { title: "", url: "", author: "", site: "", summary: "", image: null, total: "", ref: null, tags: "" };
const KIND_ORDER: SourceKind[] = ["article", "video", "book", "topic"];

export function NewSourceModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const write = useWrite();
  const toast = useToast();
  const a = useActions();
  const [kind, setKind] = useLocalState<SourceKind>("smriti-last-source-kind", "article");
  const [d, setD] = useState<SourceDraft>(EMPTY_SOURCE);
  const [looking, setLooking] = useState(false);
  const [bookQ, setBookQ] = useState("");
  const [hits, setHits] = useState<BookHit[] | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const lookedUp = useRef("");

  useEffect(() => {
    if (!open) return;
    setD(EMPTY_SOURCE);
    setBookQ("");
    setHits(null);
    setMore(false);
    setBusy(false);
    lookedUp.current = "";
  }, [open]);

  const set = (patch: Partial<SourceDraft>) => setD((x) => ({ ...x, ...patch }));

  const lookup = async (url = d.url.trim()) => {
    if (!/^https?:\/\//i.test(url) || lookedUp.current === url) return;
    lookedUp.current = url;
    setLooking(true);
    try {
      const info = await api.post<LinkInfo>("/lookup/link", { url });
      setD((x) => ({
        ...x,
        title: x.title || info.title,
        site: info.site || x.site,
        author: x.author || info.author,
        summary: x.summary || info.summary,
        image: info.image ?? x.image,
      }));
      if (kind !== "topic") setKind(info.kind);
    } catch (e) {
      toast(`Could not read that link: ${errText(e)}`, "error");
    } finally {
      setLooking(false);
    }
  };

  const searchBooks = async () => {
    if (!bookQ.trim()) return;
    setLooking(true);
    try {
      setHits(await api.get<BookHit[]>(`/lookup/books${qs({ q: bookQ.trim() })}`));
    } catch (e) {
      toast(`Book search failed: ${errText(e)}`, "error");
    } finally {
      setLooking(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || (!d.title.trim() && !d.url.trim())) return;
    setBusy(true);
    const total = Math.round(Number(d.total));
    const s = await write(() =>
      api.post<Source>("/sources", {
        kind,
        title: d.title.trim(),
        url: d.url.trim() || null,
        author: d.author.trim(),
        site: d.site.trim(),
        summary: d.summary.trim(),
        image: d.image,
        total: kind === "book" && total > 0 ? total : null,
        ref: kind === "book" ? d.ref : null,
        tags: parseTags(d.tags),
      }),
    );
    setBusy(false);
    if (!s) return;
    toast(`Added “${s.title}”`);
    onClose();
    a.openSource(s.id);
  };

  const book = kind === "book";

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a source"
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-source" disabled={busy || (!d.title.trim() && !d.url.trim())}>
            Add source
          </Button>
        </>
      }
    >
      {/* The kind chips sit outside the form: their buttons would otherwise submit it. */}
      <div className="mb-5 flex flex-wrap gap-2" role="radiogroup" aria-label="Kind">
        {KIND_ORDER.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={clsx(
              "h-8 rounded-full border px-3.5 text-[13px] transition-colors",
              kind === k ? "border-accent bg-accent text-accent-fg" : "border-line text-fg-2 hover:border-line-strong hover:text-fg",
            )}
          >
            {SOURCE_KIND.find((x) => x.value === k)?.label}
          </button>
        ))}
      </div>

      <form id="new-source" onSubmit={submit} className="space-y-4">
        {book ? (
          <div className="space-y-2">
            <Label text="Find the book">
              <div className="flex gap-2">
                <Input
                  autoFocus
                  icon={<Search size={14} />}
                  className="flex-1"
                  value={bookQ}
                  onChange={(e) => setBookQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      searchBooks();
                    }
                  }}
                  placeholder="Title or author"
                />
                <Button type="button" onClick={searchBooks} disabled={looking || !bookQ.trim()}>
                  {looking ? "Searching…" : "Search"}
                </Button>
              </div>
            </Label>
            {hits && (
              <ul className="max-h-56 space-y-0.5 overflow-y-auto rounded-lg border border-line p-1">
                {!hits.length && <li className="px-2.5 py-2 text-[13px] text-fg-3">No books found. Type the details below instead.</li>}
                {hits.map((h) => (
                  <li key={h.ref}>
                    <button
                      type="button"
                      onClick={() => {
                        set({ title: h.title, author: h.author, total: h.total ? String(h.total) : "", image: h.image, ref: h.ref });
                        setHits(null);
                      }}
                      className={clsx("flex w-full items-baseline gap-3 rounded-md px-2.5 py-1.5 text-left text-[14px] hover:bg-surface-2", d.ref === h.ref && "bg-surface-2")}
                    >
                      <span className="min-w-0 flex-1 truncate">{h.title}</span>
                      <span className="max-w-[45%] shrink-0 truncate text-[12px] text-fg-3">
                        {h.author}
                        {h.year ? ` · ${h.year}` : ""}
                        {h.total ? ` · ${h.total} pages` : ""}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <Label text="Link" hint={looking ? "Reading the page…" : kind === "topic" ? "Optional." : "Paste a link and the title fills in."}>
            <Input
              autoFocus
              icon={<Link2 size={14} />}
              value={d.url}
              onChange={(e) => set({ url: e.target.value })}
              onPaste={(e) => {
                const url = e.clipboardData.getData("text").trim();
                if (/^https?:\/\//i.test(url)) setTimeout(() => lookup(url));
              }}
              onBlur={() => lookup()}
              placeholder="https://…"
            />
          </Label>
        )}

        <Label text="Title">
          <Input value={d.title} onChange={(e) => set({ title: e.target.value })} placeholder={kind === "topic" ? "What you want to learn" : ""} />
        </Label>
        {book && (
          <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
            <Label text="Author">
              <Input value={d.author} onChange={(e) => set({ author: e.target.value })} />
            </Label>
            <Label text="Pages">
              <Input type="number" min={1} inputMode="numeric" value={d.total} onChange={(e) => set({ total: e.target.value })} />
            </Label>
          </div>
        )}

        <MoreToggle open={more} onToggle={() => setMore(!more)} />
        {more && (
          <div className="space-y-4">
            {!book && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Label text="Author">
                  <Input value={d.author} onChange={(e) => set({ author: e.target.value })} />
                </Label>
                <Label text="Site">
                  <Input value={d.site} onChange={(e) => set({ site: e.target.value })} />
                </Label>
              </div>
            )}
            {!book && (
              <Label text="Summary">
                <Textarea value={d.summary} onChange={(e) => set({ summary: e.target.value })} className="!min-h-16" />
              </Label>
            )}
            <Label text="Tags" hint="Separate with commas.">
              <Input value={d.tags} onChange={(e) => set({ tags: e.target.value })} placeholder="e.g. rust, databases" />
            </Label>
          </div>
        )}
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- revisit

export function RevisitModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const write = useWrite();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle("");
    setBody("");
    setUrl("");
    setBusy(false);
  }, [open]);

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!title.trim() || busy) return;
    setBusy(true);
    const c = await write(() => api.post<Revisit>("/revisits", { title: title.trim(), body: body.trim(), url: url.trim() || null }), "Added to Revisit");
    setBusy(false);
    if (c) onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add to Revisit"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-revisit" disabled={!title.trim() || busy}>
            Add to Revisit
          </Button>
        </>
      }
    >
      <form id="new-revisit" onSubmit={submit} className="space-y-4">
        <Label text="Question">
          <Input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What do you want to remember?" />
        </Label>
        <Label text="Answer">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit();
            }}
            placeholder="The answer, in your own words"
          />
        </Label>
        <Label text="Link (optional)">
          <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
        </Label>
        <button type="submit" className="hidden" aria-hidden tabIndex={-1} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- capture

export function CaptureModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const write = useWrite();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setText("");
    setBusy(false);
  }, [open]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim() || busy) return;
    setBusy(true);
    const c = await write(() => api.post<Capture>("/captures", { text: text.trim() }), "Saved to your inbox");
    setBusy(false);
    if (c) onClose();
  };

  return (
    <Modal open={open} onClose={onClose} title="Capture">
      <form onSubmit={submit}>
        <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="What's on your mind?" aria-label="What's on your mind?" className="!h-10 text-[15px]" />
        <p className="mt-2 text-[12px] text-fg-3">Press Enter to save it to your inbox.</p>
      </form>
    </Modal>
  );
}
