/**
 * The board: Todo, Doing, Done. A card shows the title first, then only what needs attention
 * (priority when set, a due date, "Today"). Drag a card to move it; click it to open it.
 * Todo ends with a one-line "Add a task" field.
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import clsx from "clsx";
import { Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api, type Task, type TaskStatus } from "../../lib/api";
import { PriorityMark, fmtDate } from "../../lib/format";
import { useLocalState, useProjects } from "../../lib/hooks";
import { useTodayDate, useWrite } from "../common";
import { useActions } from "../Layout";

const COLUMNS: { status: TaskStatus; label: string; hint: string }[] = [
  { status: "todo", label: "To do", hint: "Nothing waiting." },
  { status: "doing", label: "Doing", hint: "Drag a task here when you start it." },
  { status: "done", label: "Done", hint: "Nothing finished in this period." },
];
const DONE_SHOWN = 6;

const byPosition = (a: Task, b: Task) => a.position - b.position || a.id - b.id;

// Prefer the card under the pointer; else the column; else whatever overlaps most.
const collide: CollisionDetection = (args) => {
  const hits = pointerWithin(args);
  if (hits.length) return [hits.find((h) => String(h.id).startsWith("task-")) ?? hits[0]];
  return rectIntersection(args);
};

export function Board({ tasks, projectId, showProject, doneLabel }: { tasks: Task[]; projectId?: number; showProject?: boolean; doneLabel?: string }) {
  const write = useWrite();
  const { openTask } = useActions();
  const [local, setLocal] = useState<Task[] | null>(null);
  useEffect(() => setLocal(null), [tasks]);
  const shown = local ?? tasks;

  const columns = useMemo(() => {
    const m: Record<TaskStatus, Task[]> = { todo: [], doing: [], done: [] };
    for (const t of shown) m[t.status].push(t);
    m.todo.sort(byPosition);
    m.doing.sort(byPosition);
    m.done.sort((a, b) => (b.done_at ?? "").localeCompare(a.done_at ?? ""));
    return m;
  }, [shown]);

  const [dragId, setDragId] = useState<number | null>(null);
  const [over, setOver] = useState<{ id: string; below: boolean } | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const dragged = dragId ? shown.find((t) => t.id === dragId) : undefined;

  const isBelow = (e: DragOverEvent | DragEndEvent) => {
    const r = e.active.rect.current.translated;
    return !!r && !!e.over && r.top + r.height / 2 > e.over.rect.top + e.over.rect.height / 2;
  };

  const onEnd = (e: DragEndEvent) => {
    setDragId(null);
    setOver(null);
    if (!e.over) return;
    const id = Number(String(e.active.id).slice(5));
    const task = shown.find((t) => t.id === id);
    const overId = String(e.over.id);
    if (!task) return;
    let status: TaskStatus;
    let beforeId: number | undefined;
    let afterId: number | undefined;
    if (overId.startsWith("col-")) {
      status = overId.slice(4) as TaskStatus;
      afterId = columns[status].filter((t) => t.id !== id).at(-1)?.id;
    } else {
      const target = shown.find((t) => `task-${t.id}` === overId);
      if (!target || target.id === id) return;
      status = target.status;
      if (isBelow(e)) afterId = target.id;
      else beforeId = target.id;
    }
    // Show the move at once; undo it if the server says no.
    const col = columns[status].filter((t) => t.id !== id);
    const at = beforeId ? col.findIndex((t) => t.id === beforeId) : afterId ? col.findIndex((t) => t.id === afterId) + 1 : col.length;
    const prev = col[at - 1]?.position;
    const next = col[at]?.position;
    const position = prev === undefined ? (next ?? 0) - 1 : next === undefined ? prev + 1 : (prev + next) / 2;
    setLocal(shown.map((t) => (t.id === id ? { ...t, status, position } : t)));
    write(() => api.post<Task>(`/tasks/${id}/move`, { status, ...(beforeId ? { before_id: beforeId } : afterId ? { after_id: afterId } : {}) })).then(
      (r) => r === undefined && setLocal(null),
    );
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collide}
      onDragStart={(e) => setDragId(Number(String(e.active.id).slice(5)))}
      onDragOver={(e) => setOver(e.over ? { id: String(e.over.id), below: isBelow(e) } : null)}
      onDragCancel={() => {
        setDragId(null);
        setOver(null);
      }}
      onDragEnd={onEnd}
    >
      <div className="grid items-start gap-4 md:grid-cols-3">
        {COLUMNS.map((c) => (
          <Column
            key={c.status}
            {...c}
            label={c.status === "done" && doneLabel ? doneLabel : c.label}
            tasks={columns[c.status]}
            over={over}
            dragId={dragId}
            onOpen={openTask}
            projectId={projectId}
            showProject={showProject}
          />
        ))}
      </div>
      <DragOverlay dropAnimation={null}>{dragged ? <Card task={dragged} showProject={showProject} lifted /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  label,
  hint,
  tasks,
  over,
  dragId,
  onOpen,
  projectId,
  showProject,
}: {
  status: TaskStatus;
  label: string;
  hint: string;
  tasks: Task[];
  over: { id: string; below: boolean } | null;
  dragId: number | null;
  onOpen: (id: number) => void;
  projectId?: number;
  showProject?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `col-${status}` });
  const [more, setMore] = useState(false);
  const target = !!dragId && (isOver || tasks.some((t) => `task-${t.id}` === over?.id));
  const list = status === "done" && !more ? tasks.slice(0, DONE_SHOWN) : tasks;
  return (
    <section
      ref={setNodeRef}
      aria-label={label}
      className={clsx("flex min-h-[200px] flex-col rounded-xl border bg-surface-2/40 p-2 transition-colors", target ? "border-accent" : "border-line")}
    >
      <h3 className="flex items-center gap-2 px-2 pt-1 pb-2.5 text-[14px] font-semibold">
        {label}
        <span className="rounded-full bg-surface-3 px-2 font-mono text-[11px] leading-5 font-normal text-fg-2">{tasks.length}</span>
      </h3>
      <ul className="flex flex-col gap-2">
        {list.map((t) => (
          <Draggable key={t.id} task={t} onOpen={onOpen} showProject={showProject} line={over?.id === `task-${t.id}` && dragId !== t.id ? (over.below ? "below" : "above") : null} />
        ))}
      </ul>
      {!tasks.length && <p className="px-2 py-6 text-center text-[13px] text-fg-3">{hint}</p>}
      {status === "done" && tasks.length > DONE_SHOWN && (
        <button onClick={() => setMore(!more)} className="mt-2 rounded-md px-2 py-1.5 text-left text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
          {more ? "Show fewer" : `Show ${tasks.length - DONE_SHOWN} more`}
        </button>
      )}
      {status === "todo" && <QuickAdd projectId={projectId} />}
    </section>
  );
}

function Draggable({ task, onOpen, line, showProject }: { task: Task; onOpen: (id: number) => void; line: "above" | "below" | null; showProject?: boolean }) {
  const id = `task-${task.id}`;
  const drag = useDraggable({ id });
  const drop = useDroppable({ id });
  return (
    <li
      ref={(el) => {
        drag.setNodeRef(el);
        drop.setNodeRef(el);
      }}
      className={clsx("relative", drag.isDragging && "opacity-30")}
    >
      {line && <span className={clsx("absolute inset-x-1 z-10 h-0.5 rounded bg-accent", line === "above" ? "-top-[5px]" : "-bottom-[5px]")} />}
      <div
        {...drag.listeners}
        {...drag.attributes}
        role="button"
        aria-label={`Open ${task.title}`}
        onClick={() => onOpen(task.id)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpen(task.id);
          }
        }}
        className="cursor-pointer rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Card task={task} showProject={showProject} />
      </div>
    </li>
  );
}

function Card({ task, lifted, showProject }: { task: Task; lifted?: boolean; showProject?: boolean }) {
  const today = useTodayDate();
  const done = task.status === "done";
  const late = !done && !!task.due_on && task.due_on < today;
  const planned = !done && !!task.planned_on && task.planned_on <= today;
  return (
    <div
      className={clsx(
        "rounded-lg border bg-bg px-3 py-2.5 transition-colors",
        lifted ? "w-[300px] cursor-grabbing border-accent shadow-xl" : "border-line hover:border-line-strong",
      )}
    >
      <p className={clsx("text-[14px] leading-snug", done && "text-fg-2 line-through decoration-fg-3")}>{task.title}</p>
      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-fg-3">
        <span className="font-mono">{task.key}</span>
        {showProject && <span>· {task.project_key}</span>}
        <span className="flex-1" />
        {planned && <span className="rounded bg-accent-soft px-1.5 leading-5 font-medium text-fg">Today</span>}
        {task.due_on && !done && (
          <span className={clsx("leading-5", late ? "font-medium text-critical" : "text-fg-2")}>Due {fmtDate(task.due_on)}</span>
        )}
        {!done && <PriorityMark value={task.priority} />}
      </div>
    </div>
  );
}

/** Type a title, press Enter: a new task in the chosen (or last used) project. */
function QuickAdd({ projectId }: { projectId?: number }) {
  const write = useWrite();
  const { data: projects } = useProjects();
  const [last] = useLocalState<number | null>("smriti-last-project", null);
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);
  const active = projects?.filter((p) => !p.archived) ?? [];
  const pid = projectId ?? (active.some((p) => p.id === last) ? last : active[0]?.id);
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="mt-2 flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
        <Plus size={14} /> Add a task
      </button>
    );
  return (
    <form
      className="mt-2"
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (!t || !pid) return;
        write(() => api.post("/tasks", { project_id: pid, title: t })).then(() => setTitle(""));
      }}
    >
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => !title.trim() && setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            setOpen(false);
          }
        }}
        placeholder={pid ? `Task title, then Enter${projectId ? "" : ` (in ${active.find((p) => p.id === pid)?.name})`}` : "Create a project in Settings first"}
        aria-label="New task title"
        className="h-9 w-full rounded-lg border border-accent bg-bg px-3 text-[14px] outline-none placeholder:text-fg-3"
      />
    </form>
  );
}
