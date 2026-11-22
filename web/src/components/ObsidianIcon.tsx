import { useState } from "react";
import { api, type Source } from "../lib/api";
import { useObsidian } from "../lib/hooks";
import { useWrite } from "./common";

/** A gem glyph in Lucide's stroke style for "save to Obsidian", the same mark Arc used. */
export function ObsidianIcon({ size = 14, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M9.5 2.5 5 9l2 9.5 5 3 4.5-4L19 9l-4-6.5z" />
      <path d="M9.5 2.5 12 10l3-7.5M12 10l-7 -1M12 10l7-1M12 10l-5 8.5M12 10l4.5 7.5" />
    </svg>
  );
}

/** The export action, shared by the source window and the Learn cards. */
export function useObsidianExport(source: Pick<Source, "id" | "obsidian_path">) {
  const { data: vault } = useObsidian();
  const write = useWrite();
  const [busy, setBusy] = useState(false);
  const saved = !!source.obsidian_path;
  return {
    available: !!vault?.writable,
    saved,
    busy,
    label: saved ? "Update the note in Obsidian" : "Save to Obsidian",
    run: () => {
      setBusy(true);
      return write(() => api.post(`/sources/${source.id}/obsidian`), saved ? "Note updated in Obsidian" : "Saved to Obsidian").finally(() => setBusy(false));
    },
  };
}
