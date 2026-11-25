/**
 * Learn: everything you learn from (topics, articles, books, videos), on three shelves: In progress,
 * Up next and Finished (folded away by default). Collections on the left keep them organised; the kind
 * tabs and search narrow every shelf. ?collection= and ?kind= keep the choice in the address.
 */
import clsx from "clsx";
import { ChevronDown, Plus, Search } from "lucide-react";
import { useMemo, useState, type DragEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Ascii } from "../components/Ascii";
import { useActions } from "../components/Layout";
import { ObsidianIcon, useObsidianExport } from "../components/ObsidianIcon";
import { KIND_LABEL, KindIcon, Meter, Thumb } from "../components/learn/bits";
import { CollectionsSidebar, DRAG_TYPE } from "../components/learn/Collections";
import { Button, Input, PageHeader, Tabs } from "../components/ui";
import type { Source, SourceKind, SourceStatus } from "../lib/api";
import { SOURCE_KIND, fmtDate, fmtMin } from "../lib/format";
import { useLocalState, useSources, useToday } from "../lib/hooks";

/** The three shelves, in reading order. Finished ones fold away so the page stays about what's next. */
const SHELVES: { status: SourceStatus; title: string; note: string }[] = [
  { status: "active", title: "In progress", note: "What you are reading, watching or working through now." },
  { status: "queued", title: "Up next", note: "Saved to start later." },
  { status: "done", title: "Finished", note: "" },
];

export default function Learn() {
  const [params, setParams] = useSearchParams();
  const { newSource } = useActions();
  const { data: all, isLoading } = useSources();
  const { data: today } = useToday();
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useLocalState("smriti-learn-show-done", false);

  const kindParam = params.get("kind") ?? "";
  const kind = (SOURCE_KIND.some((k) => k.value === kindParam) ? kindParam : "") as SourceKind | "";
  const collection = Number(params.get("collection")) || null;

  const set = (key: string, value: string) =>
    setParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      return p;
    });

  const everything = useMemo(() => all ?? [], [all]);
  const sources = useMemo(() => (collection ? everything.filter((s) => s.collections.some((c) => c.id === collection)) : everything), [everything, collection]);
  const searching = q.trim().length > 0;
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return sources.filter(
      (s) => (!kind || s.kind === kind) && (!n || [s.title, s.author, s.site, s.summary, s.tags.join(" ")].some((f) => (f ?? "").toLowerCase().includes(n))),
    );
  }, [sources, kind, q]);
  const byStatus = (st: SourceStatus) => {
    const list = shown.filter((s) => s.status === st);
    // Newest first: the latest started, the latest saved, the latest finished.
    const at = (s: Source) => (st === "done" ? s.done_at : st === "active" ? s.started_at : s.created_at) ?? s.updated_at;
    return list.sort((a, b) => at(b).localeCompare(at(a)));
  };

  const count = (st: SourceStatus) => sources.filter((s) => s.status === st).length;
  const kinds: { value: SourceKind | ""; label: ReactNode }[] = [
    { value: "", label: <TabLabel text="All" n={sources.length} /> },
    ...SOURCE_KIND.map((k) => ({ value: k.value, label: <TabLabel text={`${k.label}s`} n={sources.filter((s) => s.kind === k.value).length} /> })),
  ];

  return (
    <>
      <PageHeader
        title="Learn"
        lede="Things you are learning from: topics, articles, books and videos."
        actions={
          <Button variant="primary" icon={<Plus size={14} />} onClick={newSource}>
            Add source
          </Button>
        }
      />
      <div className="grid gap-8 px-4 md:grid-cols-[200px_minmax(0,1fr)] md:px-8">
        <aside className="md:sticky md:top-4 md:self-start">
          <CollectionsSidebar selected={collection} onSelect={(id) => set("collection", id ? String(id) : "")} total={everything.length} />
        </aside>

        <div className="min-w-0 space-y-8">
          {sources.length > 0 && (
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-4">
              <Stat label="In progress" value={count("active")} />
              <Stat label="Up next" value={count("queued")} />
              <Stat label="Finished" value={count("done")} />
              <Stat label="Learning this week" value={fmtMin(today?.week.learning_min ?? 0)} />
            </dl>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <Tabs<SourceKind | ""> value={kind} onChange={(v) => set("kind", v)} tabs={kinds} />
            <Input
              icon={<Search size={14} />}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search title, author, site"
              aria-label="Search sources"
              className="w-full sm:ml-auto sm:w-72"
            />
          </div>

          {isLoading ? (
            <p className="py-10 text-[13px] text-fg-3">Loading…</p>
          ) : !sources.length ? (
            <div className="rounded-xl border border-line bg-surface py-10 text-center">
              <Ascii name="shelf" />
              <p className="mt-3 text-[14px] text-fg-2">Nothing here yet. Add something you want to learn from.</p>
              <Button variant="primary" icon={<Plus size={14} />} onClick={newSource} className="mt-4">
                Add source
              </Button>
            </div>
          ) : !shown.length ? (
            <p className="rounded-xl border border-line bg-surface py-12 text-center text-[14px] text-fg-2">Nothing matches. Try another kind or search.</p>
          ) : (
            SHELVES.map(({ status, title, note }) => {
              const list = byStatus(status);
              if (!list.length) return null;
              const folded = status === "done" && !showDone && !searching;
              return (
                <section key={status} aria-label={title}>
                  <header className="mb-3 flex items-baseline gap-2 border-b border-line pb-2">
                    <h2 className="text-[15px] font-semibold">{title}</h2>
                    <span className="font-mono text-[12px] text-fg-3">{list.length}</span>
                    {note && <span className="hidden text-[13px] text-fg-3 sm:inline">· {note}</span>}
                    {status === "done" && !searching && (
                      <button onClick={() => setShowDone(!showDone)} className="ml-auto flex items-center gap-1 text-[13px] text-fg-2 hover:text-fg">
                        {showDone ? "Hide" : "Show"} <ChevronDown size={14} className={clsx("transition-transform", showDone && "rotate-180")} />
                      </button>
                    )}
                  </header>
                  {folded ? null : status === "done" ? (
                    <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                      {list.map((s) => (
                        <DoneRow key={s.id} s={s} />
                      ))}
                    </ul>
                  ) : (
                    <ul className={clsx("grid gap-3", status === "active" ? "lg:grid-cols-2" : "sm:grid-cols-2 xl:grid-cols-3")}>
                      {list.map((s) => (
                        <SourceCard key={s.id} s={s} large={status === "active"} />
                      ))}
                    </ul>
                  )}
                </section>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

function TabLabel({ text, n }: { text: string; n: number }) {
  return (
    <span className="flex items-center gap-1.5">
      {text}
      <span className="font-mono text-[11px] text-fg-3">{n}</span>
    </span>
  );
}

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="text-[12px] text-fg-2">{label}</dt>
      <dd className="mt-0.5 font-mono text-[20px] tabular-nums">{value}</dd>
    </div>
  );
}

/** Drag a source onto a collection in the sidebar to file it there. */
const dragProps = (s: Source) => ({
  draggable: true,
  onDragStart: (e: DragEvent) => {
    e.dataTransfer.setData(DRAG_TYPE, String(s.id));
    e.dataTransfer.effectAllowed = "copy";
  },
});

/** "Book · Author", with the kind's icon. */
function Byline({ s }: { s: Source }) {
  const by = s.author || s.site;
  return (
    <span className="flex min-w-0 items-center gap-1.5 text-[12px] text-fg-2">
      <KindIcon kind={s.kind} size={12} className="shrink-0 text-fg-3" />
      <span className="shrink-0">{KIND_LABEL[s.kind]}</span>
      {by && <span className="truncate text-fg-3">· {by}</span>}
    </span>
  );
}

function SourceCard({ s, large }: { s: Source; large?: boolean }) {
  const { openSource } = useActions();
  const ob = useObsidianExport(s);
  const book = s.kind === "book";
  const thumb = large ? (book ? "h-24 w-16" : "size-20") : book ? "h-[68px] w-[46px]" : "size-14";
  return (
    <li className="group relative" {...dragProps(s)}>
      <button
        onClick={() => openSource(s.id)}
        className="flex h-full w-full gap-3.5 rounded-xl border border-line bg-surface p-3.5 text-left transition-colors hover:border-line-strong hover:bg-surface-2/50"
      >
        <Thumb src={s.image} kind={s.kind} className={thumb} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={clsx("line-clamp-2 pr-7 font-medium", large ? "text-[15px]" : "text-[14px]")}>{s.title || "Untitled"}</span>
          <Byline s={s} />
          {large && s.summary && <span className="line-clamp-2 text-[13px] text-fg-3">{s.summary}</span>}
          <span className="mt-auto flex items-center gap-2 pt-1.5 empty:hidden">
            {s.collections.map((c) => (
              <span key={c.id} className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-2">
                {c.name}
              </span>
            ))}
            {s.logged_min > 0 && <span className="ml-auto font-mono text-[12px] text-fg-3 tabular-nums">{fmtMin(s.logged_min)}</span>}
          </span>
          {book && s.total ? (
            <span className="mt-1 flex items-center gap-2">
              <Meter value={s.progress} total={s.total} className="flex-1" />
              <span className="shrink-0 font-mono text-[11px] text-fg-3 tabular-nums">
                {s.progress}/{s.total}
              </span>
            </span>
          ) : null}
        </span>
      </button>
      <ObsidianButton s={s} ob={ob} />
    </li>
  );
}

/** A finished source: one quiet line. */
function DoneRow({ s }: { s: Source }) {
  const { openSource } = useActions();
  const ob = useObsidianExport(s);
  return (
    <li className="group relative" {...dragProps(s)}>
      <button onClick={() => openSource(s.id)} className="flex w-full items-center gap-3 px-3.5 py-2.5 text-left hover:bg-surface-2/50">
        <Thumb src={s.image} kind={s.kind} className="size-8" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[14px]">{s.title || "Untitled"}</span>
          <Byline s={s} />
        </span>
        {s.logged_min > 0 && <span className="font-mono text-[12px] text-fg-3 tabular-nums">{fmtMin(s.logged_min)}</span>}
        {s.done_at && <span className="w-16 text-right text-[12px] text-fg-3">{fmtDate(s.done_at.slice(0, 10))}</span>}
        <span className="w-7" aria-hidden />
      </button>
      <ObsidianButton s={s} ob={ob} row />
    </li>
  );
}

/** Save to Obsidian on hover; a small mark once it is there. */
function ObsidianButton({ s, ob, row }: { s: Source; ob: ReturnType<typeof useObsidianExport>; row?: boolean }) {
  const pos = row ? "top-1/2 right-2.5 -translate-y-1/2" : "top-2.5 right-2.5";
  if (ob.available)
    return (
      <button
        onClick={ob.run}
        disabled={ob.busy}
        title={ob.label}
        aria-label={ob.label}
        className={clsx(
          "absolute flex size-7 items-center justify-center rounded-full border border-line bg-bg transition-opacity hover:border-accent hover:text-accent focus:opacity-100",
          pos,
          s.obsidian_path ? "text-accent opacity-40 group-hover:opacity-100" : "text-fg-2 opacity-0 group-hover:opacity-100",
        )}
      >
        <ObsidianIcon size={13} />
      </button>
    );
  return s.obsidian_path ? <ObsidianIcon size={12} className={clsx("pointer-events-none absolute text-accent", row ? "top-1/2 right-4 -translate-y-1/2" : "top-4 right-4")} /> : null;
}
