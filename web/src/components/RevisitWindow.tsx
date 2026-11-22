/**
 * One thing to revisit, opened like a task: the title, your notes, and an optional question to ask
 * yourself, all editable in place. On the right: "Seen it today", priority, retire, link, time.
 */
import { useQuery } from "@tanstack/react-query";
import { Check, Trash2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { api, type Priority, type RevisitFull, type Source, type TaskFull } from "../lib/api";
import { PRIORITY, fmtDate } from "../lib/format";
import { BlurInput, BlurTextarea, useWrite } from "./common";
import { useActions } from "./Layout";
import { TimeBox } from "./time";
import { Button, IconButton, Select, Tabs, useToast } from "./ui";
import { ago } from "./learn/bits";

export function RevisitWindow({ id, onClose }: { id: number | null; onClose: () => void }) {
  useEffect(() => {
    if (!id) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest("input,textarea,select") && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [id, onClose]);
  if (!id) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-3 sm:p-6 sm:pt-[5vh]">
      <div className="anim-fade fixed inset-0 bg-[var(--overlay)]" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-label="Revisit" className="anim-pop relative w-full max-w-[880px] rounded-xl border border-line-strong bg-bg shadow-2xl">
        <Body id={id} onClose={onClose} />
      </div>
    </div>,
    document.body,
  );
}

function Body({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: c, error, isLoading } = useQuery({ queryKey: ["revisits", "one", id], queryFn: () => api.get<RevisitFull>(`/revisits/${id}`) });
  const write = useWrite();
  const toast = useToast();

  if (isLoading) return <p className="p-8 text-[14px] text-fg-3">Loading…</p>;
  if (error || !c)
    return (
      <div className="flex items-center justify-between p-6 text-[14px] text-fg-2">
        This could not be loaded. It may have been deleted.
        <Button onClick={onClose}>Close</Button>
      </div>
    );

  const patch = (body: Record<string, unknown>) => write(() => api.patch(`/revisits/${id}`, body));
  const seenToday = !!c.reviewed_at && new Date(c.reviewed_at).toDateString() === new Date().toDateString();

  const remove = async () => {
    const ok = await write(async () => (await api.del(`/revisits/${id}`), true));
    if (!ok) return;
    onClose();
    toast(`Deleted “${c.title}”`, "default", { label: "Undo", onClick: () => void write(() => api.post(`/trash/revisit/${id}/restore`)) });
  };

  return (
    <>
      <div className="flex h-12 items-center gap-3 border-b border-line pl-5 pr-2 text-[13px] text-fg-2">
        <span>Revisit</span>
        <span className="text-fg-3">·</span>
        <span>{c.reviewed_at ? `Last seen ${ago(c.reviewed_at)}` : "Not seen yet"}</span>
        <span className="flex-1" />
        <IconButton aria-label="Delete" title="Delete" onClick={remove}>
          <Trash2 size={15} />
        </IconButton>
        <IconButton aria-label="Close" title="Close (Esc)" onClick={onClose}>
          <X size={17} />
        </IconButton>
      </div>

      <div className="grid md:grid-cols-[1fr_250px]">
        <div className="min-w-0 space-y-5 p-5 md:p-6">
          <BlurInput
            value={c.title}
            onSave={(v) => v.trim() && patch({ title: v.trim() })}
            aria-label="Title"
            className="!h-auto !border-transparent !bg-transparent !px-0 text-[22px] font-semibold hover:!border-transparent focus:!border-transparent"
          />
          <BlurInput
            value={c.prompt}
            onSave={(v) => patch({ prompt: v.trim() })}
            aria-label="A question to ask yourself"
            placeholder="A question to ask yourself (optional)"
            className="!border-transparent !bg-transparent !px-0 text-fg-2 hover:!border-transparent focus:!border-transparent"
          />
          <BlurTextarea value={c.body} onSave={(v) => patch({ body: v })} aria-label="Notes" placeholder="Write what you want to remember…" className="min-h-48" />

          <section>
            <h3 className="mb-2.5 text-[15px] font-semibold">Time</h3>
            <TimeBox subject={{ revisit_id: c.id }} sessions={c.sessions} loggedMin={c.logged_min} />
          </section>
        </div>

        <aside className="space-y-5 border-t border-line p-5 md:border-t-0 md:border-l md:p-6">
          {c.status === "active" &&
            (seenToday ? (
              <p className="flex items-center gap-2 rounded-md border border-accent/50 bg-accent-soft px-3 py-2 text-[13px]">
                <Check size={14} className="text-accent" /> Seen today
              </p>
            ) : (
              <Button variant="primary" className="w-full" icon={<Check size={14} />} onClick={() => write(() => api.post(`/revisits/${id}/reviewed`), "Marked as seen")}>
                Seen it today
              </Button>
            ))}

          <Setting label="Status">
            <Tabs
              value={c.status}
              onChange={(v) => patch({ status: v })}
              tabs={[
                { value: "active", label: "Active" },
                { value: "retired", label: "Retired" },
              ]}
            />
          </Setting>

          <Setting label="Priority">
            <Select value={c.priority} onChange={(e) => patch({ priority: Number(e.target.value) as Priority })} aria-label="Priority">
              {PRIORITY.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Setting>

          <Setting label="Link">
            <BlurInput value={c.url ?? ""} onSave={(v) => patch({ url: v.trim() || null })} placeholder="https://…" aria-label="Link" />
            {c.url && (
              <a href={c.url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-[12px] text-accent hover:underline">
                Open link
              </a>
            )}
          </Setting>

          {c.task_id && <From kind="task" id={c.task_id} />}
          {c.source_id && <From kind="source" id={c.source_id} />}

          <p className="text-[12px] text-fg-3">Added {fmtDate(c.created_at)}</p>
        </aside>
      </div>
    </>
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

/** Where this came from: the task or source it was made from. */
function From({ kind, id }: { kind: "task" | "source"; id: number }) {
  const { openTask, openSource } = useActions();
  const { data } = useQuery({
    queryKey: [kind === "task" ? "tasks" : "sources", id],
    queryFn: () => api.get<TaskFull | Source>(`/${kind === "task" ? "tasks" : "sources"}/${id}`),
  });
  return (
    <Setting label={kind === "task" ? "From task" : "From source"}>
      <button onClick={() => (kind === "task" ? openTask(id) : openSource(id))} className="block w-full truncate text-left text-[13px] text-accent hover:underline">
        {data?.title ?? "…"}
      </button>
    </Setting>
  );
}
