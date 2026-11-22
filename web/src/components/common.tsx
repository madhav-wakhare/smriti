/** Small pieces shared across pages: writes with refresh, fields that save on blur, dates, the timer button. */
import clsx from "clsx";
import { Play, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";
import { api, type Task } from "../lib/api";
import { clock, localIso } from "../lib/format";
import { useConfig, useNow, useRefresh, useRunning } from "../lib/hooks";
import { Input, Textarea, useToast } from "./ui";

export const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Runs a write, refreshes every query, and toasts an error. Resolves to the result or undefined. */
export function useWrite() {
  const refresh = useRefresh();
  const toast = useToast();
  return useCallback(
    async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
      try {
        const r = await fn();
        refresh();
        if (ok) toast(ok);
        return r;
      } catch (e) {
        toast(errText(e), "error");
        return undefined;
      }
    },
    [refresh, toast],
  );
}

/** Today's date in the server's time zone (falls back to the browser's). */
export function useTodayDate() {
  const { data } = useConfig();
  return data?.today ?? localIso();
}

/** Adds days to a YYYY-MM-DD date. */
export function addDays(date: string, n: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return localIso(d);
}

/** The Monday of the week holding this date. */
export function mondayOf(date: string) {
  const d = new Date(`${date}T00:00:00`);
  return addDays(date, -((d.getDay() + 6) % 7));
}

export const patchTask = (id: number, body: Partial<Task>) => api.patch<Task>(`/tasks/${id}`, body);

/** Start or stop a session on a task. Shows the running clock when it is this task's. */
export function TimerButton({ taskId, compact }: { taskId: number; compact?: boolean }) {
  const { data: running } = useRunning();
  const now = useNow();
  const write = useWrite();
  const mine = running?.subject.kind === "task" && running.subject.id === taskId;
  const secs = mine ? Math.max(0, Math.floor((now - new Date(running.started_at).getTime()) / 1000)) : 0;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        write(() => (mine ? api.post("/sessions/stop") : api.post("/sessions/start", { task_id: taskId })));
      }}
      aria-label={mine ? "Stop session" : "Start session"}
      title={mine ? "Stop session" : "Start session"}
      className={clsx(
        "inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md border font-mono text-[12px] tabular-nums transition-colors active:translate-y-px",
        compact ? "w-7" : "min-w-7 px-1.5",
        mine ? "border-accent bg-accent text-accent-fg hover:bg-transparent hover:text-accent" : "border-transparent text-fg-3 hover:border-line hover:bg-surface-2 hover:text-fg",
      )}
    >
      {mine ? <Square size={10} fill="currentColor" /> : <Play size={11} />}
      {mine && !compact && <span>{clock(secs)}</span>}
    </button>
  );
}

/** Keeps a local draft of a server value; the draft follows the server while the field is not focused. */
function useDraft(value: string) {
  const [draft, setDraft] = useState(value);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(value);
  }, [value]);
  return { draft, setDraft, focused };
}

/** A text input that saves on blur (and on Enter) when changed. */
export function BlurInput({
  value,
  onSave,
  className,
  ...rest
}: { value: string; onSave: (v: string) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "onBlur">) {
  const { draft, setDraft, focused } = useDraft(value);
  return (
    <Input
      {...rest}
      className={className}
      value={draft}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setDraft(value);
          e.stopPropagation();
          setTimeout(() => (document.activeElement as HTMLElement | null)?.blur());
        }
      }}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onSave(draft);
      }}
    />
  );
}

/** A textarea that saves on blur when changed. */
export function BlurTextarea({
  value,
  onSave,
  ...rest
}: { value: string; onSave: (v: string) => void } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange" | "onBlur">) {
  const { draft, setDraft, focused } = useDraft(value);
  return (
    <Textarea
      {...rest}
      value={draft}
      onFocus={() => (focused.current = true)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        focused.current = false;
        if (draft !== value) onSave(draft);
      }}
    />
  );
}

/** Splits "a, b c" into lowercase tags. */
export const parseTags = (s: string) =>
  Array.from(new Set(s.split(/[,\s]+/).map((t) => t.trim().toLowerCase().replace(/^#/, "")).filter(Boolean)));

/** A ruled table head cell. */
export function Th({ children, className }: { children?: ReactNode; className?: string }) {
  return <th className={clsx("h-9 border-b border-line px-3 text-left text-[12px] font-medium text-fg-2 whitespace-nowrap", className)}>{children}</th>;
}
