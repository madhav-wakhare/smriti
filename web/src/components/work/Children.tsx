/**
 * Child tasks, the way Jira does them: a parent shows its children with a progress bar and can add a
 * new child or link an existing task; a child shows the whole chain above it as a breadcrumb and a
 * Parent field you can change or clear. Chains can go several levels deep.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronRight, Link2, Plus, X } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { api, qs, type Task, type TaskFull } from "../../lib/api";
import { PriorityMark, TASK_STATUS } from "../../lib/format";
import { useWrite } from "../common";
import { useActions } from "../Layout";
import { Button, Checkbox, Input, Modal } from "../ui";

/** "WORK-1 › WORK-5 › WORK-9": every task above this one, then this one. Each step opens its task. */
export function Breadcrumb({ task }: { task: TaskFull }) {
  const { openTask } = useActions();
  return (
    <nav aria-label="Parent tasks" className="flex min-w-0 items-center gap-1 overflow-x-auto font-mono text-[13px] whitespace-nowrap">
      {task.ancestors.map((a) => (
        <Fragment key={a.id}>
          <button onClick={() => openTask(a.id)} title={a.title} className={clsx("hover:text-fg hover:underline", a.status === "done" && "line-through")}>
            {a.key}
          </button>
          <ChevronRight size={13} className="shrink-0 text-fg-3" aria-hidden />
        </Fragment>
      ))}
      <span className="text-fg">{task.key}</span>
    </nav>
  );
}

/** The parent's list of children: progress, tick off, open, unlink, add a new one, link an existing one. */
export function ChildTasks({ task }: { task: TaskFull }) {
  const write = useWrite();
  const { openTask } = useActions();
  const [title, setTitle] = useState("");
  const [linking, setLinking] = useState(false);
  const kids = task.subtasks;
  const done = kids.filter((k) => k.status === "done").length;

  const add = () => {
    const t = title.trim();
    if (t) write(() => api.post("/tasks", { project_id: task.project_id, parent_id: task.id, title: t })).then((r) => r && setTitle(""));
  };

  return (
    <div className="space-y-3">
      {kids.length > 0 && (
        <div className="flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3" aria-hidden>
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(done / kids.length) * 100}%` }} />
          </div>
          <span className="text-[12px] text-fg-2 tabular-nums">
            {done} of {kids.length} done
          </span>
        </div>
      )}
      {kids.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {kids.map((k) => (
            <li key={k.id} className="group flex items-center gap-3 px-3 py-2">
              <Checkbox checked={k.status === "done"} onChange={(v) => write(() => api.patch(`/tasks/${k.id}`, { status: v ? "done" : "todo" }))} />
              <button onClick={() => openTask(k.id)} className="min-w-0 flex-1 text-left">
                <span className={clsx("text-[14px]", k.status === "done" && "text-fg-3 line-through")}>{k.title}</span>
                <span className="ml-2 font-mono text-[12px] text-fg-3">{k.key}</span>
              </button>
              {k.children > 0 && (
                <span className="text-[12px] whitespace-nowrap text-fg-3 tabular-nums" title="Its own child tasks">
                  {k.children_done}/{k.children} children
                </span>
              )}
              {k.status !== "done" && <PriorityMark value={k.priority} />}
              <span className="w-14 text-right text-[12px] text-fg-2">{TASK_STATUS.find((s) => s.value === k.status)?.label}</span>
              <button
                aria-label={`Remove ${k.key} from this task`}
                title="Remove from this task (keeps the task)"
                onClick={() => write(() => api.patch(`/tasks/${k.id}`, { parent_id: null }), `${k.key} is no longer a child`)}
                className="rounded p-1 text-fg-3 opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-fg focus:opacity-100"
              >
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <form
          className="min-w-[220px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add a child task, then Enter" aria-label="New child task" icon={<Plus size={14} />} className="!h-8" />
        </form>
        <Button size="sm" variant="ghost" icon={<Link2 size={13} />} onClick={() => setLinking(true)}>
          Link existing task
        </Button>
      </div>
      <TaskPicker
        open={linking}
        onClose={() => setLinking(false)}
        title={`Add a child to ${task.key}`}
        exclude={new Set([task.id, ...task.ancestors.map((a) => a.id), ...kids.map((k) => k.id)])}
        onPick={(picked) => write(() => api.patch(`/tasks/${picked.id}`, { parent_id: task.id }), `${picked.key} is now a child of ${task.key}`)}
      />
    </div>
  );
}

/** The Parent field: which task this one sits under, with Change and Remove. */
export function ParentField({ task }: { task: TaskFull }) {
  const write = useWrite();
  const { openTask } = useActions();
  const [picking, setPicking] = useState(false);
  const parent = task.ancestors.at(-1);
  return (
    <>
      {parent ? (
        <div className="space-y-1.5">
          <button onClick={() => openTask(parent.id)} className="block w-full truncate text-left text-[13px] hover:underline" title={parent.title}>
            <span className="font-mono text-fg-3">{parent.key}</span> {parent.title}
          </button>
          <div className="flex gap-3 text-[12px]">
            <button onClick={() => setPicking(true)} className="text-fg-2 hover:text-fg hover:underline">
              Change
            </button>
            <button onClick={() => write(() => api.patch(`/tasks/${task.id}`, { parent_id: null }))} className="text-fg-2 hover:text-fg hover:underline">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="w-full justify-start" icon={<Link2 size={13} />} onClick={() => setPicking(true)}>
          Set a parent
        </Button>
      )}
      <TaskPicker
        open={picking}
        onClose={() => setPicking(false)}
        title={`Choose a parent for ${task.key}`}
        exclude={new Set([task.id, task.parent_id ?? -1])}
        excludeUnder={task.id}
        onPick={(picked) => write(() => api.patch(`/tasks/${task.id}`, { parent_id: picked.id }), `${task.key} is now under ${picked.key}`)}
      />
    </>
  );
}

/** Search your open tasks and pick one. The API refuses a pick that would make a loop. */
function TaskPicker({
  open,
  onClose,
  title,
  exclude,
  excludeUnder,
  onPick,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  exclude: Set<number>;
  /** Also hide this task's children, grandchildren and so on (they can't become its parent). */
  excludeUnder?: number;
  onPick: (t: Task) => void;
}) {
  const [q, setQ] = useState("");
  const query = { include_done_days: 0 };
  const { data: tasks } = useQuery({ queryKey: ["tasks", query], queryFn: () => api.get<Task[]>(`/tasks${qs(query)}`), enabled: open });
  const under = useMemo(() => {
    const out = new Set<number>();
    if (!excludeUnder || !tasks) return out;
    let frontier = [excludeUnder];
    while (frontier.length) {
      const next = tasks.filter((t) => t.parent_id !== null && frontier.includes(t.parent_id)).map((t) => t.id);
      next.forEach((id) => out.add(id));
      frontier = next.filter((id) => !frontier.includes(id));
    }
    return out;
  }, [tasks, excludeUnder]);
  const n = q.trim().toLowerCase();
  const hits = (tasks ?? []).filter((t) => !exclude.has(t.id) && !under.has(t.id) && (!n || `${t.key} ${t.title}`.toLowerCase().includes(n))).slice(0, 12);
  return (
    <Modal open={open} onClose={onClose} title={title}>
      <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by title or key" aria-label="Search tasks" />
      <ul className="mt-3 max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
        {hits.map((t) => (
          <li key={t.id}>
            <button
              onClick={() => {
                onPick(t);
                onClose();
                setQ("");
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-[14px] hover:bg-surface-2"
            >
              <span className="w-20 shrink-0 font-mono text-[12px] text-fg-3">{t.key}</span>
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              {t.parent_key && <span className="text-[12px] text-fg-3">in {t.parent_key}</span>}
            </button>
          </li>
        ))}
        {!hits.length && <li className="px-3 py-6 text-center text-[13px] text-fg-3">No open tasks match.</li>}
      </ul>
    </Modal>
  );
}

/** Closing a parent that still has open children: close them too, or only the parent (Jira asks the same). */
export function useCloseParent(task: TaskFull | undefined) {
  const write = useWrite();
  const [asking, setAsking] = useState(false);
  const setStatus = (status: string) => {
    if (!task) return;
    if (status === "done" && task.open_descendants > 0) return setAsking(true);
    write(() => api.patch(`/tasks/${task.id}`, { status }));
  };
  const dialog = task ? (
    <Modal
      open={asking}
      onClose={() => setAsking(false)}
      title={`Close ${task.key}?`}
      footer={
        <>
          <Button variant="ghost" onClick={() => setAsking(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setAsking(false);
              write(() => api.patch(`/tasks/${task.id}`, { status: "done" }));
            }}
          >
            Only {task.key}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              setAsking(false);
              write(() => api.patch(`/tasks/${task.id}`, { status: "done", close_children: true }), `Closed ${task.key} and its child tasks`);
            }}
          >
            Close all
          </Button>
        </>
      }
    >
      <p className="text-[14px] text-fg-2">
        {task.key} still has {task.open_descendants} open {task.open_descendants === 1 ? "task" : "tasks"} under it (its child tasks and theirs). Close{" "}
        {task.open_descendants === 1 ? "it" : "them"} too?
      </p>
    </Modal>
  ) : null;
  return { setStatus, dialog };
}
