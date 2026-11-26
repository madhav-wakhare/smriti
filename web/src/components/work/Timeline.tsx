/**
 * The day as a trace. Read it like a distributed trace in an APM tool: the top bar is the whole day
 * (first start to last stop), and each row is one task (or source or revisit item) with its spans,
 * meaning the stretches of time you worked on it, placed on the hour axis. Subtasks sit under their
 * parent. Tasks planned for the day that have no time yet show as empty rows, so the plan and what
 * happened can be read together. The hour axis is marked every half hour; hovering a span marks its start
 * and end on the axis and shows a card with the item, times, length and note. Click a row to open it.
 */
import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api, qs, type Session, type SubjectKind, type Task } from "../../lib/api";
import { fmtClock, fmtMin, fmtTime } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { addDays, useTodayDate } from "../common";
import { useActions } from "../Layout";
import { Button } from "../ui";

type Span = { id: number; start: number; end: number; running: boolean; note: string; minutes: number };
type Row = {
  key: string;
  kind: SubjectKind;
  id: number;
  label: string;
  code: string | null;
  depth: number;
  spans: Span[];
  total: number;
  planned: boolean;
};

const HOUR = 3_600_000;
const hhmm = (t: number) => fmtTime(new Date(t).toISOString());
/** 24-hour "09:30", as on the axis. */
const hhmm24 = (t: number) => {
  const d = new Date(t);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

/** What the hover card shows. */
type Tip = { x: number; y: number; title: string; code: string | null; kind: SubjectKind | "day"; start: number; end: number; running: boolean; minutes: number; note: string };
const BAR: Record<SubjectKind, string> = { task: "bg-task", source: "bg-learning", revisit: "bg-fg-2" };

export function Timeline({ tasks, projectId }: { tasks: Task[]; projectId?: number }) {
  const today = useTodayDate();
  const [params, setParams] = useSearchParams();
  const day = params.get("day") ?? today;
  const isToday = day === today;
  const now = useNow(30_000);
  const { openTask, openSource } = useActions();
  const [tip, setTip] = useState<Tip | null>(null);

  const setDay = (d: string) =>
    setParams((p) => {
      if (d === today) p.delete("day");
      else p.set("day", d);
      return p;
    });

  const { data: sessions, isLoading } = useQuery({
    queryKey: ["sessions", "day", day],
    queryFn: () => api.get<Session[]>(`/sessions${qs({ from: day, to: day })}`),
    refetchInterval: isToday ? 30_000 : false,
  });

  const byId = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const rows = useMemo(() => {
    const map = new Map<string, Row>();
    for (const s of sessions ?? []) {
      const task = s.subject.kind === "task" ? byId.get(s.subject.id) : undefined;
      // With a project chosen, keep only that project's tasks.
      if (projectId && (s.subject.kind !== "task" || task?.project_id !== projectId)) continue;
      const k = `${s.subject.kind}-${s.subject.id}`;
      const start = new Date(s.started_at).getTime();
      const end = s.ended_at ? new Date(s.ended_at).getTime() : now;
      const row = map.get(k) ?? {
        key: k,
        kind: s.subject.kind,
        id: s.subject.id,
        label: s.subject.label,
        code: s.subject.key,
        depth: 0,
        spans: [],
        total: 0,
        planned: false,
      };
      const minutes = s.minutes ?? Math.max(1, Math.round((end - start) / 60_000));
      row.spans.push({ id: s.id, start, end, running: !s.ended_at, note: s.note, minutes });
      row.total += minutes;
      map.set(k, row);
    }
    // The day's plan: tasks planned for this day with no time yet still get a row.
    for (const t of tasks) {
      // Open tasks planned for an earlier day carry over onto today, as they do on the Today page.
      const carried = isToday && !!t.planned_on && t.planned_on < day && t.status !== "done";
      if (t.planned_on !== day && !carried) continue;
      const k = `task-${t.id}`;
      const row = map.get(k);
      if (row) row.planned = true;
      else map.set(k, { key: k, kind: "task", id: t.id, label: t.title, code: t.key, depth: 0, spans: [], total: 0, planned: true });
    }
    // Order: rows with time first (by first start), then planned rows without time. Subtasks follow their parent.
    const all = [...map.values()].sort((a, b) => (a.spans[0]?.start ?? Infinity) - (b.spans[0]?.start ?? Infinity));
    const out: Row[] = [];
    const placed = new Set<string>();
    const place = (r: Row, depth: number) => {
      if (placed.has(r.key)) return;
      placed.add(r.key);
      out.push({ ...r, depth });
      for (const c of all) if (c.kind === "task" && byId.get(c.id)?.parent_id === r.id && r.kind === "task") place(c, depth + 1);
    };
    for (const r of all) {
      const parent = r.kind === "task" ? byId.get(r.id)?.parent_id : null;
      if (parent && all.some((x) => x.kind === "task" && x.id === parent)) continue; // placed under its parent
      place(r, 0);
    }
    for (const r of all) place(r, 0);
    return out;
  }, [sessions, tasks, byId, day, projectId, now, isToday]);

  const spans = rows.flatMap((r) => r.spans);
  const total = rows.reduce((n, r) => n + r.total, 0);
  const first = spans.length ? Math.min(...spans.map((s) => s.start)) : null;
  const last = spans.length ? Math.max(...spans.map((s) => s.end)) : null;

  // The axis: whole hours around the work, at least 9:00 to 18:00.
  const dayStart = new Date(`${day}T00:00:00`).getTime();
  const fromH = Math.min(9, first ? Math.floor((first - dayStart) / HOUR) : 9);
  const toH = Math.max(18, last ? Math.ceil((last - dayStart) / HOUR) : 18, isToday ? Math.ceil((now - dayStart) / HOUR) : 0);
  const axisStart = dayStart + fromH * HOUR;
  const axisSpan = (toH - fromH) * HOUR;
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - axisStart) / axisSpan) * 100))}%`;
  const width = (a: number, b: number) => `max(3px, ${Math.max(0, ((b - a) / axisSpan) * 100)}%)`;
  const hours = Array.from({ length: toH - fromH + 1 }, (_, i) => fromH + i);
  const halves = Array.from({ length: (toH - fromH) * 2 + 1 }, (_, i) => axisStart + (i * HOUR) / 2);
  const label = isToday ? "Today" : day === addDays(today, -1) ? "Yesterday" : new Date(`${day}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });

  const open = (r: Row) => (r.kind === "task" ? openTask(r.id) : r.kind === "source" ? openSource(r.id) : undefined);

  return (
    <div className="space-y-4">
      {/* day switcher and the day's summary */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" aria-label="Previous day" onClick={() => setDay(addDays(day, -1))} icon={<ChevronLeft size={15} />} />
          <button onClick={() => setDay(today)} className="min-w-28 rounded-md px-2 py-1 text-center text-[14px] font-semibold hover:bg-surface-2" title="Back to today">
            {label}
          </button>
          <Button size="sm" variant="ghost" aria-label="Next day" disabled={isToday} onClick={() => setDay(addDays(day, 1))} icon={<ChevronRight size={15} />} />
        </div>
        <p className="text-[13px] text-fg-2">
          <span className="font-mono text-fg tabular-nums">{fmtMin(total)}</span> across {rows.filter((r) => r.spans.length).length} items
          {first && last && (
            <>
              {" "}
              · {fmtTime(new Date(first).toISOString())} to {spans.some((s) => s.running) ? "now" : fmtTime(new Date(last).toISOString())}
            </>
          )}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <div className="min-w-[720px]">
          {/* hour axis */}
          <div className="grid grid-cols-[260px_1fr_84px] border-b border-line text-[11px] text-fg-3">
            <div className="px-4 py-2 font-medium text-fg-2">Item</div>
            <div className="relative h-8">
              {halves.map((t) => {
                const whole = (t - dayStart) % HOUR === 0;
                return (
                  <span
                    key={t}
                    className={clsx("absolute top-2 -translate-x-1/2 font-mono tabular-nums transition-opacity", whole ? "text-fg-3" : "text-fg-3/60", tip && "opacity-30")}
                    style={{ left: pct(t) }}
                  >
                    {hhmm24(t)}
                  </span>
                );
              })}
              {tip &&
                // The hovered span's start and end, on the axis. A short span gets one "10:20–10:35" mark.
                (tip.running || tip.end - tip.start < axisSpan * 0.07
                  ? [{ t: tip.start, text: `${hhmm24(tip.start)}–${tip.running ? "now" : hhmm24(tip.end)}` }]
                  : [
                      { t: tip.start, text: hhmm24(tip.start) },
                      { t: tip.end, text: hhmm24(tip.end) },
                    ]
                ).map((m) => (
                  <span
                    key={m.t}
                    className="absolute top-1.5 z-10 -translate-x-1/2 rounded bg-accent px-1 py-0.5 font-mono text-[11px] whitespace-nowrap text-accent-fg tabular-nums"
                    style={{ left: pct(m.t) }}
                  >
                    {m.text}
                  </span>
                ))}
            </div>
            <div className="px-3 py-2 text-right font-medium text-fg-2">Time</div>
          </div>

          {/* the root span: the whole working day */}
          {first && last && (
            <TraceRow
              label={<span className="font-semibold">{label}'s work</span>}
              total={total}
              hours={hours}
              dayStart={dayStart}
              pct={pct}
              now={isToday ? now : null}
            >
              <span
                className="absolute top-1/2 h-2.5 -translate-y-1/2 rounded-sm bg-fg-3/60"
                style={{ left: pct(first), width: width(first, last) }}
                onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: `${label}'s work`, code: null, kind: "day", start: first, end: last, running: spans.some((x) => x.running), minutes: total, note: "" })}
                onMouseLeave={() => setTip(null)}
              />

            </TraceRow>
          )}

          {rows.map((r) => (
            <TraceRow
              key={r.key}
              onClick={r.kind === "revisit" ? undefined : () => open(r)}
              label={
                <span className="flex min-w-0 items-center gap-2" style={{ paddingLeft: r.depth * 16 }}>
                  {r.depth > 0 && <span className="text-fg-3">└</span>}
                  <span className={clsx("inline-block size-2 shrink-0 rounded-sm", BAR[r.kind])} aria-hidden />
                  <span className="truncate">{r.label}</span>
                  {r.code && <span className="shrink-0 font-mono text-[11px] text-fg-3">{r.code}</span>}
                </span>
              }
              total={r.total}
              hours={hours}
              dayStart={dayStart}
              pct={pct}
              now={isToday ? now : null}
            >
              {r.spans.map((s) => {
                return (
                  <span key={s.id}>
                    <span
                      onClick={(e) => e.stopPropagation()}
                      onMouseMove={(e) => setTip({ x: e.clientX, y: e.clientY, title: r.label, code: r.code, kind: r.kind, start: s.start, end: s.end, running: s.running, minutes: s.minutes, note: s.note })}
                      onMouseLeave={() => setTip(null)}
                      className={clsx("absolute top-1/2 z-[5] h-4 -translate-y-1/2 rounded-sm transition-[filter] hover:brightness-125", BAR[r.kind], s.running && "animate-pulse")}
                      style={{ left: pct(s.start), width: width(s.start, s.end) }}
                    />
                  </span>
                );
              })}
              {(() => {
                // A task due at a set time this day (a meeting) shows where it sits on the day.
                const t = r.kind === "task" ? byId.get(r.id) : undefined;
                if (!t?.due_time || t.due_on !== day) return null;
                const at = new Date(`${day}T${t.due_time}:00`).getTime();
                return (
                  <span
                    className="absolute top-1/2 z-[6] flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap"
                    style={{ left: pct(at) }}
                    title={`Due at ${fmtClock(t.due_time)}`}
                  >
                    <span className="h-4 w-0.5 rounded-full bg-accent" aria-hidden />
                    <span className="rounded border border-accent/50 bg-surface px-1 font-mono text-[11px] text-accent tabular-nums">{fmtClock(t.due_time)}</span>
                  </span>
                );
              })()}
              {!r.spans.length && r.planned && (
                <span className="absolute inset-y-0 left-2 flex items-center text-[12px] text-fg-3">Planned, no time yet</span>
              )}
            </TraceRow>
          ))}

          {!isLoading && !rows.length && (
            <p className="px-4 py-10 text-center text-[14px] text-fg-2">
              No time logged{isToday ? " yet today. Start a timer on a task and it shows up here." : " on this day."}
            </p>
          )}
        </div>
      </div>

      {tip && <HoverCard tip={tip} />}

      <p className="flex flex-wrap items-center gap-4 text-[12px] text-fg-3">
        <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm bg-task" /> Task</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm bg-learning" /> Learning</span>
        <span className="flex items-center gap-1.5"><span className="inline-block size-2 rounded-sm bg-fg-2" /> Revisit</span>
        {isToday && <span className="flex items-center gap-1.5"><span className="inline-block h-3 w-px bg-critical" /> Now</span>}
      </p>
    </div>
  );
}

function TraceRow({
  label,
  total,
  hours,
  dayStart,
  pct,
  now,
  onClick,
  children,
}: {
  label: ReactNode;
  total: number;
  hours: number[];
  dayStart: number;
  pct: (t: number) => string;
  now: number | null;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      onClick={onClick}
      className={clsx("grid grid-cols-[260px_1fr_84px] border-b border-line last:border-b-0 text-[13px]", onClick && "cursor-pointer hover:bg-surface-2")}
    >
      <div className="flex min-w-0 items-center px-4 py-2.5">{label}</div>
      <div className="relative">
        {hours.map((h) => (
          <span key={h} className="absolute inset-y-0 w-px bg-line/60" style={{ left: pct(dayStart + h * 3_600_000) }} aria-hidden />
        ))}
        {hours.slice(0, -1).map((h) => (
          <span key={`${h}.5`} className="absolute inset-y-0 w-px bg-line/25" style={{ left: pct(dayStart + h * 3_600_000 + 1_800_000) }} aria-hidden />
        ))}
        {now && <span className="absolute inset-y-0 z-10 w-px bg-critical" style={{ left: pct(now) }} aria-hidden />}
        {children}
      </div>
      <div className="flex items-center justify-end px-3 font-mono text-[12px] whitespace-nowrap text-fg-2 tabular-nums">{total ? fmtMin(total) : ""}</div>
    </div>
  );
}

const KIND_WORD: Record<Tip["kind"], string> = { task: "Task", source: "Learning", revisit: "Revisit", day: "Whole day" };

/** The card that follows the pointer over a span. */
function HoverCard({ tip }: { tip: Tip }) {
  const W = 260;
  const left = Math.min(tip.x + 14, window.innerWidth - W - 8);
  const top = tip.y + 16 + 140 > window.innerHeight ? tip.y - 16 - 120 : tip.y + 16;
  return (
    <div role="tooltip" style={{ left, top, width: W }} className="pointer-events-none fixed z-[80] rounded-lg border border-line-strong bg-bg p-3 text-[13px] shadow-lg">
      <p className="flex items-center gap-2 text-[11px] text-fg-3">
        <span className={clsx("inline-block size-2 rounded-sm", tip.kind === "day" ? "bg-fg-3" : BAR[tip.kind])} aria-hidden />
        {KIND_WORD[tip.kind]}
        {tip.code && <span className="font-mono">{tip.code}</span>}
      </p>
      <p className="mt-1 line-clamp-2 font-medium">{tip.title}</p>
      <div className="mt-2 flex items-baseline justify-between gap-3 font-mono tabular-nums">
        <span>
          {hhmm(tip.start)} – {tip.running ? "now" : hhmm(tip.end)}
        </span>
        <span className="text-fg-2">{fmtMin(tip.minutes)}</span>
      </div>
      {tip.running && <p className="mt-1 text-[12px] text-accent">Timer running</p>}
      {tip.note && <p className="mt-2 border-t border-line pt-2 text-[12px] text-fg-2">{tip.note}</p>}
    </div>
  );
}
