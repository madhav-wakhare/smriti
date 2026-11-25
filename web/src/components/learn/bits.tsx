/** The few pieces only learning needs: a cover thumbnail, a progress bar, status words and "3 days ago". */
import clsx from "clsx";
import { BookOpen, FileText, Lightbulb, PlayCircle } from "lucide-react";
import { useState } from "react";
import type { SourceKind, SourceStatus } from "../../lib/api";

/** Status in plain words. */
export const STATUS_LABEL: Record<SourceStatus, string> = { queued: "To start", active: "In progress", done: "Done" };

export const KIND_LABEL: Record<SourceKind, string> = { topic: "Topic", article: "Article", book: "Book", video: "Video" };

const KIND_ICON = { topic: Lightbulb, article: FileText, book: BookOpen, video: PlayCircle } as const;

/** The kind's small icon. */
export function KindIcon({ kind, size = 14, className }: { kind: SourceKind; size?: number; className?: string }) {
  const Icon = KIND_ICON[kind];
  return <Icon size={size} className={className} aria-hidden />;
}

/** A rounded picture (book cover, thumbnail), or a soft blank with the kind's icon. */
export function Thumb({ src, kind, className }: { src: string | null; kind: SourceKind; className?: string }) {
  const [broken, setBroken] = useState(false);
  const Icon = KIND_ICON[kind];
  return (
    <span className={clsx("flex shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-2", className)}>
      {src && !broken ? (
        <img src={src} alt="" loading="lazy" onError={() => setBroken(true)} className="size-full object-cover" />
      ) : (
        <Icon size={18} className="text-fg-3" aria-hidden />
      )}
    </span>
  );
}

/** A thin rounded progress bar. */
export function Meter({ value, total, className }: { value: number; total: number | null; className?: string }) {
  const pct = total ? Math.min(100, Math.max(0, (value / total) * 100)) : 0;
  return (
    <span
      role="meter"
      aria-valuemin={0}
      aria-valuemax={total ?? 0}
      aria-valuenow={value}
      aria-label="Progress"
      className={clsx("block h-1.5 overflow-hidden rounded-full bg-surface-3", className)}
    >
      <span className="block h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
    </span>
  );
}

/** A small rounded status pill. */
export function StatusPill({ status }: { status: SourceStatus }) {
  return (
    <span
      className={clsx(
        "inline-flex h-5 items-center rounded-full px-2 text-[11px] font-medium whitespace-nowrap",
        status === "done" ? "bg-accent-soft text-accent" : status === "active" ? "bg-warning/15 text-warning" : "bg-surface-2 text-fg-2",
      )}
    >
      {STATUS_LABEL[status]}
    </span>
  );
}

/** "today", "yesterday", "3 days ago", or "never". */
export function ago(iso: string | null) {
  if (!iso) return "never";
  const d = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
  return d === 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`;
}
