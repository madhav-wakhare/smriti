/**
 * Tasks: every task, as a board (default), a list or a timeline. Pick a project with the chips; search
 * narrows by title, key or tag. "Done" chooses how far back finished tasks show (7 days by default, as
 * in Arc), and Filters narrows by priority and tag. ?project=ID and ?view= keep the choice in the address;
 * the done range and filters are remembered in this browser.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
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
  const [showFilters, setShowFilters] = useState(false);
  const range = DONE_RANGES.find((r) => r.value === doneRange) ?? DONE_RANGES[1];
  const filterCount = filters.priority.length + filters.tags.length;

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
              <Button size="sm" variant={filterCount ? "default" : "ghost"} onClick={() => setShowFilters(!showFilters)} icon={<SlidersHorizontal size={13} />} aria-expanded={showFilters}>
                Filters{filterCount ? ` · ${filterCount}` : ""}
              </Button>
            </>
          )}
          <Input icon={<Search size={14} />} placeholder="Search tasks" aria-label="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />
        </div>

        {view !== "timeline" && (showFilters || filterCount > 0) && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border border-line bg-surface px-4 py-3">
            <FilterGroup label="Priority">
              {[4, 3, 2, 1, 0].map((p) => (
                <Chip key={p} small on={filters.priority.includes(p as Priority)} onClick={() => toggle("priority", p as Priority)}>
                  {PRIORITY[p].label}
                </Chip>
              ))}
            </FilterGroup>
            {allTags.length > 0 && (
              <FilterGroup label="Tags">
                {allTags.map((g) => (
                  <Chip key={g} small on={filters.tags.includes(g)} onClick={() => toggle("tags", g)}>
                    #{g}
                  </Chip>
                ))}
              </FilterGroup>
            )}
            {filterCount > 0 && (
              <button onClick={() => setFilters(NO_FILTERS)} className="ml-auto flex items-center gap-1 text-[13px] text-fg-2 hover:text-fg">
                <X size={13} /> Clear filters
              </button>
            )}
          </div>
        )}

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

function FilterGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="mr-1 text-[12px] font-medium text-fg-2">{label}</span>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children, small }: { on: boolean; onClick: () => void; children: ReactNode; small?: boolean }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={clsx(
        "flex items-center gap-1.5 rounded-full border transition-colors",
        small ? "h-7 px-2.5 text-[12px]" : "h-8 px-3 text-[13px]",
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
