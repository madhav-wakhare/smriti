/**
 * Search (Ctrl/Cmd K): finds tasks, sources, revisits and captures, and offers pages to go to and things
 * to create. Arrow keys move, Enter opens.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, qs, type SearchHit } from "../lib/api";
import { useActions } from "./Layout";
import { GO_TO } from "./Shortcuts";
import { Kbd } from "./ui";

type Entry = { id: string; group: string; label: string; hint?: string; sub?: string; snippet?: string; run: () => void };

const GROUP_OF: Record<SearchHit["kind"], string> = { task: "Tasks", source: "Sources", revisit: "Revisit", capture: "Inbox" };
const ORDER = ["Tasks", "Sources", "Revisit", "Inbox", "Go to", "Create"];

/** A search snippet, with [matched] words highlighted. */
function Snippet({ text }: { text: string }) {
  return (
    <span className="block truncate text-[12px] text-fg-3">
      {text.split(/(\[[^\]]*\])/g).map((p, i) =>
        p.startsWith("[") && p.endsWith("]") ? (
          <mark key={i} className="rounded-sm bg-accent-soft px-0.5 text-fg">
            {p.slice(1, -1)}
          </mark>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </span>
  );
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [sel, setSel] = useState(0);
  const navigate = useNavigate();
  const actions = useActions();
  // The shell rebuilds its actions on every render; entries call the latest through this ref.
  const aRef = useRef(actions);
  aRef.current = actions;
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 150);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    if (open) {
      setQ("");
      setDebounced("");
      setSel(0);
    }
  }, [open]);

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ["search", debounced],
    queryFn: () => api.get<SearchHit[]>(`/search${qs({ q: debounced })}`),
    enabled: open && debounced.length > 0,
  });

  const entries = useMemo(() => {
    const out: Entry[] = [];
    const run = (fn: () => void) => () => {
      onClose();
      fn();
    };
    if (debounced)
      for (const h of hits)
        out.push({
          id: `${h.kind}-${h.id}`,
          group: GROUP_OF[h.kind],
          label: h.title,
          sub: h.key ?? undefined,
          snippet: h.snippet,
          run: run(() =>
            h.kind === "task" ? aRef.current.openTask(h.id) : h.kind === "source" ? aRef.current.openSource(h.id) : h.kind === "revisit" ? navigate(`/revisit?item=${h.id}`) : navigate("/inbox"),
          ),
        });
    const needle = q.trim().toLowerCase();
    const matches = (s: string) => !needle || s.toLowerCase().includes(needle);
    const pages: { label: string; to: string; keys?: string }[] = [
      ...Object.entries(GO_TO).map(([k, g]) => ({ label: g.label, to: g.to, keys: `G ${k.toUpperCase()}` })),
      { label: "Books", to: "/learn?kind=book" },
      { label: "Articles", to: "/learn?kind=article" },
      { label: "Videos", to: "/learn?kind=video" },
      { label: "Topics", to: "/learn?kind=topic" },
      { label: "Trash", to: "/trash" },
    ];
    for (const p of pages) if (matches(p.label) || matches(`go to ${p.label}`)) out.push({ id: `go-${p.to}`, group: "Go to", label: p.label, hint: p.keys, run: run(() => navigate(p.to)) });
    const acts: { label: string; keys: string; fn: () => void }[] = [
      { label: "New task", keys: "C", fn: () => aRef.current.newTask() },
      { label: "Add a source", keys: "S", fn: () => aRef.current.newSource() },
      { label: "Add to Revisit", keys: "R", fn: () => aRef.current.newRevisit() },
      { label: "Capture a thought", keys: "N", fn: () => aRef.current.capture() },
    ];
    for (const x of acts) if (matches(x.label) || matches(`new ${x.label}`)) out.push({ id: `act-${x.label}`, group: "Create", label: x.label, hint: x.keys, run: run(x.fn) });
    return out.sort((x, y) => ORDER.indexOf(x.group) - ORDER.indexOf(y.group));
  }, [hits, debounced, q, onClose, navigate]);

  useEffect(() => setSel(0), [debounced, q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  if (!open) return null;

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, entries.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      entries[sel]?.run();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  let lastGroup = "";
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div className="anim-fade fixed inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <div role="dialog" aria-label="Search" className="anim-pop relative flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line-strong bg-bg shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className={clsx("shrink-0", isFetching ? "animate-pulse text-accent" : "text-fg-3")} aria-hidden />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            role="combobox"
            aria-label="Search"
            aria-expanded
            aria-controls="palette-list"
            aria-activedescendant={entries[sel] ? `palette-${entries[sel].id}` : undefined}
            placeholder="Search everything, or go somewhere…"
            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
            autoComplete="off"
            spellCheck={false}
          />
          <Kbd>Esc</Kbd>
        </div>
        <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
          {entries.length === 0 ? (
            <p className="px-4 py-8 text-center text-[14px] text-fg-2">{debounced ? `Nothing found for “${debounced}”.` : "Type to search."}</p>
          ) : (
            entries.map((e, i) => {
              const head = e.group !== lastGroup;
              lastGroup = e.group;
              return (
                <Fragment key={e.id}>
                  {head && (
                    <p className="px-2.5 pt-3 pb-1 text-[12px] font-medium text-fg-3 first:pt-1" role="presentation">
                      {e.group}
                    </p>
                  )}
                  <button
                    id={`palette-${e.id}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === sel}
                    onMouseMove={() => i !== sel && setSel(i)}
                    onClick={e.run}
                    className={clsx("flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left text-[14px]", i === sel && "bg-surface-2")}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">
                        {e.label}
                        {e.sub && <span className="ml-2 font-mono text-[12px] text-fg-3">{e.sub}</span>}
                      </span>
                      {e.snippet && <Snippet text={e.snippet} />}
                    </span>
                    {e.hint && <span className="shrink-0 font-mono text-[11px] text-fg-3">{e.hint}</span>}
                  </button>
                </Fragment>
              );
            })
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
