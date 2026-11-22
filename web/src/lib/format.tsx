/** Formatting and the small labelled pieces every page uses (priority, status, kind, key). */
import clsx from "clsx";
import type { ReactNode } from "react";
import type { Priority, SourceKind, SourceStatus, TaskStatus } from "./api";

/**
 * A typed duration, as in Arc and Jira: "1h 30m", "1h30m", "45m", "2.5h", "1d" (8h), "1w" (5d), or "1:30".
 * A bare number is minutes. Returns minutes, null for empty text, NaN when it cannot be read.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase();
  if (!t) return null;
  if (/^\d+$/.test(t)) return Number(t);
  const clock = /^(\d+):([0-5]\d)$/.exec(t);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const units: Record<string, number> = { w: 2400, d: 480, h: 60, m: 1 };
  let total = 0;
  const rest = t.replace(/(\d+(?:\.\d+)?)\s*(w|d|h|m)(?:[a-z]*)/g, (_, n: string, u: string) => {
    total += Number(n) * units[u];
    return "";
  });
  return rest.trim() || total <= 0 ? NaN : Math.round(total);
}

export function fmtMin(min: number | null | undefined) {
  const m = Math.max(0, Math.round(min ?? 0));
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return m % 60 ? `${h}h ${m % 60}m` : `${h}h`;
}

/** "Oct 12" or "Oct 12, 2025" when not this year. Plain YYYY-MM-DD dates are read as local dates. */
export function fmtDate(iso: string | null | undefined, opts?: Intl.DateTimeFormatOptions) {
  if (!iso) return "";
  const d = iso.length === 10 ? new Date(`${iso}T00:00:00`) : new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, opts ?? { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

export function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

/** Whole days since a timestamp. */
export function daysSince(iso: string) {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

/** "4:05" or "1:04:05" for a running clock. */
export function clock(secs: number) {
  const h = Math.floor(secs / 3600);
  const m = String(Math.floor((secs % 3600) / 60)).padStart(h ? 2 : 1, "0");
  const s = String(secs % 60).padStart(2, "0");
  return h ? `${h}:${m}:${s}` : `${m}:${s}`;
}

export function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Priority in words. "None" draws nothing, so only what matters stands out. */
export const PRIORITY: { value: Priority; label: string; tone: string }[] = [
  { value: 0, label: "None", tone: "" },
  { value: 1, label: "Low", tone: "border-line text-fg-2" },
  { value: 2, label: "Medium", tone: "border-warning/50 text-warning" },
  { value: 3, label: "High", tone: "border-serious/60 text-serious" },
  { value: 4, label: "Urgent", tone: "border-critical/60 bg-critical/10 text-critical" },
];

export const TASK_STATUS: { value: TaskStatus; label: string }[] = [
  { value: "todo", label: "To do" },
  { value: "doing", label: "Doing" },
  { value: "done", label: "Done" },
];

export const SOURCE_KIND: { value: SourceKind; label: string; tag: string }[] = [
  { value: "topic", label: "Topic", tag: "TP" },
  { value: "article", label: "Article", tag: "AR" },
  { value: "book", label: "Book", tag: "BK" },
  { value: "video", label: "Video", tag: "VD" },
];

export const SOURCE_STATUS: { value: SourceStatus; label: string }[] = [
  { value: "queued", label: "To start" },
  { value: "active", label: "In progress" },
  { value: "done", label: "Done" },
];

/** Priority as a small word pill: Low, Medium, High, Urgent. Nothing for None. */
export function PriorityMark({ value, className }: { value: Priority; className?: string }) {
  if (!value) return null;
  const p = PRIORITY[value];
  return (
    <span className={clsx("inline-flex h-5 items-center rounded border px-1.5 text-[11px] font-medium whitespace-nowrap", p.tone, className)}>
      {p.label}
    </span>
  );
}

/** A small tag: a key, a kind, a status. */
export function Tag({ children, tone, className }: { children: ReactNode; tone?: "warn" | "crit" | "good"; className?: string }) {
  return (
    <span
      className={clsx(
        "t-tag",
        tone === "warn" && "!border-warning/60 !text-warning",
        tone === "crit" && "!border-critical/60 !text-critical",
        tone === "good" && "!border-good/60 !text-good",
        className,
      )}
    >
      {children}
    </span>
  );
}

/** Days an open thing has waited, toned at 14 / 30 days. */
export function AgeTag({ since }: { since: string }) {
  const d = daysSince(since);
  return <Tag tone={d >= 30 ? "crit" : d >= 14 ? "warn" : undefined}>{d}d</Tag>;
}
