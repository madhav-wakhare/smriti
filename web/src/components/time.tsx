/**
 * Time on one task, source or revisit, in one place: the total, a Start/Stop button, one-click
 * amounts (+15m, +30m, +1h, +2h) logged as done just now, and "Log time" for anything else, typed as
 * in Arc ("1h 30m", "45m", "1d"), with a start that defaults to now minus the time spent.
 */
import clsx from "clsx";
import { Clock, Play, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { api, type Session } from "../lib/api";
import { clock, fmtDate, fmtMin, localIso, parseDuration } from "../lib/format";
import { useNow, useRunning } from "../lib/hooks";
import { useWrite } from "./common";
import { Button, Input } from "./ui";

export type Subject = { task_id: number } | { source_id: number } | { revisit_id: number };

const QUICK = [15, 30, 60, 120];

function isMine(s: Session | null | undefined, subject: Subject) {
  if (!s) return false;
  const [k, id] = Object.entries(subject)[0] as [string, number];
  return `${s.subject.kind}_id` === k && s.subject.id === id;
}

/** A Date as the value of a datetime-local input (local time, minutes). */
function localInput(d: Date) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** "Started 10:20" style start for time logged by hand: ends now for today, else 09:00 that day. */
function startFor(date: string, minutes: number) {
  if (date === localIso()) return new Date(Date.now() - minutes * 60_000).toISOString();
  return new Date(`${date}T09:00:00`).toISOString();
}

export function StartStop({ subject, size = "md" }: { subject: Subject; size?: "sm" | "md" }) {
  const { data: running } = useRunning();
  const now = useNow();
  const write = useWrite();
  const mine = isMine(running, subject);
  const secs = mine && running ? Math.max(0, Math.floor((now - new Date(running.started_at).getTime()) / 1000)) : 0;
  return mine ? (
    <Button size={size} variant="primary" onClick={() => write(() => api.post("/sessions/stop"))} icon={<Square size={11} fill="currentColor" />}>
      Stop <span className="font-mono tabular-nums">{clock(secs)}</span>
    </Button>
  ) : (
    <Button size={size} onClick={() => write(() => api.post("/sessions/start", subject))} icon={<Play size={12} />}>
      Start timer
    </Button>
  );
}

export function TimeBox({ subject, sessions, loggedMin, estimateMin }: { subject: Subject; sessions: Session[]; loggedMin: number; estimateMin?: number | null }) {
  const write = useWrite();
  const [custom, setCustom] = useState(false);
  const [spent, setSpent] = useState("");
  const [started, setStarted] = useState(localInput(new Date()));
  // Until you pick a start yourself, it is "now minus time spent" (1h 30m logged at 18:00 started at 16:30), as in Arc.
  const [startTouched, setStartTouched] = useState(false);
  const [note, setNote] = useState("");
  const typed = parseDuration(spent);
  const valid = typeof typed === "number" && !Number.isNaN(typed) && typed > 0;
  useEffect(() => {
    if (!startTouched) setStarted(localInput(new Date(Date.now() - (valid ? typed : 0) * 60_000)));
  }, [typed, valid, startTouched]);
  const [all, setAll] = useState(false);

  const log = (min: number, day = localIso(), text = "") =>
    write(() => api.post("/sessions", { ...subject, started_at: startFor(day, min), minutes: min, note: text }), `Logged ${fmtMin(min)}`);

  const ended = sessions.filter((s) => s.ended_at).sort((a, b) => b.started_at.localeCompare(a.started_at));
  const shown = all ? ended : ended.slice(0, 4);
  const over = !!estimateMin && loggedMin > estimateMin;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[14px]">
          <span className={clsx("font-mono text-[22px] font-medium tabular-nums", over && "text-critical")}>{fmtMin(loggedMin)}</span>
          <span className="ml-2 text-fg-2">logged{estimateMin ? ` of ${fmtMin(estimateMin)} estimated` : ""}</span>
        </p>
        <StartStop subject={subject} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] text-fg-2">Add time:</span>
        {QUICK.map((m) => (
          <Button key={m} size="sm" onClick={() => log(m)}>
            +{fmtMin(m)}
          </Button>
        ))}
        <Button size="sm" variant={custom ? "default" : "ghost"} onClick={() => setCustom(!custom)} icon={<Clock size={12} />} aria-expanded={custom}>
          Log time
        </Button>
      </div>

      {custom && (
        <form
          className="space-y-3 rounded-lg border border-line bg-surface-2/40 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!valid) return;
            write(
              () => api.post("/sessions", { ...subject, started_at: new Date(started).toISOString(), minutes: typed, note: note.trim() }),
              `Logged ${fmtMin(typed)}`,
            ).then((r) => {
              if (r === undefined) return;
              setSpent("");
              setNote("");
              setStartTouched(false);
              setCustom(false);
            });
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-fg-2">Time spent</span>
              <Input autoFocus value={spent} onChange={(e) => setSpent(e.target.value)} placeholder="1h 30m" aria-describedby="spent-hint" />
              <span id="spent-hint" className={clsx("mt-1 block text-[12px]", spent && !valid ? "text-critical" : "text-fg-3")}>
                {spent && !valid ? "Try 1h 30m, 45m, 2.5h or 1d (8h)" : valid ? `= ${fmtMin(typed)}` : "Like 1h 30m, 45m, 1:30 or 1d (8h)"}
              </span>
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-fg-2">Started</span>
              <Input
                type="datetime-local"
                value={started}
                max={localInput(new Date())}
                onChange={(e) => {
                  setStartTouched(true);
                  setStarted(e.target.value);
                }}
              />
              <span className="mt-1 block text-[12px] text-fg-3">{startTouched ? "\u00a0" : "Now minus time spent"}</span>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[12px] font-medium text-fg-2">What you did</span>
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional" />
          </label>
          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setCustom(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!valid}>
              Log {valid ? fmtMin(typed) : "time"}
            </Button>
          </div>
        </form>
      )}

      {ended.length > 0 && (
        <ul className="divide-y divide-line rounded-lg border border-line text-[13px]">
          {shown.map((s) => (
            <li key={s.id} className="group flex items-center gap-3 px-3 py-2">
              <span className="w-20 shrink-0 text-fg-2">{fmtDate(s.started_at)}</span>
              <span className="w-16 shrink-0 font-mono tabular-nums">{fmtMin(s.minutes)}</span>
              <span className="min-w-0 flex-1 truncate text-fg-2">{s.note}</span>
              <button
                aria-label="Delete this entry"
                onClick={() => write(() => api.del(`/sessions/${s.id}`))}
                className="rounded p-1 text-fg-3 opacity-0 group-hover:opacity-100 hover:bg-surface-2 hover:text-critical focus:opacity-100"
              >
                <X size={13} />
              </button>
            </li>
          ))}
          {ended.length > 4 && (
            <li>
              <button onClick={() => setAll(!all)} className="w-full px-3 py-2 text-left text-[13px] text-fg-2 hover:text-fg">
                {all ? "Show less" : `Show all ${ended.length} entries`}
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
