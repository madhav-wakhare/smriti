/**
 * Today: the plan for the day, and a glance at what else wants you. Tick a task to finish it,
 * press play to time it, and add tasks from the box under the list (pick one you have, or type a
 * new title).
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, ChevronDown, X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { BlurTextarea, TimerButton, useTodayDate, useWrite } from "../components/common";
import { useActions } from "../components/Layout";
import { Checkbox, PageHeader } from "../components/ui";
import { Ascii } from "../components/Ascii";
import { QuoteLine } from "../components/QuoteLine";
import { api, qs, type Day, type Task } from "../lib/api";
import { PriorityMark, fmtDate, fmtMin } from "../lib/format";
import { useLocalState, useProjects, useToday } from "../lib/hooks";

export default function Today() {
  const { data } = useToday();
  const today = useTodayDate();
  const plan = useMemo(() => {
    if (!data) return [];
    const seen = new Set<number>();
    return [...data.overdue, ...data.planned].filter((t) => !seen.has(t.id) && seen.add(t.id));
  }, [data]);
  const doingElsewhere = data?.doing.filter((t) => !plan.some((p) => p.id === t.id)) ?? [];
  const longDate = new Date(`${today}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

  return (
    <>
      <PageHeader title="Today" lede={longDate} />
      <QuoteLine />
      <div className="grid items-start gap-6 px-4 md:px-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Box title="Plan" to="/tasks" hint={plan.length ? `${plan.filter((t) => t.status === "done").length} of ${plan.length} done` : undefined}>
            {data && !plan.length && (
              <div className="py-4 text-center">
                <Ascii name="wordmark" />
                <p className="mt-3 text-[14px] text-fg-2">Nothing planned yet. Add what you want to get done today.</p>
              </div>
            )}
            <ul className="divide-y divide-line">
              {plan.map((t) => (
                <PlanRow key={t.id} task={t} today={today} />
              ))}
            </ul>
            <AddToToday plan={plan} />
          </Box>

          {doingElsewhere.length > 0 && (
            <Box title="Also in progress" to="/tasks">
              <ul className="divide-y divide-line">
                {doingElsewhere.map((t) => (
                  <PlanRow key={t.id} task={t} today={today} />
                ))}
              </ul>
            </Box>
          )}
        </div>

        <div className="space-y-4">
          <Box title="At a glance">
            <div className="grid grid-cols-3 gap-2 text-center">
              <Num to="/tasks" title="See all open tasks" label="Open tasks" value={data?.counts.open} />
              <Num to="/tasks?view=timeline" title="See today's time as a timeline" label="Logged today" value={data ? fmtMin(data.counts.logged_today_min) : undefined} />
              <Num to="/report" title="See this week's report" label="Done this week" value={data?.week.done} />
            </div>
          </Box>

          <GoTo to="/inbox" show={!!data?.open_captures} title={`${data?.open_captures} in your inbox`} hint="Captures waiting to be sorted." />

          {!!data?.revisits_due.length && (
            <Box title="To revisit" to="/revisit" action={<Link to="/revisit" className="text-[13px] text-accent hover:underline">Review</Link>}>
              <ul className="space-y-1.5 text-[14px]">
                {data.revisits_due.slice(0, 3).map((c) => (
                  <li key={c.id}>
                    <Link to={`/revisit?item=${c.id}`} className="block truncate hover:underline">
                      {c.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </Box>
          )}

          {!!data?.waiting.length && (
            <Box title="Waiting longest" to="/tasks?view=list">
              <ul className="space-y-1.5 text-[14px]">
                {data.waiting.slice(0, 4).map((t) => (
                  <WaitingRow key={t.id} task={t} />
                ))}
              </ul>
            </Box>
          )}

          <EndOfDay date={today} />
        </div>
      </div>
    </>
  );
}

/** A card. With `to`, its title and a "View all" link on the right go to the page behind it. */
function Box({ title, hint, action, to, children }: { title: string; hint?: string; action?: ReactNode; to?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">
          {to ? (
            <Link to={to} className="group inline-flex items-center gap-1.5 hover:text-accent">
              {title}
              <ArrowRight size={14} className="text-fg-3 opacity-0 transition-opacity group-hover:opacity-100 group-hover:text-accent" />
            </Link>
          ) : (
            title
          )}
          {hint && <span className="ml-2 text-[13px] font-normal text-fg-3">{hint}</span>}
        </h2>
        {action ??
          (to && (
            <Link to={to} className="text-[13px] text-fg-2 hover:text-accent hover:underline">
              View all
            </Link>
          ))}
      </div>
      {children}
    </section>
  );
}

function Num({ label, value, to, title }: { label: string; value: ReactNode; to: string; title: string }) {
  return (
    <Link to={to} title={title} className="group rounded-lg px-1 py-2 transition-colors hover:bg-surface-2">
      <span className="block font-mono text-[20px] font-medium tabular-nums group-hover:text-accent">{value ?? "–"}</span>
      <span className="mt-0.5 block text-[12px] text-fg-2 group-hover:text-fg">{label}</span>
    </Link>
  );
}

function GoTo({ to, show, title, hint }: { to: string; show: boolean; title: string; hint: string }) {
  if (!show) return null;
  return (
    <Link to={to} className="group flex items-center justify-between rounded-xl border border-line bg-surface p-4 hover:border-accent">
      <div>
        <p className="text-[15px] font-semibold">{title}</p>
        <p className="text-[13px] text-fg-2">{hint}</p>
      </div>
      <ArrowRight size={16} className="text-fg-3 group-hover:text-accent" />
    </Link>
  );
}

function PlanRow({ task, today }: { task: Task; today: string }) {
  const write = useWrite();
  const { openTask } = useActions();
  const done = task.status === "done";
  const late = !done && !!task.due_on && task.due_on < today;
  return (
    <li className="group flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
      <Checkbox checked={done} onChange={(v) => write(() => api.patch(`/tasks/${task.id}`, { status: v ? "done" : "todo" }))} />
      <button onClick={() => openTask(task.id)} className="min-w-0 flex-1 basis-[calc(100%-2.5rem)] text-left sm:basis-0">
        <span className={clsx("text-[14px]", done && "text-fg-3 line-through")}>{task.title}</span>
        <span className="ml-2 font-mono text-[12px] text-fg-3">{task.key}</span>
      </button>
      <div className="ml-7 flex flex-1 items-center justify-end gap-3 sm:ml-0 sm:flex-none">
      {late && <span className="text-[12px] font-medium whitespace-nowrap text-critical">Due {fmtDate(task.due_on)}</span>}
      {task.status === "doing" && <span className="text-[12px] whitespace-nowrap text-fg-2">In progress</span>}
      {!done && <PriorityMark value={task.priority} />}
      {task.logged_min > 0 && <span className="w-14 text-right font-mono text-[12px] text-fg-2 tabular-nums">{fmtMin(task.logged_min)}</span>}
      {!done && <TimerButton taskId={task.id} />}
      {task.planned_on && (
        <button
          title="Take off today's plan"
          aria-label="Take off today's plan"
          onClick={() => write(() => api.patch(`/tasks/${task.id}`, { planned_on: null }))}
          className="rounded p-1 text-fg-3 opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-fg focus:opacity-100"
        >
          <X size={14} />
        </button>
      )}
      </div>
    </li>
  );
}

function WaitingRow({ task }: { task: Task }) {
  const { openTask } = useActions();
  const days = Math.floor((Date.now() - new Date(task.status_at).getTime()) / 86_400_000);
  return (
    <li className="flex items-center gap-2">
      <button onClick={() => openTask(task.id)} className="min-w-0 flex-1 truncate text-left hover:underline">
        {task.title}
      </button>
      <span className={clsx("text-[12px] whitespace-nowrap", days >= 30 ? "text-critical" : "text-fg-3")}>{days} days</span>
    </li>
  );
}

/** Type to find an open task and add it to today, or press Enter to create a new one for today. */
function AddToToday({ plan }: { plan: Task[] }) {
  const write = useWrite();
  const today = useTodayDate();
  const { data: projects } = useProjects();
  const [last] = useLocalState<number | null>("smriti-last-project", null);
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  const query = { status: "todo" };
  const { data: todo } = useQuery({ queryKey: ["tasks", query], queryFn: () => api.get<Task[]>(`/tasks${qs(query)}`), enabled: focus });
  const n = q.trim().toLowerCase();
  const hits = (todo ?? []).filter((t) => !plan.some((p) => p.id === t.id) && (!n || `${t.key} ${t.title}`.toLowerCase().includes(n))).slice(0, 6);
  const active = projects?.filter((p) => !p.archived) ?? [];
  const pid = active.some((p) => p.id === last) ? last : active[0]?.id;

  const add = (t: Task) => write(() => api.patch(`/tasks/${t.id}`, { planned_on: today })).then(() => setQ(""));
  const create = () => {
    const title = q.trim();
    if (title && pid) write(() => api.post("/tasks", { project_id: pid, title, planned_on: today })).then(() => setQ(""));
  };

  return (
    <div className="relative mt-3">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => setFocus(true)}
        onBlur={() => setTimeout(() => setFocus(false), 150)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (hits.length && n && hits[0].title.toLowerCase() === n) add(hits[0]);
            else create();
          }
        }}
        placeholder="Add to today: search your tasks, or type a new one and press Enter"
        aria-label="Add a task to today"
        className="h-10 w-full rounded-lg border border-dashed border-line-strong bg-transparent px-3 text-[14px] outline-none placeholder:text-fg-3 focus:border-solid focus:border-accent"
      />
      {focus && (hits.length > 0 || n) && (
        <div className="absolute inset-x-0 top-full z-20 mt-1 rounded-lg border border-line-strong bg-bg p-1 shadow-xl">
          {hits.map((t) => (
            <button key={t.id} onMouseDown={(e) => e.preventDefault()} onClick={() => add(t)} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] hover:bg-surface-2">
              <span className="min-w-0 flex-1 truncate">{t.title}</span>
              <span className="font-mono text-[12px] text-fg-3">{t.key}</span>
            </button>
          ))}
          {n && (
            <button onMouseDown={(e) => e.preventDefault()} onClick={create} className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[14px] text-accent hover:bg-surface-2">
              + Create “{q.trim()}” for today
              {pid && <span className="text-[12px] text-fg-3">in {active.find((p) => p.id === pid)?.name}</span>}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function EndOfDay({ date }: { date: string }) {
  const [open, setOpen] = useLocalState("smriti-eod-open", false);
  const write = useWrite();
  const { data: day } = useQuery({ queryKey: ["days", date], queryFn: () => api.get<Day>(`/days/${date}`), enabled: open });
  const save = (field: keyof Day, value: string) =>
    day && write(() => api.put(`/days/${date}`, { went_well: day.went_well, blockers: day.blockers, tomorrow: day.tomorrow, [field]: value }));
  return (
    <section className="rounded-xl border border-line bg-surface">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between p-4 text-[15px] font-semibold" aria-expanded={open}>
        End of day
        <ChevronDown size={16} className={clsx("text-fg-3 transition-transform", !open && "-rotate-90")} />
      </button>
      {open && day && (
        <div className="space-y-3 px-4 pb-4">
          {(
            [
              ["went_well", "What went well?"],
              ["blockers", "What got in the way?"],
              ["tomorrow", "First thing tomorrow"],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="block">
              <span className="mb-1 block text-[12px] font-medium text-fg-2">{label}</span>
              <BlurTextarea value={day[k]} onSave={(v) => save(k, v)} className="!min-h-14" />
            </label>
          ))}
          <Link to="/report" className="inline-flex items-center gap-1 text-[13px] text-fg-2 hover:text-accent hover:underline">
            Earlier days are in the week report <ArrowRight size={13} />
          </Link>
        </div>
      )}
    </section>
  );
}
