/** Week report: a few numbers, time per day and per project, and what got done. ?start=YYYY-MM-DD picks the week. */
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { addDays, mondayOf, useTodayDate } from "../components/common";
import { useActions } from "../components/Layout";
import { KIND_LABEL } from "../components/learn/bits";
import { IconButton, PageHeader } from "../components/ui";
import { api, qs, type WeekReport } from "../lib/api";
import { fmtDate, fmtMin } from "../lib/format";

export default function Report() {
  const [params, setParams] = useSearchParams();
  const today = useTodayDate();
  const thisWeek = mondayOf(today);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(params.get("start") ?? "") ? mondayOf(params.get("start")!) : thisWeek;
  const { data, isLoading, error } = useQuery({
    queryKey: ["report", "week", start],
    queryFn: () => api.get<WeekReport>(`/report/week${qs({ start })}`),
  });
  const go = (s: string) =>
    setParams((p) => {
      if (s === thisWeek) p.delete("start");
      else p.set("start", s);
      return p;
    });
  const end = data?.end ?? addDays(start, 6);
  const range = `${fmtDate(start, { month: "short", day: "numeric" })} – ${fmtDate(end, { month: "short", day: "numeric", year: "numeric" })}`;
  const label = start === thisWeek ? "This week" : start === addDays(thisWeek, -7) ? "Last week" : range;

  return (
    <>
      <PageHeader
        title="Report"
        lede={start === thisWeek || start === addDays(thisWeek, -7) ? range : "How the week went."}
        actions={
          <div className="flex items-center gap-1 rounded-lg border border-line bg-surface p-0.5">
            <IconButton aria-label="Previous week" onClick={() => go(addDays(start, -7))}>
              <ChevronLeft size={16} />
            </IconButton>
            <button onClick={() => go(thisWeek)} className="min-w-28 px-2 text-center text-[13px] font-medium" title="Back to this week">
              {label}
            </button>
            <IconButton aria-label="Next week" onClick={() => go(addDays(start, 7))} disabled={start >= thisWeek}>
              <ChevronRight size={16} />
            </IconButton>
          </div>
        }
      />
      <div className="space-y-6 px-4 md:px-8">
        {error ? (
          <p className="py-10 text-[14px] text-fg-2">The report could not be loaded: {(error as Error).message}</p>
        ) : isLoading || !data ? (
          <p className="py-10 text-[13px] text-fg-3">Loading…</p>
        ) : (
          <Body r={data} />
        )}
      </div>
    </>
  );
}

function Body({ r }: { r: WeekReport }) {
  const a = useActions();
  return (
    <>
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Num label="Tasks done" value={r.totals.done} />
        <Num label="Time logged" value={fmtMin(r.totals.logged_min)} />
        <Num label="Time learning" value={fmtMin(r.totals.learning_min)} />
        <Num label="Things captured" value={r.totals.captures} />
      </dl>

      <div className="grid items-start gap-6 lg:grid-cols-[3fr_2fr]">
        <Box title="Time per day">
          <DayChart days={r.days} />
        </Box>
        <Box title="Time by project">
          {r.by_project.length ? <ProjectBars rows={r.by_project} /> : <Quiet>No time on tasks this week.</Quiet>}
        </Box>
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Box title="Done" hint={r.done.length || undefined}>
          <List
            empty="Nothing finished this week."
            items={r.done.map((t) => ({ id: t.id, title: t.title, meta: fmtDate(t.done_at), open: () => a.openTask(t.id) }))}
          />
        </Box>
        <Box title="Carried over" hint={r.carried.length || undefined}>
          <List
            empty="Nothing carried over."
            items={r.carried.map((t) => ({ id: t.id, title: t.title, meta: t.status === "doing" ? "In progress" : "", open: () => a.openTask(t.id) }))}
          />
        </Box>
        <Box title="Sources finished" hint={r.sources_done.length || undefined}>
          <List
            empty="No sources finished."
            items={r.sources_done.map((s) => ({ id: s.id, title: s.title, meta: KIND_LABEL[s.kind], open: () => a.openSource(s.id) }))}
          />
        </Box>
      </div>

      {r.days_reviewed.length > 0 && (
        <Box title="End-of-day notes">
          <ul className="space-y-3 text-[14px]">
            {r.days_reviewed.map((d) => (
              <li key={d.date}>
                <p className="text-[12px] font-medium text-fg-2">{fmtDate(d.date, { weekday: "long", month: "short", day: "numeric" })}</p>
                {d.went_well && <p>Went well: {d.went_well}</p>}
                {d.blockers && <p className="text-fg-2">In the way: {d.blockers}</p>}
                {d.tomorrow && <p className="text-fg-2">Next: {d.tomorrow}</p>}
              </li>
            ))}
          </ul>
        </Box>
      )}
    </>
  );
}

function Box({ title, hint, children }: { title: string; hint?: number; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-4">
      <h2 className="mb-3 text-[15px] font-semibold">
        {title}
        {hint !== undefined && <span className="ml-2 text-[13px] font-normal text-fg-3">{hint}</span>}
      </h2>
      {children}
    </section>
  );
}

function Num({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <dd className="font-mono text-[22px] font-medium tabular-nums">{value}</dd>
      <dt className="mt-0.5 text-[12px] text-fg-2">{label}</dt>
    </div>
  );
}

const Quiet = ({ children }: { children: ReactNode }) => <p className="py-4 text-center text-[13px] text-fg-3">{children}</p>;

function List({ items, empty }: { items: { id: number; title: string; meta: string; open: () => void }[]; empty: string }) {
  if (!items.length) return <Quiet>{empty}</Quiet>;
  return (
    <ul className="-mx-2 space-y-0.5">
      {items.map((it) => (
        <li key={it.id}>
          <button onClick={it.open} className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left text-[14px] hover:bg-surface-2">
            <span className="min-w-0 flex-1 truncate">{it.title}</span>
            {it.meta && <span className="shrink-0 text-[12px] text-fg-3">{it.meta}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DayChart({ days }: { days: WeekReport["days"] }) {
  const sums = days.map((d) => d.task_min + d.source_min + d.revisit_min);
  // Headroom above the tallest bar for its label.
  const max = Math.max(60, ...sums) * 1.2;
  if (!sums.some(Boolean)) return <Quiet>No time logged this week.</Quiet>;
  return (
    <div className="grid h-52 grid-cols-7 gap-2" role="img" aria-label="Time logged per day">
      {days.map((d, i) => (
        <div key={d.date} className="flex h-full flex-col items-center" title={`${fmtDate(d.date, { weekday: "long" })}: ${fmtMin(sums[i])}`}>
          <div className="flex w-full flex-1 flex-col items-center justify-end gap-1 border-b border-line">
            {sums[i] > 0 && <span className="font-mono text-[11px] text-fg-2 tabular-nums">{fmtMin(sums[i])}</span>}
            <div className="w-full max-w-10 rounded-t-md bg-accent" style={{ height: `${(sums[i] / max) * 100}%`, minHeight: sums[i] ? 3 : 0 }} />
          </div>
          <span className="mt-1.5 text-[12px] text-fg-3">{fmtDate(d.date, { weekday: "short" })}</span>
        </div>
      ))}
    </div>
  );
}

function ProjectBars({ rows }: { rows: WeekReport["by_project"] }) {
  const sorted = [...rows].sort((x, y) => y.minutes - x.minutes);
  const max = Math.max(1, ...sorted.map((r) => r.minutes));
  return (
    <ul className="space-y-3">
      {sorted.map((r) => (
        <li key={r.project_key}>
          <div className="flex items-baseline justify-between gap-3 text-[13px]">
            <span className="min-w-0 truncate">{r.name}</span>
            <span className="font-mono text-fg-2 tabular-nums">{fmtMin(r.minutes)}</span>
          </div>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-2">
            <div className="h-full rounded-full bg-accent" style={{ width: `${(r.minutes / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
