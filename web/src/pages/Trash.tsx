/** Trash: what you deleted, kept for a while so you can bring it back. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useWrite } from "../components/common";
import { Button, Modal, PageHeader } from "../components/ui";
import { api, type TrashEntry } from "../lib/api";
import { daysSince, fmtDate } from "../lib/format";
import { useConfig } from "../lib/hooks";

const KIND: Record<TrashEntry["kind"], string> = { task: "Task", source: "Source", revisit: "Revisit", capture: "Capture", project: "Project" };

export default function Trash() {
  const { data: config } = useConfig();
  const { data: entries, isLoading } = useQuery({ queryKey: ["trash"], queryFn: () => api.get<TrashEntry[]>("/trash") });
  const [confirm, setConfirm] = useState<TrashEntry | null>(null);
  const write = useWrite();
  const days = config?.trash_days ?? 30;

  const purge = async () => {
    if (!confirm) return;
    const e = confirm;
    setConfirm(null);
    await write(() => api.del(`/trash/${e.kind}/${e.id}`), "Deleted for good");
  };

  return (
    <>
      <PageHeader title="Trash" lede={`Deleted things stay here for ${days} days, then they are removed for good.`} />
      <div className="max-w-3xl px-4 md:px-8">
        {isLoading ? (
          <p className="py-10 text-[13px] text-fg-3">Loading…</p>
        ) : !entries?.length ? (
          <p className="rounded-xl border border-line bg-surface py-12 text-center text-[14px] text-fg-2">The trash is empty.</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {entries.map((e) => {
              const left = Math.max(0, days - daysSince(e.deleted_at));
              return (
                <li key={`${e.kind}-${e.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px]" title={e.title}>
                      {e.title}
                    </p>
                    <p className="text-[12px] text-fg-3">
                      {KIND[e.kind] ?? e.kind} · deleted {fmtDate(e.deleted_at)} ·{" "}
                      <span className={left <= 3 ? "text-critical" : undefined}>
                        {left === 0 ? "goes today" : `${left} day${left === 1 ? "" : "s"} left`}
                      </span>
                    </p>
                  </div>
                  <div className="flex gap-1.5">
                    <Button size="sm" onClick={() => write(() => api.post(`/trash/${e.kind}/${e.id}/restore`), `Restored “${e.title}”`)}>
                      Restore
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirm(e)} className="hover:!text-critical">
                      Delete forever
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete forever?"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={purge}>
              Delete forever
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-fg-2">
          “{confirm?.title}” will be gone for good. This cannot be undone.
          {confirm?.kind === "project" && " Its tasks go with it."}
        </p>
      </Modal>
    </>
  );
}
