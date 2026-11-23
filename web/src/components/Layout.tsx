/**
 * The shell: one bar across the top with the mark, the page tabs, the running timer, search, New
 * and a settings menu; the page below it; and the panels and dialogs every page can open. Drawers are addressed in the URL
 * (?task=12, ?source=4), so a link or the back button reaches them.
 */
import clsx from "clsx";
import { CheckSquare, Inbox, Library, Lightbulb, Palette, Plus, Search, Settings, Square, Trash2 } from "lucide-react";
import { Suspense, createContext, useContext, useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { NavLink, Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api } from "../lib/api";
import { clock } from "../lib/format";
import { SMRITI_GLYPH } from "../lib/glyph";
import { useCaptures, useNow, useRefresh, useRunning } from "../lib/hooks";
import { Button, IconButton, Kbd, Menu as UiMenu } from "./ui";
import { CaptureModal, RevisitModal, NewSourceModal, NewTaskModal, type NewTaskDefaults } from "./Create";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsModal, GO_TO } from "./Shortcuts";
import { SourceDrawer } from "./SourceDrawer";
import { TaskDrawer } from "./TaskDrawer";

// ---------------------------------------------------------------- actions every page can call

type Actions = {
  openTask: (id: number) => void;
  openSource: (id: number) => void;
  newTask: (defaults?: NewTaskDefaults) => void;
  newSource: () => void;
  newRevisit: () => void;
  capture: () => void;
  search: () => void;
};
const ActionsCtx = createContext<Actions | null>(null);
export function useActions() {
  const a = useContext(ActionsCtx);
  if (!a) throw new Error("useActions outside Layout");
  return a;
}

// ---------------------------------------------------------------- theme (one store for the app)

export type Theme = "black" | "terminal" | "white";
export const THEMES: { value: Theme; label: string; color: string; accent: string }[] = [
  { value: "black", label: "Black", color: "#000000", accent: "#ffffff" },
  { value: "terminal", label: "Terminal", color: "#0d180a", accent: "#7fee64" },
  { value: "white", label: "White", color: "#ffffff", accent: "#23860f" },
];
const themeListeners = new Set<() => void>();
const readTheme = (): Theme => {
  const t = document.documentElement.dataset.theme;
  return THEMES.some((x) => x.value === t) ? (t as Theme) : "terminal";
};
function writeTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", THEMES.find((t) => t.value === theme)!.color);
  try {
    localStorage.setItem("smriti-theme", theme);
  } catch {
    /* storage blocked */
  }
  themeListeners.forEach((l) => l());
}
export function useTheme() {
  const theme = useSyncExternalStore((l) => (themeListeners.add(l), () => void themeListeners.delete(l)), readTheme);
  return [theme, writeTheme] as const;
}

export function ThemeSwitch() {
  const [theme, setTheme] = useTheme();
  return (
    <div className="flex items-center gap-4 text-[12px]" role="radiogroup" aria-label="Theme">
      {THEMES.map((t) => (
        <button
          key={t.value}
          role="radio"
          aria-checked={theme === t.value}
          onClick={() => setTheme(t.value)}
          className={clsx("relative py-1 transition-colors", theme === t.value ? "text-fg" : "text-fg-3 hover:text-fg-2")}
        >
          {t.label}
          <span className={clsx("absolute inset-x-0 -bottom-px h-px bg-accent transition-transform duration-200", theme === t.value ? "scale-x-100" : "scale-x-0")} />
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- pieces of the shell

/** Smriti's mark: स्मृ, the first sound of स्मृति (memory), with the name beside it. */
export function Mark({ word = true }: { word?: boolean }) {
  return (
    <span className="mark flex items-center gap-2">
      <svg viewBox="0 0 64 64" className="size-8 shrink-0" aria-hidden>
        {/* Shifted so स्म sits on the same baseline as "smriti" (its headline then meets the top of the "t");
            the vowel sign ृ hangs below, as Devanagari does. The favicon keeps the centred glyph. */}
        <g transform="translate(0 6.4)">
          <path className="mark-glyph" d={SMRITI_GLYPH} fill="var(--accent)" />
        </g>
      </svg>
      {word && <span className="text-[20px] font-medium tracking-tight text-fg">smriti</span>}
    </span>
  );
}

function NewMenu({ trigger }: { trigger: ReactNode }) {
  const a = useActions();
  const row = (label: string, kbd?: string) => (
    <span className="flex w-full items-center justify-between gap-3">
      {label}
      {kbd && <Kbd>{kbd}</Kbd>}
    </span>
  );
  return (
    <UiMenu
      trigger={trigger}
      items={[
        { label: row("Task", "C"), icon: <CheckSquare size={14} className="text-task" />, onClick: () => a.newTask() },
        { label: row("Source", "S"), icon: <Library size={14} className="text-learning" />, onClick: a.newSource },
        { label: row("Revisit", "R"), icon: <Lightbulb size={14} className="text-fg-2" />, onClick: a.newRevisit },
        { label: row("Capture", "N"), icon: <Inbox size={14} className="text-accent" />, onClick: a.capture },
      ]}
    />
  );
}

/** The running timer as a chip in the top bar: what is running, the clock, and Stop. */
function RunningChip() {
  const { data: running } = useRunning();
  const now = useNow();
  const refresh = useRefresh();
  const a = useActions();
  const stop = useMutation({ mutationFn: () => api.post("/sessions/stop"), onSuccess: refresh });
  if (!running) return null;
  const secs = Math.max(0, Math.floor((now - new Date(running.started_at).getTime()) / 1000));
  const open = () =>
    running.subject.kind === "task" ? a.openTask(running.subject.id) : running.subject.kind === "source" ? a.openSource(running.subject.id) : undefined;
  return (
    <div className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-accent/50 bg-accent-soft pl-2.5 text-[13px]">
      <span className="dot inline-block size-2 shrink-0 animate-pulse bg-accent" />
      <button onClick={open} className="hidden max-w-[220px] truncate text-left text-fg hover:underline lg:block" title={running.subject.label}>
        {running.subject.label}
      </button>
      <span className="font-mono tabular-nums text-fg">{clock(secs)}</span>
      <button
        onClick={() => stop.mutate()}
        className="flex h-full items-center gap-1.5 rounded-r-md border-l border-accent/40 px-2.5 text-fg-2 hover:bg-accent hover:text-accent-fg"
        title="Stop and log the time"
      >
        <Square size={10} fill="currentColor" /> Stop
      </button>
    </div>
  );
}

const TABS = [
  { to: "/", label: "Today", end: true },
  { to: "/tasks", label: "Tasks" },
  { to: "/learn", label: "Learn" },
  { to: "/inbox", label: "Inbox", count: "captures" as const },
  { to: "/revisit", label: "Revisit" },
  { to: "/report", label: "Report" },
];

/** The page tabs, like a website's main menu. They scroll sideways on a phone. */
function Tabs() {
  const { data: captures } = useCaptures("open");
  return (
    <nav aria-label="Pages" className="-mb-px flex min-w-0 items-stretch gap-1 overflow-x-auto">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            clsx(
              "flex shrink-0 items-center gap-1.5 border-b-2 px-3 text-[14px] font-medium transition-colors",
              isActive ? "border-accent text-fg" : "border-transparent text-fg-2 hover:text-fg",
            )
          }
        >
          {t.label}
          {t.count && !!captures?.length && (
            <span className="rounded-full bg-accent px-1.5 font-mono text-[11px] leading-[18px] text-accent-fg">{captures.length}</span>
          )}
        </NavLink>
      ))}
    </nav>
  );
}

function SettingsMenu() {
  const navigate = useNavigate();
  const [theme, setTheme] = useTheme();
  const next = THEMES[(THEMES.findIndex((t) => t.value === theme) + 1) % THEMES.length];
  return (
    <UiMenu
      trigger={
        <IconButton aria-label="Settings and more" title="Settings and more">
          <Settings size={17} />
        </IconButton>
      }
      items={[
        { label: "Settings", icon: <Settings size={14} />, onClick: () => navigate("/settings") },
        { label: "Trash", icon: <Trash2 size={14} />, onClick: () => navigate("/trash") },
        { label: `Theme: ${next.label}`, icon: <Palette size={14} />, onClick: () => setTheme(next.value) },
      ]}
    />
  );
}

function TopBar() {
  const a = useActions();
  const isMac = navigator.platform.toLowerCase().includes("mac");
  return (
    <header className="shrink-0 border-b border-line bg-bg">
      <div className="mx-auto flex h-14 max-w-[1400px] items-stretch gap-4 px-4 md:px-8">
        <NavLink to="/" title="Today" className="mark-link flex shrink-0 items-center">
          <Mark />
        </NavLink>
        <div className="hidden min-w-0 flex-1 md:flex">
          <Tabs />
        </div>
        <div className="flex-1 md:hidden" />
        <div className="flex shrink-0 items-center gap-2">
          <RunningChip />
          <button
            onClick={a.search}
            className="hidden h-8 items-center gap-2 rounded-md border border-line px-2.5 text-[13px] text-fg-3 transition-colors hover:border-line-strong hover:text-fg lg:flex"
          >
            <Search size={14} />
            Search
            <Kbd>{isMac ? "⌘K" : "Ctrl K"}</Kbd>
          </button>
          <IconButton onClick={a.search} aria-label="Search" className="lg:hidden">
            <Search size={17} />
          </IconButton>
          <NewMenu
            trigger={
              <Button variant="primary" icon={<Plus size={15} />}>
                New
              </Button>
            }
          />
          <SettingsMenu />
        </div>
      </div>
      <div className="flex h-11 items-stretch border-t border-line px-2 md:hidden">
        <Tabs />
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- the layout

export function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [newTask, setNewTask] = useState<NewTaskDefaults | null>(null);
  const [newSource, setNewSource] = useState(false);
  const [newRevisit, setNewRevisit] = useState(false);
  const [capture, setCapture] = useState(false);

  const setParam = (key: string, value: string | null) =>
    setParams((p) => {
      ["task", "source"].forEach((k) => p.delete(k));
      if (value) p.set(key, value);
      return p;
    });

  const actions: Actions = {
    openTask: (id) => setParam("task", String(id)),
    openSource: (id) => setParam("source", String(id)),
    newTask: (d = {}) => setNewTask(d),
    newSource: () => setNewSource(true),
    newRevisit: () => setNewRevisit(true),
    capture: () => setCapture(true),
    search: () => setSearchOpen(true),
  };

  useEffect(() => {
    let gAt = 0; // when G was pressed; the next key within a second picks a page
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName);
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (Date.now() - gAt < 1000 && GO_TO[key]) {
        e.preventDefault();
        gAt = 0;
        navigate(GO_TO[key].to);
        return;
      }
      if (key === "g") gAt = Date.now();
      else if (e.key === "?") setShortcutsOpen((v) => !v);
      else if (key === "c") setNewTask({});
      else if (key === "s") setNewSource(true);
      else if (key === "r") setNewRevisit(true);
      else if (key === "n") setCapture(true);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  const taskId = Number(params.get("task")) || null;
  const sourceId = Number(params.get("source")) || null;

  return (
    <ActionsCtx.Provider value={actions}>
      <div className="flex h-full flex-col">
        <TopBar />
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div key={location.pathname} className="anim-page mx-auto min-h-full max-w-[1400px] pb-16">
            <Suspense fallback={<p className="px-8 py-10 text-[13px] text-fg-3">Loading…</p>}>
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <NewTaskModal defaults={newTask} onClose={() => setNewTask(null)} />
      <NewSourceModal open={newSource} onClose={() => setNewSource(false)} />
      <RevisitModal open={newRevisit} onClose={() => setNewRevisit(false)} />
      <CaptureModal open={capture} onClose={() => setCapture(false)} />
      <TaskDrawer taskId={taskId} onClose={() => setParam("task", null)} />
      <SourceDrawer sourceId={sourceId} onClose={() => setParam("source", null)} />
    </ActionsCtx.Provider>
  );
}
