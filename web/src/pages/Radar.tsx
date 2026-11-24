/**
 * Radar: quick notes to sort out later. Type in the box and press Enter to capture. Turn each one
 * into a task, a source or something to revisit, or dismiss it.
 */
import { ChevronDown, CornerDownLeft } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Ascii } from "../components/Ascii";
import { useWrite } from "../components/common";
import { useActions } from "../components/Layout";
import { Button, Menu, PageHeader, Tabs, useToast } from "../components/ui";
import { api, type Capture, type SourceKind } from "../lib/api";
import { SOURCE_KIND, fmtDate, fmtTime, localIso } from "../lib/format";
import { useCaptures, useProjects } from "../lib/hooks";

type Status = Capture["status"];
type KeepAs = "task" | "source" | "revisit";

function dayLabel(day: string) {
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (day === localIso()) return "Today";
  if (day === localIso(y)) return "Yesterday";
  return fmtDate(day, { weekday: "long", month: "short", day: "numeric" });
}

/** Newest day first; inside a day, newest first. */
function byDay(items: Capture[]) {
  const out: { day: string; items: Capture[] }[] = [];
  for (const c of [...items].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    const day = localIso(new Date(c.created_at));
    const g = out.find((x) => x.day === day);
    if (g) g.items.push(c);
    else out.push({ day, items: [c] });
  }
  return out;
}

export default function Radar() {
  const [status, setStatus] = useState<Status>("open");
  const { data: open } = useCaptures("open");
  const { data: kept } = useCaptures("kept");
  const { data: dismissed } = useCaptures("dismissed");
  const list = (status === "open" ? open : status === "kept" ? kept : dismissed) ?? [];
  const groups = useMemo(() => byDay(list), [list]);
  const [text, setText] = useState("");
  const write = useWrite();
  const toast = useToast();
  const { openTask, openSource } = useActions();
  const navigate = useNavigate();

  const capture = async () => {
    const t = text.trim();
    if (!t) return;
    const r = await write(() => api.post<Capture>("/captures", { text: t }));
    if (r) setText("");
  };

  const keep = async (c: Capture, as: KeepAs, extra: { project_id?: number; kind?: SourceKind } = {}) => {
    const r = await write(() => api.post<Capture>(`/captures/${c.id}/keep`, { as, ...extra }));
    if (!r) return;
    const go = r.task_id ? () => openTask(r.task_id!) : r.source_id ? () => openSource(r.source_id!) : r.revisit_id ? () => navigate(`/revisit?item=${r.revisit_id}`) : null;
    toast(as === "revisit" ? "Added to Revisit" : `Made a ${as}`, "default", go ? { label: "Open", onClick: go } : undefined);
  };
  const dismiss = (c: Capture) => write(() => api.post(`/captures/${c.id}/dismiss`));
  const reopen = (c: Capture) => write(() => api.patch(`/captures/${c.id}`, { status: "open" }), "Back on your radar");
  const remove = async (c: Capture) => {
    const ok = await write(async () => (await api.del(`/captures/${c.id}`), true));
    if (ok) toast("Deleted", "default", { label: "Undo", onClick: () => void write(() => api.post(`/trash/capture/${c.id}/restore`)) });
  };

  return (
    <>
      <PageHeader title="Radar" lede="Catch things now, sort them out later." />
      <div className="max-w-3xl space-y-5 px-4 md:px-8">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            capture();
          }}
          className="flex items-center gap-2 rounded-xl border border-line-strong bg-surface p-1.5 pl-4 focus-within:border-accent"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && e.currentTarget.blur()}
            placeholder="What's on your mind?"
            aria-label="Capture a thought"
            className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-fg-3"
          />
          <Button type="submit" variant="primary" disabled={!text.trim()} icon={<CornerDownLeft size={13} />}>
            Add
          </Button>
        </form>

        <Tabs<Status>
          value={status}
          onChange={setStatus}
          tabs={[
            { value: "open", label: `Open ${open?.length ?? 0}` },
            { value: "kept", label: `Kept ${kept?.length ?? 0}` },
            { value: "dismissed", label: `Dismissed ${dismissed?.length ?? 0}` },
          ]}
        />

        {groups.length === 0 ? (
          <div className="rounded-xl border border-line bg-surface py-10 text-center">
            {status === "open" && <Ascii name="hammock" />}
            <p className="mt-3 text-[14px] text-fg-2">
              {status === "open" ? "All sorted. Type above whenever something comes to mind." : status === "kept" ? "Nothing kept yet." : "Nothing dismissed."}
            </p>
          </div>
        ) : (
          groups.map((g) => (
            <section key={g.day}>
              <h2 className="mb-2 text-[13px] font-medium text-fg-2">{dayLabel(g.day)}</h2>
              <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
                {g.items.map((c) => (
                  <li key={c.id} className="px-4 py-3">
                    <p className="text-[14px] break-words whitespace-pre-wrap">{c.text}</p>
                    {c.details && <p className="mt-1 text-[13px] whitespace-pre-wrap text-fg-2">{c.details}</p>}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-[12px] text-fg-3">
                      <span>{fmtTime(c.created_at)}</span>
                      {c.url && (
                        <a href={c.url} target="_blank" rel="noreferrer" className="max-w-xs truncate text-accent hover:underline">
                          {c.url.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                      {c.tags.length > 0 && <span>{c.tags.join(", ")}</span>}
                    </p>
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {c.status === "open" && (
                        <>
                          <MakeTask onPick={(project_id) => keep(c, "task", { project_id })} />
                          <Menu
                            trigger={
                              <Button size="sm">
                                Make source <ChevronDown size={12} />
                              </Button>
                            }
                            items={SOURCE_KIND.map((k) => ({ label: k.label, onClick: () => keep(c, "source", { kind: k.value }) }))}
                          />
                          <Button size="sm" onClick={() => keep(c, "revisit")}>
                            Add to Revisit
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => dismiss(c)}>
                            Dismiss
                          </Button>
                        </>
                      )}
                      {c.status === "kept" && (
                        <>
                          {c.task_id && (
                            <Button size="sm" onClick={() => openTask(c.task_id!)}>
                              Open task
                            </Button>
                          )}
                          {c.source_id && (
                            <Button size="sm" onClick={() => openSource(c.source_id!)}>
                              Open source
                            </Button>
                          )}
                          {c.revisit_id && (
                            <Button size="sm" onClick={() => navigate(`/revisit?item=${c.revisit_id}`)}>
                              Open in Revisit
                            </Button>
                          )}
                        </>
                      )}
                      {c.status === "dismissed" && (
                        <>
                          <Button size="sm" onClick={() => reopen(c)}>
                            Back to Radar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => remove(c)}>
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          ))
        )}
      </div>
    </>
  );
}

/** "Make task": straight away with one project, else a menu of projects. */
function MakeTask({ onPick }: { onPick: (projectId: number) => void }) {
  const { data: projects } = useProjects();
  const active = (projects ?? []).filter((p) => !p.archived);
  if (active.length <= 1)
    return (
      <Button size="sm" disabled={!active.length} title={active.length ? undefined : "Add a project in Settings first"} onClick={() => active[0] && onPick(active[0].id)}>
        Make task
      </Button>
    );
  return (
    <Menu
      trigger={
        <Button size="sm">
          Make task <ChevronDown size={12} />
        </Button>
      }
      items={active.map((p) => ({ label: p.name, onClick: () => onPick(p.id) }))}
    />
  );
}
