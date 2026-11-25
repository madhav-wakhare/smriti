/**
 * Collections on Learn: a sidebar of named groups (AI, SRE, Databases...) to keep sources organised,
 * as in Arc. Pick one to see only its sources; drag a card onto one to file it there; rename or delete
 * from the row's menu. A source can sit in several collections.
 */
import clsx from "clsx";
import { Check, FolderPlus, MoreHorizontal, Plus, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { api, type Collection, type Source } from "../../lib/api";
import { useCollections } from "../../lib/hooks";
import { useWrite } from "../common";
import { Button, Input, Menu, Modal } from "../ui";

export const DRAG_TYPE = "application/x-smriti-source";

export function CollectionsSidebar({
  selected,
  onSelect,
  total,
}: {
  selected: number | null;
  onSelect: (id: number | null) => void;
  total: number;
}) {
  const { data: collections } = useCollections();
  const write = useWrite();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [renaming, setRenaming] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Collection | null>(null);

  const create = () => {
    const n = name.trim();
    if (!n) return setAdding(false);
    write(() => api.post<Collection>("/collections", { name: n }), `Collection ${n} added`).then((c) => {
      if (!c) return;
      setName("");
      setAdding(false);
      onSelect(c.id);
    });
  };

  return (
    <nav aria-label="Collections" className="space-y-1">
      <p className="px-2 pb-1 text-[12px] font-medium text-fg-2">Collections</p>
      <Row active={selected === null} onClick={() => onSelect(null)} label="All sources" count={total} />
      {collections?.map((c) =>
        renaming === c.id ? (
          <RenameRow key={c.id} c={c} done={() => setRenaming(null)} />
        ) : (
          <Row
            key={c.id}
            active={selected === c.id}
            onClick={() => onSelect(c.id)}
            label={c.name}
            count={c.count}
            onDrop={(sourceId) => write(() => api.post(`/collections/${c.id}/sources`, { source_id: sourceId }), `Added to ${c.name}`)}
            menu={
              <Menu
                trigger={
                  <span role="button" aria-label={`More for ${c.name}`} className="flex size-6 items-center justify-center rounded text-fg-3 opacity-0 group-hover:opacity-100 hover:bg-surface-3 hover:text-fg focus:opacity-100">
                    <MoreHorizontal size={14} />
                  </span>
                }
                items={[
                  { label: "Rename", onClick: () => setRenaming(c.id) },
                  { label: "Delete", danger: true, onClick: () => setDeleting(c) },
                ]}
              />
            }
          />
        ),
      )}
      {adding ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={create} placeholder="Name, then Enter" aria-label="New collection name" className="!h-8" />
        </form>
      ) : (
        <button onClick={() => setAdding(true)} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] text-fg-2 hover:bg-surface-2 hover:text-fg">
          <FolderPlus size={14} /> New collection
        </button>
      )}
      {!!collections?.length && <p className="px-2 pt-2 text-[12px] text-fg-3">Drag a card onto a collection to add it.</p>}
      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                const c = deleting!;
                setDeleting(null);
                if (selected === c.id) onSelect(null);
                write(() => api.del(`/collections/${c.id}`), `Collection ${c.name} deleted`);
              }}
            >
              Delete collection
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-fg-2">The {deleting?.count ?? 0} sources in it stay in Learn; only the collection goes.</p>
      </Modal>
    </nav>
  );
}

function Row({
  active,
  onClick,
  label,
  count,
  onDrop,
  menu,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  onDrop?: (sourceId: number) => void;
  menu?: ReactNode;
}) {
  const [over, setOver] = useState(false);
  return (
    <div
      className={clsx(
        "group flex items-center gap-1 rounded-md pr-1 transition-colors",
        active ? "bg-surface-2 text-fg shadow-[inset_2px_0_0_var(--accent)]" : "text-fg-2 hover:bg-surface-2 hover:text-fg",
        over && "ring-2 ring-accent",
      )}
      onDragOver={(e) => {
        if (!onDrop || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        setOver(false);
        const id = Number(e.dataTransfer.getData(DRAG_TYPE));
        if (onDrop && id) {
          e.preventDefault();
          onDrop(id);
        }
      }}
    >
      <button onClick={onClick} className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px]" aria-current={active || undefined}>
        <span className="min-w-0 flex-1 truncate">{label}</span>
        <span className={clsx("font-mono text-[11px] tabular-nums", active ? "opacity-80" : "text-fg-3")}>{count}</span>
      </button>
      {menu}
    </div>
  );
}

function RenameRow({ c, done }: { c: Collection; done: () => void }) {
  const write = useWrite();
  const [name, setName] = useState(c.name);
  const save = () => {
    const n = name.trim();
    if (n && n !== c.name) write(() => api.patch(`/collections/${c.id}`, { name: n }));
    done();
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={save} onKeyDown={(e) => e.key === "Escape" && done()} aria-label={`Rename ${c.name}`} className="!h-8" />
    </form>
  );
}

/** In a source's window: its collections as chips, with remove, and a menu to add one or make a new one. */
export function SourceCollections({ source }: { source: Pick<Source, "id" | "collections"> }) {
  const { data: all } = useCollections();
  const write = useWrite();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const mine = new Set(source.collections.map((c) => c.id));
  const setIds = (ids: number[]) => write(() => api.patch(`/sources/${source.id}`, { collection_ids: ids }));
  const create = () => {
    const n = name.trim();
    setCreating(false);
    setName("");
    if (n)
      write(() => api.post<Collection>("/collections", { name: n })).then((c) => c && setIds([...mine, c.id]));
  };
  return (
    <div className="space-y-2">
      {source.collections.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {source.collections.map((c) => (
            <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-2 py-0.5 pr-1 pl-2.5 text-[12px]">
              {c.name}
              <button aria-label={`Remove from ${c.name}`} onClick={() => setIds([...mine].filter((id) => id !== c.id))} className="rounded-full p-0.5 text-fg-3 hover:text-fg">
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      {creating ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            create();
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={create} placeholder="New collection name" aria-label="New collection name" className="!h-8" />
        </form>
      ) : (
        <Menu
          block
          trigger={
            <Button size="sm" variant="ghost" className="w-full justify-start" icon={<Plus size={13} />}>
              Add to a collection
            </Button>
          }
          items={[
            ...(all ?? []).map((c) => ({
              label: (
                <span className="flex w-full items-center justify-between gap-2">
                  {c.name}
                  {mine.has(c.id) && <Check size={13} className="text-accent" />}
                </span>
              ),
              onClick: () => setIds(mine.has(c.id) ? [...mine].filter((id) => id !== c.id) : [...mine, c.id]),
            })),
            { label: "New collection…", icon: <FolderPlus size={13} />, onClick: () => setCreating(true) },
          ]}
        />
      )}
    </div>
  );
}
