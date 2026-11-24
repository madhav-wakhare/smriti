/**
 * Tasks: every task, as a board (default), a list or a timeline. Pick a project with the chips; search
 * narrows by title, key or tag. "Done" chooses how far back finished tasks show (7 days by default, as
 * in Arc), and the Priority and Tags menus narrow the tasks shown. ?project=ID and ?view= keep the choice in the address;
 * the done range and filters are remembered in this browser.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, ChevronDown, Plus, Search, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useSearchParams } from "react-router-dom";
import { useActions } from "../components/Layout";
import { Board } from "../components/work/Board";
import { Timeline } from "../components/work/Timeline";
import { Button, Empty, Input, Menu, PageHeader, Tabs } from "../components/ui";
import { api, qs, type Priority, type Task } from "../lib/api";
import { PRIORITY, PriorityMark, TASK_STATUS, fmtDate, fmtMin } from "../lib/format";
import { useLocalState, useProjects } from "../lib/hooks";

type View = "board" | "list" | "timeline";

/** How far back the Done column looks, like Arc's (and Jira's) "completed" window. Days of 0 means since midnight. */
type DoneRange = "today" | "7" | "30" | "all";
const DONE_RANGES: { value: DoneRange; label: string; days: number }[] = [
  { value: "today", label: "Today", days: 0 },
  { value: "7", label: "Last 7 days", days: 7 },
  { value: "30", label: "Last 30 days", days: 30 },
  { value: "all", label: "All time", days: 36500 },
];

type Filters = { priority: Priority[]; tags: string[] };
const NO_FILTERS: Filters = { priority: [], tags: [] };

export default function Tasks() {
  const [params, setParams] = useSearchParams();
  const { data: projects } = useProjects();
  const { newTask } = useActions();
  const projectId = Number(params.get("project")) || undefined;
  const v = params.get("view");
  const view: View = v === "list" || v === "timeline" ? v : "board";
  const [q, setQ] = useState("");
  const [doneRange, setDoneRange] = useLocalState<DoneRange>("smriti-done-range", "7");
  const [filters, setFilters] = useLocalState<Filters>("smriti-task-filters", NO_FILTERS);
  const range = DONE_RANGES.find((r) => r.value === doneRange) ?? DONE_RANGES[1];

  const set = (k: string, v: string | null) =>
    setParams((p) => {
      if (v) p.set(k, v);
      else p.delete(k);
      return p;
    });

  const query = { project_id: projectId, include_done_days: range.days };
  const { data: tasks, isLoading } = useQuery({ queryKey: ["tasks", query], queryFn: () => api.get<Task[]>(`/tasks${qs(query)}`) });
  const active = projects?.filter((p) => !p.archived) ?? [];

  const allTags = useMemo(() => Array.from(new Set((tasks ?? []).flatMap((t) => t.tags))).sort(), [tasks]);
  const shown = useMemo(() => {
    const n = q.trim().toLowerCase();
    return (tasks ?? []).filter(
      (t) =>
        (!n || `${t.key} ${t.title} ${t.tags.join(" ")}`.toLowerCase().includes(n)) &&
        (!filters.priority.length || filters.priority.includes(t.priority)) &&
        (!filters.tags.length || filters.tags.some((g) => t.tags.includes(g))),
    );
  }, [tasks, q, filters]);
  const toggle = <K extends keyof Filters>(key: K, value: Filters[K][number]) => {
    const cur = filters[key] as Filters[K][number][];
    setFilters({ ...filters, [key]: cur.includes(value) ? cur.filter((x) => x !== value) : [...cur, value] });
  };

  return (
    <>
      <PageHeader
        title="Tasks"
        lede="Every task, in every project. Drag a card to move it; click it to open it."
        actions={
          <>
            <Tabs<View>
              value={view}
              onChange={(v) => set("view", v === "board" ? null : v)}
              tabs={[
                { value: "board", label: "Board" },
                { value: "list", label: "List" },
                { value: "timeline", label: "Timeline" },
              ]}
            />
            <Button variant="primary" icon={<Plus size={14} />} onClick={() => newTask({ project_id: projectId })}>
              New task
            </Button>
          </>
        }
      />
      <div className="space-y-5 px-4 md:px-8">
        <div className="flex flex-wrap items-center gap-2">
          <Chip on={!projectId} onClick={() => set("project", null)}>
            All projects
          </Chip>
          {active.map((p) => (
            <Chip key={p.id} on={projectId === p.id} onClick={() => set("project", String(p.id))}>
              {p.name} <span className="font-mono text-[11px] opacity-70">{p.open_count}</span>
            </Chip>
          ))}
          <div className="flex-1" />
          {view !== "timeline" && (
            <>
              <Menu
                trigger={
                  <Button size="sm" variant="ghost" title="Show done tasks finished in…">
                    Done: {range.label} <ChevronDown size={13} />
                  </Button>
                }
                items={DONE_RANGES.map((r) => ({ label: r.label + (r.value === doneRange ? "  ✓" : ""), onClick: () => setDoneRange(r.value) }))}
              />
              <FilterMenu
                label="Priority"
                options={[4, 3, 2, 1, 0].map((p) => ({ value: p as Priority, label: PRIORITY[p].label, dot: PRIORITY_DOT[p] }))}
                selected={filters.priority}
                onToggle={(v) => toggle("priority", v)}
                onClear={() => setFilters({ ...filters, priority: [] })}
              />
              {allTags.length > 0 && (
                <FilterMenu
                  label="Tags"
                  options={allTags.map((g) => ({ value: g, label: g }))}
                  selected={filters.tags}
                  onToggle={(v) => toggle("tags", v)}
                  onClear={() => setFilters({ ...filters, tags: [] })}
                  searchable={allTags.length > 8}
                />
              )}
              {filters.priority.length > 0 && filters.tags.length > 0 && (
                <button onClick={() => setFilters(NO_FILTERS)} className="px-1 text-[13px] text-fg-3 hover:text-fg">
                  Clear all
                </button>
              )}
            </>
          )}
          <Input icon={<Search size={14} />} placeholder="Search tasks" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />
        </div>

        {isLoading ? (
          <p className="py-10 text-[13px] text-fg-3">Loading…</p>
        ) : view === "timeline" ? (
          <Timeline tasks={tasks ?? []} projectId={projectId} />
        ) : view === "board" ? (
          <Board tasks={shown} projectId={projectId} showProject={!projectId} doneLabel={`Done · ${range.label.toLowerCase()}`} />
        ) : (
          <TaskList tasks={shown} />
        )}
      </div>
    </>
  );
}

/** Dot colour per priority, None to Urgent, matching the priority marks on cards. */
const PRIORITY_DOT = ["bg-line-strong", "bg-fg-3", "bg-warning", "bg-serious", "bg-critical"];

/**
 * A filter as a quiet button that opens a checklist. It stays open while you tick, shows what is
 * picked ("Priority: High, Urgent" or "Tags: 3"), and its × clears just that filter.
 */
function FilterMenu<T extends string | number>({
  label,
  options,
  selected,
  onToggle,
  onClear,
  searchable,
}: {
  label: string;
  options: { value: T; label: string; dot?: string }[];
  selected: T[];
  onToggle: (v: T) => void;
  onClear: () => void;
  searchable?: boolean;
}) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const [q, setQ] = useState("");
  const btn = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const WIDTH = 220;

  useEffect(() => {
    if (!pos) return;
    const close = (e: Event) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !btn.current?.contains(t)) setPos(null);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setPos(null);
    const dismiss = () => setPos(null);
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    window.addEventListener("resize", dismiss);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", esc);
      window.removeEventListener("resize", dismiss);
    };
  }, [pos]);

  const open = () => {
    const r = btn.current!.getBoundingClientRect();
    setQ("");
    setPos({ top: r.bottom + 6, left: Math.max(8, Math.min(r.left, window.innerWidth - WIDTH - 8)) });
  };
  const picked = options.filter((o) => selected.includes(o.value));
  const summary = picked.length === 0 ? null : picked.length <= 2 ? picked.map((o) => o.label).join(", ") : `${picked.length}`;
  const n = q.trim().toLowerCase();
  const shown = n ? options.filter((o) => o.label.toLowerCase().includes(n)) : options;

  return (
    <div
      ref={btn}
      className={clsx(
        "flex h-8 items-center rounded-lg border text-[13px] transition-colors",
        summary ? "border-accent/50 bg-accent-soft text-fg" : "border-transparent text-fg-2 hover:bg-surface-2 hover:text-fg",
      )}
    >
      <button onClick={() => (pos ? setPos(null) : open())} aria-expanded={!!pos} aria-haspopup="listbox" className="flex h-full items-center gap-1.5 pr-1.5 pl-2.5">
        <span>
          {label}
          {summary && <span className="text-fg-3">:</span>}
        </span>
        {summary && <span className="max-w-[160px] truncate font-medium">{summary}</span>}
        {!summary && <ChevronDown size={13} className="text-fg-3" />}
      </button>
      {summary && (
        <button onClick={onClear} aria-label={`Clear ${label.toLowerCase()} filter`} title="Clear" className="mr-1 rounded p-0.5 text-fg-3 hover:bg-surface-3 hover:text-fg">
          <X size={13} />
        </button>
      )}
      {pos &&
        createPortal(
          <div
            ref={panel}
            role="listbox"
            aria-multiselectable
            aria-label={label}
            style={{ top: pos.top, left: pos.left, width: WIDTH }}
            className="anim-drop fixed z-[70] rounded-lg border border-line-strong bg-bg p-1 shadow-lg"
          >
            {searchable && (
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`Find a ${label.toLowerCase().replace(/s$/, "")}`}
                aria-label={`Find ${label.toLowerCase()}`}
                className="mb-1 h-8 w-full rounded-md border border-line bg-surface px-2.5 text-[13px] outline-none placeholder:text-fg-3 focus:border-accent"
              />
            )}
            <div className="max-h-72 overflow-y-auto">
              {shown.map((o) => {
                const on = selected.includes(o.value);
                return (
                  <button
                    key={String(o.value)}
                    role="option"
                    aria-selected={on}
                    onClick={() => onToggle(o.value)}
                    className="flex h-8 w-full items-center gap-2.5 rounded-md px-2 text-left text-[13px] hover:bg-surface-2"
                  >
                    <span className={clsx("grid size-4 shrink-0 place-items-center rounded border", on ? "border-accent bg-accent text-accent-fg" : "border-line-strong")}>
                      {on && <Check size={11} strokeWidth={3} />}
                    </span>
                    {o.dot && <span className={clsx("size-2 shrink-0 rounded-full", o.dot)} aria-hidden />}
                    <span className={clsx("min-w-0 flex-1 truncate", on ? "text-fg" : "text-fg-2")}>{o.label}</span>
                  </button>
                );
              })}
              {!shown.length && <p className="px-2 py-3 text-center text-[12px] text-fg-3">Nothing matches.</p>}
            </div>
            {selected.length > 0 && (
              <button onClick={onClear} className="mt-1 h-8 w-full rounded-md border-t border-line px-2 text-left text-[12px] text-fg-2 hover:bg-surface-2 hover:text-fg">
                Clear {label.toLowerCase()}
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
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

type Sort = "title" | "status" | "priority" | "due_on" | "logged_min";

function TaskList({ tasks }: { tasks: Task[] }) {
  const { openTask } = useActions();
  const [sort, setSort] = useState<{ by: Sort; desc: boolean }>({ by: "priority", desc: true });
  const order = { todo: 0, doing: 1, done: 2 };
  const rows = [...tasks].sort((a, b) => {
    const k = sort.by;
    const va = k === "status" ? order[a.status] : k === "due_on" ? a.due_on ?? "9999" : a[k];
    const vb = k === "status" ? order[b.status] : k === "due_on" ? b.due_on ?? "9999" : b[k];
    const c = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb));
    return sort.desc ? -c : c;
  });
  if (!rows.length) return <Empty title="No tasks here." hint="Add one with New task." />;
  const head = (by: Sort, label: string, cls = "") => (
    <th className={clsx("px-3 py-2 text-left font-medium", cls)}>
      <button onClick={() => setSort({ by, desc: sort.by === by ? !sort.desc : by !== "title" })} className="hover:text-fg">
        {label}
        {sort.by === by ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  return (
    <div className="overflow-x-auto rounded-xl border border-line">
      <table className="w-full text-[14px]">
        <thead className="border-b border-line bg-surface-2/50 text-[12px] text-fg-2">
          <tr>
            {head("title", "Task")}
            {head("status", "Status")}
            {head("priority", "Priority")}
            {head("due_on", "Due")}
            {head("logged_min", "Time", "text-right")}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((t) => (
            <tr key={t.id} onClick={() => openTask(t.id)} className="cursor-pointer hover:bg-surface-2">
              <td className="px-3 py-2.5">
                <span className={clsx(t.status === "done" && "text-fg-2 line-through")}>{t.title}</span>
                <span className="ml-2 font-mono text-[12px] text-fg-3">{t.key}</span>
                {t.parent_key && <span className="ml-2 font-mono text-[12px] text-fg-3">↳ {t.parent_key}</span>}
                {t.children > 0 && (
                  <span className="ml-2 text-[12px] text-fg-3 tabular-nums" title="Child tasks done">
                    {t.children_done}/{t.children} children
                  </span>
                )}
              </td>
              <td className="px-3 whitespace-nowrap text-fg-2">{TASK_STATUS.find((s) => s.value === t.status)?.label}</td>
              <td className="px-3 whitespace-nowrap" title={PRIORITY[t.priority].label}>
                <PriorityMark value={t.priority} />
              </td>
              <td className="px-3 whitespace-nowrap text-fg-2">{t.due_on ? fmtDate(t.due_on) : ""}</td>
              <td className="px-3 text-right font-mono whitespace-nowrap text-fg-2 tabular-nums">{t.logged_min ? fmtMin(t.logged_min) : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
