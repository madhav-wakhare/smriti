/**
 * Revisit: things you want to keep fresh. A plain list, the ones you have not looked at longest
 * first. Add one from the box at the top; click one to open it and write in it. ?item=ID opens one.
 */
import clsx from "clsx";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Ascii } from "../components/Ascii";
import { useWrite } from "../components/common";
import { RevisitWindow } from "../components/RevisitWindow";
import { ago } from "../components/learn/bits";
import { PageHeader, Tabs } from "../components/ui";
import { api, type Revisit as Item } from "../lib/api";
import { PriorityMark } from "../lib/format";
import { useRevisits } from "../lib/hooks";

type Status = "active" | "retired";

const byOldestReview = (a: Item, b: Item) => {
  if (!a.reviewed_at && !b.reviewed_at) return b.priority - a.priority || a.created_at.localeCompare(b.created_at);
  if (!a.reviewed_at) return -1;
  if (!b.reviewed_at) return 1;
  return a.reviewed_at.localeCompare(b.reviewed_at);
};

export default function Revisit() {
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState<Status>("active");
  const { data: active } = useRevisits("active");
  const { data: retired } = useRevisits("retired");
  const list = useMemo(() => [...((status === "active" ? active : retired) ?? [])].sort(byOldestReview), [status, active, retired]);
  const openId = Number(params.get("item")) || null;

  const open = (id: number | null) =>
    setParams((p) => {
      if (id) p.set("item", String(id));
      else p.delete("item");
      return p;
    });

  return (
    <>
      <PageHeader title="Revisit" lede="Things you want to keep fresh. Open one to read it again or add to it." />
      <div className="max-w-3xl space-y-4 px-4 md:px-8">
        <QuickAdd onAdded={open} />

        <Tabs<Status>
          value={status}
          onChange={setStatus}
          tabs={[
            { value: "active", label: `Active ${active?.length ?? ""}` },
            { value: "retired", label: `Retired ${retired?.length ?? ""}` },
          ]}
        />

        {list.length ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {list.map((c) => (
              <li key={c.id}>
                <button onClick={() => open(c.id)} className="flex w-full items-center gap-4 px-4 py-3 text-left hover:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{c.title}</span>
                    {(c.prompt || c.body) && <span className="block truncate text-[13px] text-fg-2">{c.prompt || c.body}</span>}
                  </span>
                  <PriorityMark value={c.priority} />
                  <span className={clsx("w-28 shrink-0 text-right text-[12px]", c.reviewed_at ? "text-fg-3" : "text-fg-2")}>
                    {c.reviewed_at ? `Seen ${ago(c.reviewed_at)}` : "Not seen yet"}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-line bg-surface py-10 text-center">
            <Ascii name="scope" />
            <p className="mt-3 text-[14px] text-fg-2">{status === "active" ? "Nothing to revisit yet. Add something above." : "Nothing retired."}</p>
          </div>
        )}
      </div>
      <RevisitWindow id={openId} onClose={() => open(null)} />
    </>
  );
}

/** One line: type what you want to revisit, press Enter. It opens so you can add notes. */
function QuickAdd({ onAdded }: { onAdded: (id: number) => void }) {
  const write = useWrite();
  const [title, setTitle] = useState("");
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const t = title.trim();
        if (t)
          write(() => api.post<Item>("/revisits", { title: t })).then((r) => {
            if (!r) return;
            setTitle("");
            onAdded(r.id);
          });
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Something to revisit, then Enter"
        aria-label="Add something to revisit"
        className="h-11 w-full rounded-xl border border-line-strong bg-surface px-4 text-[14px] outline-none placeholder:text-fg-3 focus:border-accent"
      />
    </form>
  );
}
