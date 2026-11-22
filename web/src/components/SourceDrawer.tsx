/**
 * A source, opened. The same window as a task: title, summary and link at the top, then your notes,
 * time spent, dated notes and what to revisit. On the right: status, progress for a book, tags and link;
 * author, site and history under "More". Every field saves when you leave it. Opened by ?source=ID.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, ExternalLink, Minus, Plus, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, type SourceFull, type SourceStatus } from "../lib/api";
import { fmtDate, fmtTime } from "../lib/format";
import { ObsidianIcon, useObsidianExport } from "./ObsidianIcon";
import { BlurInput, BlurTextarea, parseTags, useWrite } from "./common";
import { useActions } from "./Layout";
import { KIND_LABEL, Meter, STATUS_LABEL, Thumb, ago } from "./learn/bits";
import { TimeBox } from "./time";
import { Button, IconButton, Input, Tabs, Textarea, useToast } from "./ui";

export function SourceDrawer({ sourceId, onClose }: { sourceId: number | null; onClose: () => void }) {
  useEffect(() => {
    if (!sourceId) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest("input,textarea,select") && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [sourceId, onClose]);
  if (!sourceId) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-3 sm:p-6 sm:pt-[5vh]">
      <div className="anim-fade fixed inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Source" className="anim-pop relative w-full max-w-[920px] rounded-xl border border-line-strong bg-bg shadow-2xl">
        <SourceBody key={sourceId} id={sourceId} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

function SourceBody({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: s, isLoading, error } = useQuery({ queryKey: ["sources", id], queryFn: () => api.get<SourceFull>(`/sources/${id}`) });
  const write = useWrite();
  const toast = useToast();
  const { openSource } = useActions();
  const [more, setMore] = useState(false);

  if (isLoading) return <p className="p-8 text-[14px] text-fg-3">Loading…</p>;
  if (error || !s)
    return (
      <div className="flex items-center justify-between p-6 text-[14px] text-fg-2">
        This source could not be loaded. It may have been deleted.
        <Button onClick={onClose}>Close</Button>
      </div>
    );

  const patch = (body: Record<string, unknown>) => write(() => api.patch(`/sources/${id}`, body));

  const remove = async () => {
    const ok = await write(async () => (await api.del(`/sources/${id}`), true));
    if (!ok) return;
    onClose();
    toast(`Deleted “${s.title}”`, "default", {
      label: "Undo",
      onClick: () => write(() => api.post(`/trash/source/${id}/restore`)).then(() => openSource(id)),
    });
  };

  return (
    <>
      <div className="flex h-12 items-center gap-3 border-b border-line pl-5 pr-2 text-[13px] text-fg-2">
        <span>{KIND_LABEL[s.kind]}</span>
        <span className="flex-1" />
        <ObsidianButton source={s} />
        <IconButton aria-label="Delete source" title="Delete source" onClick={remove}>
          <Trash2 size={15} />
        </IconButton>
        <IconButton aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>

      <div className="grid md:grid-cols-[1fr_260px]">
        <div className="min-w-0 space-y-7 p-5 md:p-6">
          <div className="flex gap-4">
            {s.image && <Thumb src={s.image} kind={s.kind} className={s.kind === "book" ? "h-24 w-16" : "size-16"} />}
            <div className="min-w-0 flex-1 space-y-2">
              <BlurInput
                value={s.title}
                onSave={(v) => v.trim() && patch({ title: v.trim() })}
                aria-label="Title"
                className="!h-auto !border-transparent !bg-transparent !px-0 text-[22px] font-semibold hover:!border-transparent focus:!border-transparent"
              />
              {(s.author || s.site || s.url) && (
                <p className="flex flex-wrap items-center gap-x-3 text-[13px] text-fg-2">
                  {[s.author, s.site].filter(Boolean).join(" · ")}
                  {s.url && (
                    <a href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-accent hover:underline">
                      Open link <ExternalLink size={12} />
                    </a>
                  )}
                </p>
              )}
            </div>
          </div>
          <BlurTextarea value={s.summary} onSave={(v) => patch({ summary: v })} aria-label="Summary" placeholder="What it is about, in a line or two…" className="min-h-16" />

          <Section title="Your notes">
            <BlurTextarea value={s.body} onSave={(v) => patch({ body: v })} aria-label="Your notes" placeholder="What you took from it…" className="min-h-28" />
          </Section>

          <Section title="Time">
            <TimeBox subject={{ source_id: s.id }} sessions={s.sessions} loggedMin={s.logged_min} />
          </Section>

          <Section title="Notes">
            <Notes source={s} />
          </Section>

          <Section title="To revisit" hint={s.revisits.length ? String(s.revisits.length) : undefined}>
            <Revisits source={s} />
          </Section>
        </div>

        <aside className="space-y-5 border-t border-line p-5 md:border-t-0 md:border-l md:p-6">
          <Setting label="Status">
            <Tabs<SourceStatus>
              value={s.status}
              onChange={(v) => patch({ status: v })}
              tabs={(["queued", "active", "done"] as SourceStatus[]).map((v) => ({ value: v, label: STATUS_LABEL[v] }))}
            />
          </Setting>

          {s.kind === "book" && (
            <Setting label="Progress">
              <Progress source={s} onSave={patch} />
            </Setting>
          )}

          <Setting label="Tags">
            <BlurInput value={s.tags.join(", ")} onSave={(v) => patch({ tags: parseTags(v) })} placeholder="e.g. rust, databases" aria-label="Tags" />
          </Setting>

          <Setting label="Link">
            <BlurInput value={s.url ?? ""} onSave={(v) => patch({ url: v.trim() || null })} placeholder="https://…" aria-label="Link" />
          </Setting>

          <ObsidianNote source={s} />

          <button onClick={() => setMore(!more)} className="flex w-full items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg" aria-expanded={more}>
            <ChevronDown size={14} className={clsx("transition-transform", !more && "-rotate-90")} />
            More
          </button>
          {more && (
            <div className="space-y-5">
              <Setting label="Author">
                <BlurInput value={s.author} onSave={(v) => patch({ author: v.trim() })} placeholder="Who made it" aria-label="Author" />
              </Setting>
              <Setting label="Site">
                <BlurInput value={s.site} onSave={(v) => patch({ site: v.trim() })} placeholder="Where it lives" aria-label="Site" />
              </Setting>
              <History source={s} />
              <p className="text-[12px] text-fg-3">
                Added {fmtDate(s.created_at)}
                {s.started_at && ` · started ${fmtDate(s.started_at)}`}
                {s.done_at && ` · finished ${fmtDate(s.done_at)}`}
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2.5 flex items-baseline gap-2 text-[15px] font-semibold">
        {title}
        {hint && <span className="text-[13px] font-normal text-fg-3">{hint}</span>}
      </h3>
      {children}
    </section>
  );
}

/** The gem in the header: save to Obsidian, or update the note. Accent-coloured once saved. Hidden with no vault. */
function ObsidianButton({ source }: { source: SourceFull }) {
  const ob = useObsidianExport(source);
  if (!ob.available) return null;
  return (
    <IconButton aria-label={ob.label} title={ob.label} onClick={ob.run} disabled={ob.busy} className={clsx(ob.saved && "text-accent")}>
      <ObsidianIcon size={15} />
    </IconButton>
  );
}

/** Where the note is, once saved. The gem in the header writes it. */
function ObsidianNote({ source }: { source: SourceFull }) {
  if (!source.obsidian_path) return null;
  return (
    <Setting label="Obsidian">
      <p className="flex items-start gap-1.5 text-[13px] break-words text-fg-2" title={source.obsidian_path}>
        <ObsidianIcon size={13} className="mt-0.5 shrink-0 text-accent" />
        {source.obsidian_path}
      </p>
      {source.exported_at && <p className="mt-1 text-[12px] text-fg-3">Last written {fmtDate(source.exported_at)}</p>}
    </Setting>
  );
}

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-fg-2">{label}</p>
      {children}
    </div>
  );
}

/** Page number with - and + buttons, the total, and a bar. */
function Progress({ source: s, onSave }: { source: SourceFull; onSave: (body: Record<string, unknown>) => void }) {
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.round(Number(v))));
  const step = (d: number) => onSave({ progress: Math.max(0, Math.min(s.total ?? Infinity, s.progress + d)) });
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[13px]">
        <IconButton aria-label="One page back" onClick={() => step(-1)} disabled={s.progress <= 0} className="!border-line">
          <Minus size={14} />
        </IconButton>
        <BlurInput
          inputMode="numeric"
          value={String(s.progress)}
          onSave={(v) => {
            const n = num(v);
            if (n !== null && Number.isFinite(n)) onSave({ progress: n });
          }}
          aria-label="Current page"
          className="!w-16 text-center font-mono tabular-nums"
        />
        <IconButton aria-label="One page forward" onClick={() => step(1)} disabled={!!s.total && s.progress >= s.total} className="!border-line">
          <Plus size={14} />
        </IconButton>
        <span className="text-fg-2">of</span>
        <BlurInput
          inputMode="numeric"
          value={s.total ? String(s.total) : ""}
          onSave={(v) => {
            const n = num(v);
            if (n === null || Number.isFinite(n)) onSave({ total: n || null });
          }}
          placeholder="?"
          aria-label="Total pages"
          className="!w-16 text-center font-mono tabular-nums"
        />
      </div>
      {s.total ? (
        <>
          <Meter value={s.progress} total={s.total} />
          <p className="text-[12px] text-fg-3">
            {s.progress} of {s.total} pages · {Math.round((s.progress / s.total) * 100)}%
          </p>
        </>
      ) : null}
    </div>
  );
}

function Notes({ source }: { source: SourceFull }) {
  const write = useWrite();
  const [body, setBody] = useState("");
  const add = () => {
    const v = body.trim();
    if (v) write(() => api.post("/notes", { source_id: source.id, body: v })).then(() => setBody(""));
  };
  return (
    <div className="space-y-3">
      {source.notes.map((n) => (
        <div key={n.id} className="group rounded-lg border border-line px-3 py-2">
          <div className="mb-1 flex items-center justify-between text-[12px] text-fg-3">
            <span>
              {fmtDate(n.created_at)} {fmtTime(n.created_at)}
              {n.edited_at && " · edited"}
            </span>
            <button onClick={() => write(() => api.del(`/notes/${n.id}`))} className="opacity-0 group-hover:opacity-100 hover:text-critical focus:opacity-100">
              Delete
            </button>
          </div>
          <BlurTextarea
            value={n.body}
            onSave={(v) => v.trim() && write(() => api.patch(`/notes/${n.id}`, { body: v.trim() }))}
            aria-label="Note"
            className="!min-h-0 !border-transparent !bg-transparent !p-0"
            rows={Math.min(8, n.body.split("\n").length)}
          />
        </div>
      ))}
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) add();
        }}
        placeholder="Write a note…"
        aria-label="New note"
        className="min-h-16"
      />
      {body.trim() && (
        <Button size="sm" variant="primary" onClick={add}>
          Add note
        </Button>
      )}
    </div>
  );
}

function Revisits({ source }: { source: SourceFull }) {
  const write = useWrite();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const make = () => {
    const v = title.trim();
    if (v) write(() => api.post("/revisits", { source_id: source.id, title: v }), "Added to Revisit").then((r) => r && setTitle(""));
  };
  return (
    <div className="space-y-2">
      {source.revisits.length > 0 && (
        <ul className="space-y-1">
          {source.revisits.map((c) => (
            <li key={c.id}>
              <button onClick={() => navigate(`/revisit?item=${c.id}`)} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-surface-2">
                <span className={clsx("min-w-0 flex-1 truncate", c.status === "retired" && "text-fg-3")}>{c.title}</span>
                <span className="text-[12px] whitespace-nowrap text-fg-3">{c.status === "retired" ? "Retired" : `reviewed ${ago(c.reviewed_at)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          make();
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="A question to remember later" aria-label="Something to revisit" className="flex-1" />
        <Button type="submit" disabled={!title.trim()}>
          Add to Revisit
        </Button>
      </form>
    </div>
  );
}

function History({ source }: { source: SourceFull }) {
  const [open, setOpen] = useState(false);
  if (!source.events.length) return null;
  return (
    <Setting label="History">
      <button onClick={() => setOpen(!open)} className="text-[13px] text-fg-2 hover:text-fg">
        {open ? "Hide" : `Show ${source.events.length} changes`}
      </button>
      {open && (
        <ul className="mt-2 space-y-1 text-[12px] text-fg-2">
          {source.events.map((e) => (
            <li key={e.id}>
              <span className="text-fg-3">{fmtDate(e.at)}</span> {e.field}
              {e.new !== null && e.field !== "created" && <> → {e.new}</>}
            </li>
          ))}
        </ul>
      )}
    </Setting>
  );
}
