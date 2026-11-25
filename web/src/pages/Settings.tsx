/** Settings: how Smriti looks, your projects, quotes, keyboard shortcuts, and about this install. */
import clsx from "clsx";
import { Check, Plus, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { BlurInput, useWrite } from "../components/common";
import { THEMES, useTheme } from "../components/Layout";
import { QUOTES_KEY } from "../components/QuoteLine";
import { SHORTCUTS } from "../components/Shortcuts";
import { Button, IconButton, Input, Kbd, Modal, PageHeader, Switch, Textarea, useToast } from "../components/ui";
import { api, type Project, type Quote } from "../lib/api";
import { fmtDate } from "../lib/format";
import { useConfig, useLocalState, useObsidian, useProjects, useQuotes } from "../lib/hooks";

export default function Settings() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-3xl space-y-6 px-4 md:px-8">
        <Box title="Appearance" hint="Saved in this browser.">
          <ThemeChooser />
        </Box>
        <Box title="Projects" hint="Tasks are filed under a project. Its short key starts every task key, like WORK-12.">
          <Projects />
        </Box>
        <Box title="Quotes" hint="One shows on Today and changes to a random one every 15 seconds. Hover it to keep it, or click the arrow for another.">
          <Quotes />
        </Box>
        <Box title="Obsidian" hint="Save sources (topics, videos, articles and books) as notes in your Obsidian vault.">
          <Obsidian />
        </Box>
        <Box title="Keyboard shortcuts" hint="Press ? anywhere to see these.">
          <Shortcuts />
        </Box>
        <Box title="About">
          <About />
        </Box>
      </div>
    </>
  );
}

function Box({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface p-5">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {hint && <p className="mt-0.5 text-[13px] text-fg-2">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

function ThemeChooser() {
  const [theme, setTheme] = useTheme();
  return (
    <div role="radiogroup" aria-label="Theme" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {THEMES.map((t) => {
        const on = theme === t.value;
        return (
          <button
            key={t.value}
            role="radio"
            aria-checked={on}
            onClick={() => setTheme(t.value)}
            className={clsx("overflow-hidden rounded-lg border text-left transition-colors", on ? "border-accent ring-1 ring-accent" : "border-line hover:border-line-strong")}
          >
            <span className="block h-16 border-b border-line p-3" style={{ background: t.color }} aria-hidden>
              <span className="block h-1.5 w-1/2 rounded-full" style={{ background: t.accent }} />
              <span className="mt-2 block h-1.5 w-3/4 rounded-full opacity-50" style={{ background: t.accent }} />
            </span>
            <span className="flex items-center justify-between px-3 py-2 text-[13px] font-medium">
              {t.label}
              {on && <Check size={14} className="text-accent" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Projects() {
  const { data: projects } = useProjects();
  const write = useWrite();
  const toast = useToast();
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [confirm, setConfirm] = useState<Project | null>(null);

  const add = async () => {
    const k = key.trim().toUpperCase();
    if (!k || !name.trim()) return;
    const r = await write(() => api.post<Project>("/projects", { key: k, name: name.trim() }), `Added ${name.trim()}`);
    if (r) {
      setKey("");
      setName("");
    }
  };

  const remove = async () => {
    if (!confirm) return;
    const p = confirm;
    setConfirm(null);
    const ok = await write(async () => (await api.del(`/projects/${p.id}`), true));
    if (ok) toast(`Deleted ${p.name}`, "default", { label: "Undo", onClick: () => void write(() => api.post(`/trash/project/${p.id}/restore`)) });
  };

  return (
    <div className="space-y-4">
      {projects?.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {projects.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-16 shrink-0 truncate font-mono text-[12px] text-fg-3">{p.key}</span>
              <BlurInput
                aria-label={`Name of ${p.key}`}
                value={p.name}
                onSave={(n) => n.trim() && write(() => api.patch(`/projects/${p.id}`, { name: n.trim() }))}
                className={clsx("!h-8 min-w-0 flex-1 !border-transparent !bg-transparent !px-1 hover:!border-line focus:!border-accent", p.archived && "text-fg-3")}
              />
              <span className="hidden shrink-0 text-[12px] whitespace-nowrap text-fg-3 sm:block">{p.archived ? "Archived" : `${p.open_count} open`}</span>
              <Button size="sm" variant="ghost" onClick={() => write(() => api.patch(`/projects/${p.id}`, { archived: !p.archived }))}>
                {p.archived ? "Unarchive" : "Archive"}
              </Button>
              <IconButton aria-label={`Delete ${p.name}`} title={`Delete (created ${fmtDate(p.created_at)})`} onClick={() => setConfirm(p)} className="hover:!text-critical">
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px] text-fg-2">No projects yet. Add your first one below.</p>
      )}
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <label className="block min-w-48 flex-1">
          <span className="mb-1.5 block text-[12px] font-medium text-fg-2">Name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Day job" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-[12px] font-medium text-fg-2">Key</span>
          <Input value={key} onChange={(e) => setKey(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} placeholder="WORK" maxLength={10} className="w-28 font-mono" />
        </label>
        <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={!key.trim() || !name.trim()}>
          Add project
        </Button>
      </form>
      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title="Delete project?"
        width="max-w-md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={remove}>
              Delete
            </Button>
          </>
        }
      >
        <p className="text-[14px] text-fg-2">
          {confirm?.name} and its tasks move to the trash, where you can restore them for a while.
          {!!confirm?.open_count && ` ${confirm.open_count} open task${confirm.open_count === 1 ? "" : "s"} will go with it.`}
        </p>
      </Modal>
    </div>
  );
}

function Quotes() {
  const { data: quotes } = useQuotes();
  const [on, setOn] = useLocalState(QUOTES_KEY, true);
  const write = useWrite();
  const toast = useToast();
  const [text, setText] = useState("");
  const [author, setAuthor] = useState("");

  const remove = (q: Quote) =>
    write(() => api.del(`/quotes/${q.id}`)).then(
      (r) =>
        r !== undefined &&
        toast("Quote deleted", "default", { label: "Undo", onClick: () => void write(() => api.post("/quotes", { text: q.text, author: q.author })) }),
    );

  return (
    <div className="space-y-4">
      <label className="flex items-center justify-between gap-4 text-[14px]">
        Show a quote on Today
        <Switch checked={on} onChange={setOn} label="Show a quote on Today" />
      </label>

      {!!quotes?.length && (
        <ul className="divide-y divide-line rounded-lg border border-line">
          {quotes.map((q) => (
            <li key={q.id} className="group flex items-start gap-3 px-3 py-2">
              <div className="min-w-0 flex-1 space-y-1">
                <BlurInput value={q.text} onSave={(v) => v.trim() && write(() => api.patch(`/quotes/${q.id}`, { text: v }))} aria-label="Quote" className="!h-8 !border-transparent !bg-transparent !px-1 hover:!border-line" />
                <BlurInput value={q.author} onSave={(v) => write(() => api.patch(`/quotes/${q.id}`, { author: v }))} aria-label="Author" placeholder="Author" className="!h-7 !border-transparent !bg-transparent !px-1 text-[13px] text-fg-2 hover:!border-line" />
              </div>
              <IconButton aria-label="Delete quote" title="Delete" onClick={() => remove(q)} className="opacity-0 group-hover:opacity-100 focus:opacity-100">
                <Trash2 size={14} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!text.trim()) return;
          write(() => api.post("/quotes", { text, author }), "Quote added").then((r) => {
            if (r === undefined) return;
            setText("");
            setAuthor("");
          });
        }}
      >
        <Textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="A line worth keeping" aria-label="New quote" className="!min-h-16" />
        <div className="flex gap-2">
          <Input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Who said it (optional)" aria-label="Author" className="flex-1" />
          <Button type="submit" variant="primary" icon={<Plus size={14} />} disabled={!text.trim()}>
            Add quote
          </Button>
        </div>
      </form>
    </div>
  );
}

function Obsidian() {
  const { data: v } = useObsidian();
  if (!v) return null;
  if (!v.mounted)
    return (
      <div className="space-y-2 text-[14px] text-fg-2">
        <p>No vault is connected. To connect one, add its full path to <code className="font-mono text-[13px] text-fg">.env</code> and restart:</p>
        <pre className="overflow-x-auto rounded-lg border border-line bg-surface-2/50 px-3 py-2 font-mono text-[13px] text-fg">
          SMRITI_VAULT_PATH=/Users/you/Documents/MyVault{"\n"}make restart
        </pre>
        <p>Then each source shows the Obsidian gem: in its window, and on its card in Learn when you hover.</p>
      </div>
    );
  const row = (label: string, value: ReactNode) => (
    <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2">
      <span className="text-fg-2">{label}</span>
      <span className="text-right font-mono text-[13px] break-all">{value}</span>
    </div>
  );
  return (
    <div className="space-y-3">
      <div className="divide-y divide-line rounded-lg border border-line px-3 text-[14px]">
        {row("Vault", v.vault_path || v.vault_dir)}
        {row("Status", v.writable ? (v.is_obsidian_vault ? "Connected" : "Connected (a folder inside your vault)") : "Read-only, so notes can't be written")}
        {row("Topics, videos and books go to", v.folder)}
        {row("Articles go to", v.articles_folder)}
        {row("Saving", v.auto ? "Automatic: every source you add or edit is saved" : "Only when you press the gem")}
      </div>
      <p className="text-[13px] text-fg-3">
        Change these in <code className="font-mono">.env</code> (SMRITI_VAULT_PATH, SMRITI_OBSIDIAN_FOLDER, SMRITI_OBSIDIAN_ARTICLES_FOLDER,
        SMRITI_OBSIDIAN_AUTO) and run make restart. A note keeps the folder it was first written to, except that an article moves into its first collection's folder.
      </p>
    </div>
  );
}

function Shortcuts() {
  return (
    <div className="grid gap-5 sm:grid-cols-3">
      {SHORTCUTS.map((g) => (
        <div key={g.group}>
          <p className="mb-2 text-[12px] font-medium text-fg-2">{g.group}</p>
          <ul className="space-y-1.5 text-[13px]">
            {g.items.map(([label, keys]) => (
              <li key={label} className="flex items-center justify-between gap-2">
                <span>{label}</span>
                <span className="flex shrink-0 gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function About() {
  const { data: c } = useConfig();
  const row = (k: string, v: ReactNode) => (
    <div className="flex justify-between gap-4 py-2">
      <dt className="text-fg-2">{k}</dt>
      <dd className="text-right">{v ?? <span className="text-fg-3">…</span>}</dd>
    </div>
  );
  return (
    <div className="space-y-4 text-[14px]">
      <dl className="divide-y divide-line">
        {row("Version", c && <span className="font-mono">{c.version}</span>)}
        {row("Time zone", c?.tz)}
        {row("Today", c && fmtDate(c.today, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}
        {row("Trash is kept for", c && `${c.trash_days} days`)}
      </dl>
      <p className="text-[13px] leading-relaxed text-fg-2">
        All your data lives in one SQLite file on the server, so backing up that file backs up everything (<code className="font-mono text-fg">make backup</code>). Server
        settings such as the time zone come from environment variables, so nothing on this page changes the server.
      </p>
    </div>
  );
}
