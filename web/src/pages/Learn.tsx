/**
 * Learn: everything you learn from (topics, articles, books, videos) as cards. Collections on the left
 * keep them organised; filter by kind and status, search, and click a card to open it. ?collection=,
 * ?kind= and ?status= keep the choice in the address.
 */
import clsx from "clsx";
import { Plus, Search } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Ascii } from "../components/Ascii";
import { useActions } from "../components/Layout";
import { ObsidianIcon, useObsidianExport } from "../components/ObsidianIcon";
import { Meter, STATUS_LABEL, StatusPill, Thumb } from "../components/learn/bits";
import { CollectionsSidebar, DRAG_TYPE } from "../components/learn/Collections";
import { Button, Input, PageHeader, Tabs } from "../components/ui";
import type { Source, SourceKind, SourceStatus } from "../lib/api";
import { SOURCE_KIND, fmtMin } from "../lib/format";
import { useSources, useToday } from "../lib/hooks";

type StatusFilter = SourceStatus | "all";
const STATUSES: StatusFilter[] = ["queued", "active", "done", "all"];

export default function Learn() {
  const [params, setParams] = useSearchParams();
  const { newSource } = useActions();
  const { data: all, isLoading } = useSources();
  const { data: today } = useToday();
  const [q, setQ] = useState("");

  const kindParam = params.get("kind") ?? "";
  const kind = (SOURCE_KIND.some((k) => k.value === kindParam) ? kindParam : "") as SourceKind | "";
  const collection = Number(params.get("collection")) || null;
  const statusParam = params.get("status") ?? "";
  const status: StatusFilter = STATUSES.includes(statusParam as StatusFilter) ? (statusParam as StatusFilter) : "all";

  const set = (key: string, value: string) =>
    setParams((p) => {
      if (value && value !== "all") p.set(key, value);
      else p.delete(key);
      return p;
    });

  const everything = useMemo(() => all ?? [], [all]);
  const sources = useMemo(() => (collection ? everything.filter((s) => s.collections.some((c) => c.id === collection)) : everything), [everything, collection]);
  const ofKind = useMemo(() => sources.filter((s) => !kind || s.kind === kind), [sources, kind]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return ofKind.filter(
      (s) =>
        (status === "all" || s.status === status) &&
        (!n || [s.title, s.author, s.site, s.summary, s.tags.join(" ")].some((f) => (f ?? "").toLowerCase().includes(n))),
    );
  }, [ofKind, status, q]);

  const inProgress = sources.filter((s) => s.status === "active").length;
  const kinds: { value: SourceKind | ""; label: string }[] = [{ value: "", label: "All" }, ...SOURCE_KIND.map((k) => ({ value: k.value, label: `${k.label}s` }))];

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
      <div className="grid gap-6 px-4 md:grid-cols-[200px_minmax(0,1fr)] md:px-8">
        <aside className="md:sticky md:top-4 md:self-start">
          <CollectionsSidebar selected={collection} onSelect={(id) => set("collection", id ? String(id) : "")} total={everything.length} />
        </aside>
      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          {kinds.map((k) => (
            <Chip key={k.value || "all"} on={kind === k.value} onClick={() => set("kind", k.value)}>
              {k.label}
              <span className="font-mono text-[11px] opacity-70">{sources.filter((s) => !k.value || s.kind === k.value).length}</span>
            </Chip>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Tabs<StatusFilter>
            value={status}
            onChange={(v) => set("status", v)}
            tabs={STATUSES.map((v) => ({ value: v, label: v === "all" ? "All" : STATUS_LABEL[v] }))}
          />
          <Input
            icon={<Search size={14} />}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search title, author, site"
            aria-label="Search sources"
            className="w-full sm:ml-auto sm:w-72"
          />
        </div>

        {sources.length > 0 && (
          <p className="text-[13px] text-fg-2">
            {inProgress} in progress · {fmtMin(today?.week.learning_min ?? 0)} spent learning this week
          </p>
        )}

        {isLoading ? (
          <p className="py-10 text-[13px] text-fg-3">Loading…</p>
        ) : shown.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((s) => (
              <SourceCard key={s.id} s={s} />
            ))}
          </ul>
        ) : ofKind.length ? (
          <p className="rounded-xl border border-line bg-surface py-12 text-center text-[14px] text-fg-2">Nothing matches. Try another status or search.</p>
        ) : (
          <div className="rounded-xl border border-line bg-surface py-10 text-center">
            <Ascii name="shelf" />
            <p className="mt-3 text-[14px] text-fg-2">Nothing here yet. Add something you want to learn from.</p>
            <Button variant="primary" icon={<Plus size={14} />} onClick={newSource} className="mt-4">
              Add source
            </Button>
          </div>
        )}
      </div>
      </div>
    </>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={clsx(
        "flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] transition-colors",
        on ? "border-accent bg-accent text-accent-fg" : "border-line text-fg-2 hover:border-line-strong hover:text-fg",
      )}
    >
      {children}
    </button>
  );
}

function SourceCard({ s }: { s: Source }) {
  const { openSource } = useActions();
  const ob = useObsidianExport(s);
  const book = s.kind === "book";
  const byline = [s.author, s.site].filter(Boolean).join(" · ");
  return (
    <li
      className="group relative"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(DRAG_TYPE, String(s.id));
        e.dataTransfer.effectAllowed = "copy";
      }}
    >
      <button
        onClick={() => openSource(s.id)}
        className="flex h-full w-full gap-3 rounded-xl border border-line bg-surface p-3 text-left transition-colors hover:border-line-strong hover:bg-surface-2/50"
      >
        <Thumb src={s.image} kind={s.kind} className={book ? "h-[72px] w-12" : "size-14"} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="line-clamp-2 pr-7 text-[14px] font-medium">{s.title || "Untitled"}</span>
          {byline && <span className="truncate text-[12px] text-fg-2">{byline}</span>}
          {s.collections.length > 0 && <span className="truncate text-[12px] text-fg-3">{s.collections.map((c) => c.name).join(" · ")}</span>}
          <span className="mt-auto flex items-center gap-2 pt-2">
            <StatusPill status={s.status} />
            {s.logged_min > 0 && <span className="font-mono text-[12px] text-fg-3 tabular-nums">{fmtMin(s.logged_min)}</span>}
            {s.obsidian_path && <ObsidianIcon size={12} className="ml-auto shrink-0 text-accent" />}
          </span>
          {book && s.total ? (
            <span className="mt-2 block">
              <Meter value={s.progress} total={s.total} />
              <span className="mt-1 block text-[12px] text-fg-3">
                {s.progress} of {s.total} pages
              </span>
            </span>
          ) : null}
        </span>
      </button>
      {ob.available && (
        <button
          onClick={ob.run}
          disabled={ob.busy}
          title={ob.label}
          aria-label={ob.label}
          className="absolute top-2 right-2 flex size-7 items-center justify-center rounded-full border border-line bg-bg text-fg-2 opacity-0 transition-opacity group-hover:opacity-100 hover:border-accent hover:text-accent focus:opacity-100"
        >
          <ObsidianIcon size={13} />
        </button>
      )}
    </li>
  );
}
