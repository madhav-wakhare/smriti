/**
 * A task, opened. One window, read top to bottom: the title and description, the checklist, time
 * spent, and notes. On the right, the few settings that matter: status, priority, today, due date and
 * project. Everything else sits under "More". Every field saves when you leave it.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronDown, Trash2, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, type Priority, type Repeat, type TaskFull, type TaskStatus } from "../lib/api";
import { PRIORITY, TASK_STATUS, fmtDate, fmtMin, fmtTime, parseDuration } from "../lib/format";
import { useProjects } from "../lib/hooks";
import { BlurInput, BlurTextarea, parseTags, useTodayDate, useWrite } from "./common";
import { useActions } from "./Layout";
import { TimeBox } from "./time";
import { Breadcrumb, ChildTasks, ParentField, useCloseParent } from "./work/Children";
import { Button, Checkbox, DateInput, IconButton, Input, Modal, Select, Tabs, Textarea, useToast } from "./ui";

const REPEAT: { value: Repeat; label: string }[] = [
  { value: "none", label: "Does not repeat" },
  { value: "daily", label: "Every day" },
  { value: "weekdays", label: "Every weekday" },
  { value: "weekly", label: "Every week" },
  { value: "monthly", label: "Every month" },
];

export function TaskDrawer({ taskId, onClose }: { taskId: number | null; onClose: () => void }) {
  useEffect(() => {
    if (!taskId) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest("input,textarea,select") && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [taskId, onClose]);
  if (!taskId) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-3 sm:p-6 sm:pt-[5vh]">
      <div className="anim-fade fixed inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Task" className="anim-pop relative w-full max-w-[920px] rounded-xl border border-line-strong bg-bg shadow-2xl">
        <TaskBody id={taskId} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

function TaskBody({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: t, isLoading, error } = useQuery({ queryKey: ["tasks", id], queryFn: () => api.get<TaskFull>(`/tasks/${id}`) });
  const write = useWrite();
  const toast = useToast();
  const { openTask } = useActions();
  const today = useTodayDate();
  const { data: projects } = useProjects();
  const [more, setMore] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const close = useCloseParent(t);

  if (isLoading) return <p className="p-8 text-[14px] text-fg-3">Loading…</p>;
  if (error || !t)
    return (
      <div className="flex items-center justify-between p-6 text-[14px] text-fg-2">
        This task could not be loaded. It may have been deleted.
        <Button onClick={onClose}>Close</Button>
      </div>
    );

  const patch = (body: Record<string, unknown>) => write(() => api.patch(`/tasks/${id}`, body));
  const planned = !!t.planned_on && t.planned_on <= today;

  const remove = async () => {
    setConfirmDelete(false);
    const ok = await write(() => api.del(`/tasks/${id}`));
    if (ok === undefined) return;
    onClose();
    toast(t.children ? `Deleted ${t.key} and its child tasks` : `Deleted ${t.key}`, "default", {
      label: "Undo",
      onClick: () => write(() => api.post(`/trash/task/${id}/restore`)).then(() => openTask(id)),
    });
  };

  return (
    <>
      {/* top line: where this task lives, and close */}
      <div className="flex h-12 items-center gap-3 border-b border-line pl-5 pr-2 text-[13px] text-fg-2">
        <Breadcrumb task={t} />
        <span className="flex-1" />
        <IconButton aria-label="Delete task" title="Delete task" onClick={() => (t.children ? setConfirmDelete(true) : remove())}>
          <Trash2 size={15} />
        </IconButton>
        <IconButton aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>

      <div className="grid md:grid-cols-[1fr_260px]">
        {/* main column */}
        <div className="min-w-0 space-y-7 p-5 md:p-6">
          <BlurInput
            value={t.title}
            onSave={(v) => v.trim() && patch({ title: v.trim() })}
            aria-label="Title"
            className="!h-auto !border-transparent !bg-transparent !px-0 text-[22px] font-semibold hover:!border-transparent focus:!border-transparent"
          />
          <BlurTextarea
            value={t.body}
            onSave={(v) => patch({ body: v })}
            aria-label="Description"
            placeholder="Add a description…"
            className="min-h-24"
          />

          <Section title="Checklist" hint={t.checks.length ? `${t.checks.filter((c) => c.done).length} of ${t.checks.length}` : undefined}>
            <Checklist task={t} />
          </Section>

          <Section title="Child tasks">
            <ChildTasks task={t} />
          </Section>

          <Section title="Time">
            <TimeBox subject={{ task_id: t.id }} sessions={t.sessions} loggedMin={t.logged_min} estimateMin={t.estimate_min} />
          </Section>

          <Section title="Notes">
            <Notes task={t} />
          </Section>
        </div>

        {/* settings column */}
        <aside className="space-y-5 border-t border-line p-5 md:border-t-0 md:border-l md:p-6">
          <Setting label="Status">
            <Tabs<TaskStatus> value={t.status} onChange={(v) => close.setStatus(v)} tabs={TASK_STATUS.map((s) => ({ value: s.value, label: s.value === "todo" ? "To do" : s.label }))} />
          </Setting>

          <Setting label="Priority">
            <Select value={t.priority} onChange={(e) => patch({ priority: Number(e.target.value) as Priority })} aria-label="Priority">
              {PRIORITY.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Setting>

          <Setting label="Today">
            {t.status === "done" ? (
              <p className="text-[13px] text-fg-2">Done{t.done_at ? ` on ${fmtDate(t.done_at)}` : ""}.</p>
            ) : planned ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-accent/50 bg-accent-soft px-3 py-1.5 text-[13px]">
                On today's plan
                <button onClick={() => patch({ planned_on: null })} className="text-fg-2 underline hover:text-fg">
                  Remove
                </button>
              </div>
            ) : (
              <Button className="w-full" onClick={() => patch({ planned_on: today })}>
                Add to today
              </Button>
            )}
          </Setting>

          <Setting label="Due date">
            <DateInput value={t.due_on ?? ""} onChange={(v) => patch({ due_on: v || null })} placeholder="No due date" />
          </Setting>

          <Setting label="Project">
            <Select value={t.project_id} onChange={(e) => patch({ project_id: Number(e.target.value) })} aria-label="Project">
              {projects?.filter((p) => !p.archived || p.id === t.project_id).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </Setting>

          <Setting label="Parent">
            <ParentField task={t} />
          </Setting>

          <button onClick={() => setMore(!more)} className="flex w-full items-center gap-1.5 text-[13px] text-fg-2 hover:text-fg" aria-expanded={more}>
            <ChevronDown size={14} className={clsx("transition-transform", !more && "-rotate-90")} />
            More
          </button>
          {more && (
            <div className="space-y-5">
              <Setting label="Estimate">
                <BlurInput
                  value={t.estimate_min ? fmtMin(t.estimate_min) : ""}
                  onSave={(v) => {
                    const m = parseDuration(v);
                    if (m === null) patch({ estimate_min: null });
                    else if (Number.isNaN(m)) toast("Write the estimate like 2h 30m, 45m or 1d", "error");
                    else patch({ estimate_min: m });
                  }}
                  placeholder="Like 2h 30m"
                  aria-label="Estimate, like 2h 30m"
                />
              </Setting>
              <Setting label="Repeat">
                <Select value={t.repeat} onChange={(e) => patch({ repeat: e.target.value })} aria-label="Repeat">
                  {REPEAT.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </Select>
              </Setting>
              <Setting label="Tags">
                <BlurInput value={t.tags.join(", ")} onSave={(v) => patch({ tags: parseTags(v) })} placeholder="e.g. infra, review" aria-label="Tags" />
              </Setting>
              <Setting label="Link">
                <BlurInput value={t.url ?? ""} onSave={(v) => patch({ url: v.trim() || null })} placeholder="https://…" aria-label="Link" />
                {t.url && (
                  <a href={t.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[12px] text-accent hover:underline">
                    Open link
                  </a>
                )}
              </Setting>
              <History task={t} />
              <p className="text-[12px] text-fg-3">
                Created {fmtDate(t.created_at)} · updated {fmtDate(t.updated_at)}
              </p>
            </div>
          )}
        </aside>
      </div>
      {close.dialog}
      <Modal
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Delete ${t.key}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove}>
              Delete all
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-fg-2">
          Its {t.children} child {t.children === 1 ? "task goes" : "tasks go"} to Trash with it, along with their own children. Restoring {t.key} brings them all back.
        </p>
      </Modal>
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

function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-1.5 text-[12px] font-medium text-fg-2">{label}</p>
      {children}
    </div>
  );
}

function Checklist({ task }: { task: TaskFull }) {
  const write = useWrite();
  const [title, setTitle] = useState("");
  return (
    <div className="space-y-1">
      {task.checks.map((c) => (
        <div key={c.id} className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-surface-2">
          <Checkbox checked={c.done} onChange={(v) => write(() => api.patch(`/checks/${c.id}`, { done: v }))} />
          <BlurInput
            value={c.title}
            onSave={(v) => v.trim() && write(() => api.patch(`/checks/${c.id}`, { title: v.trim() }))}
            aria-label="Checklist item"
            className={clsx("!h-7 !border-transparent !bg-transparent !px-1", c.done && "text-fg-3 line-through")}
          />
          <button aria-label="Remove item" onClick={() => write(() => api.del(`/checks/${c.id}`))} className="rounded p-1 text-fg-3 opacity-0 group-hover:opacity-100 hover:text-critical focus:opacity-100">
            <X size={13} />
          </button>
        </div>
      ))}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const v = title.trim();
          if (v) write(() => api.post(`/tasks/${task.id}/checks`, { title: v })).then(() => setTitle(""));
        }}
      >
        <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Add an item, then Enter" aria-label="New checklist item" className="!h-8" />
      </form>
    </div>
  );
}

function Notes({ task }: { task: TaskFull }) {
  const write = useWrite();
  const [body, setBody] = useState("");
  const add = () => {
    const v = body.trim();
    if (v) write(() => api.post("/notes", { task_id: task.id, body: v })).then(() => setBody(""));
  };
  return (
    <div className="space-y-3">
      {task.notes.map((n) => (
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
          <BlurTextarea value={n.body} onSave={(v) => v.trim() && write(() => api.patch(`/notes/${n.id}`, { body: v.trim() }))} aria-label="Note" className="!min-h-0 !border-transparent !bg-transparent !p-0" rows={Math.min(8, n.body.split("\n").length)} />
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

function History({ task }: { task: TaskFull }) {
  const [open, setOpen] = useState(false);
  if (!task.events.length) return null;
  return (
    <Setting label="History">
      <button onClick={() => setOpen(!open)} className="text-[13px] text-fg-2 hover:text-fg">
        {open ? "Hide" : `Show ${task.events.length} changes`}
      </button>
      {open && (
        <ul className="mt-2 space-y-1 text-[12px] text-fg-2">
          {task.events.map((e) => (
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
