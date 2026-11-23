/** Typed client for the Smriti API. Shapes follow docs/SPEC.md section 3. */

export type TaskStatus = "todo" | "doing" | "done";
export type SourceKind = "topic" | "article" | "book" | "video";
export type SourceStatus = "queued" | "active" | "done";
export type Repeat = "none" | "daily" | "weekdays" | "weekly" | "monthly";
/** 0 none, 1 low, 2 medium, 3 high, 4 urgent */
export type Priority = 0 | 1 | 2 | 3 | 4;

export type Project = { id: number; key: string; name: string; archived: boolean; open_count: number; created_at: string };

export type Task = {
  id: number;
  key: string;
  project_id: number;
  project_key: string;
  parent_id: number | null;
  parent_key: string | null;
  title: string;
  body: string;
  status: TaskStatus;
  priority: Priority;
  planned_on: string | null;
  due_on: string | null;
  estimate_min: number | null;
  repeat: Repeat;
  tags: string[];
  url: string | null;
  position: number;
  logged_min: number;
  checks_done: number;
  checks_total: number;
  children: number;
  /** How many of its direct children are done. */
  children_done: number;
  created_at: string;
  updated_at: string;
  status_at: string;
  done_at: string | null;
};
export type Check = { id: number; task_id: number; title: string; done: boolean; position: number };
export type Note = { id: number; task_id: number | null; source_id: number | null; body: string; created_at: string; edited_at: string | null };
export type Event = { id: number; field: string; old: string | null; new: string | null; at: string };
export type SubjectKind = "task" | "source" | "revisit";
export type Session = {
  id: number;
  subject: { kind: SubjectKind; id: number; label: string; key: string | null };
  started_at: string;
  ended_at: string | null;
  minutes: number | null;
  note: string;
};
export type TaskRef = { id: number; key: string; title: string; status: TaskStatus };
export type TaskFull = Task & {
  checks: Check[];
  notes: Note[];
  sessions: Session[];
  events: Event[];
  /** Direct children. */
  subtasks: Task[];
  /** The chain above this task, top first, ending with its parent. */
  ancestors: TaskRef[];
  /** Open children, grandchildren and so on. */
  open_descendants: number;
};

export type Source = {
  id: number;
  kind: SourceKind;
  title: string;
  url: string | null;
  author: string;
  site: string;
  image: string | null;
  summary: string;
  body: string;
  status: SourceStatus;
  progress: number;
  total: number | null;
  tags: string[];
  ref: string | null;
  logged_min: number;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  done_at: string | null;
  /** Path of its note inside the Obsidian vault, once saved there. */
  /** The collections it sits in, by name. */
  collections: { id: number; name: string }[];
  obsidian_path: string | null;
  exported_at: string | null;
};
export type SourceFull = Source & { notes: Note[]; sessions: Session[]; events: Event[]; revisits: Revisit[] };

export type Capture = {
  id: number;
  text: string;
  details: string;
  url: string | null;
  tags: string[];
  status: "open" | "kept" | "dismissed";
  task_id: number | null;
  source_id: number | null;
  revisit_id: number | null;
  created_at: string;
  sorted_at: string | null;
};

export type Revisit = {
  id: number;
  title: string;
  prompt: string;
  body: string;
  url: string | null;
  priority: Priority;
  status: "active" | "retired";
  task_id: number | null;
  source_id: number | null;
  logged_min: number;
  review_count: number;
  created_at: string;
  updated_at: string;
  reviewed_at: string | null;
  retired_at: string | null;
};
export type RevisitFull = Revisit & { sessions: Session[] };

export type Day = { date: string; went_well: string; blockers: string; tomorrow: string; updated_at: string | null };

export type Today = {
  date: string;
  planned: Task[];
  overdue: Task[];
  doing: Task[];
  running: Session | null;
  open_captures: number;
  revisits_due: Revisit[];
  waiting: Task[];
  counts: { open: number; doing: number; overdue: number; logged_today_min: number };
  week: { done: number; logged_min: number; learning_min: number };
};

export type WeekReport = {
  start: string;
  end: string;
  days: { date: string; task_min: number; source_min: number; revisit_min: number }[];
  by_project: { project_key: string; name: string; minutes: number }[];
  done: Task[];
  carried: Task[];
  sources_done: Source[];
  days_reviewed: Day[];
  totals: { done: number; logged_min: number; learning_min: number; captures: number };
};

export type SearchHit = { kind: "task" | "source" | "revisit" | "capture"; id: number; title: string; snippet: string; key: string | null };
export type TrashEntry = { kind: "task" | "source" | "revisit" | "capture" | "project"; id: number; title: string; deleted_at: string; purge_on: string };
export type LinkInfo = { title: string; site: string; author: string; summary: string; image: string | null; kind: "article" | "video" };
export type BookHit = { title: string; author: string; year: number | null; total: number | null; image: string | null; ref: string };
export type Quote = { id: number; text: string; author: string; created_at: string };
export type ObsidianStatus = {
  vault_dir: string;
  vault_path: string;
  mounted: boolean;
  writable: boolean;
  is_obsidian_vault: boolean;
  folder: string;
  articles_folder: string;
  auto: boolean;
};
export type Collection = { id: number; name: string; count: number; created_at: string };
export type Config = { version: string; tz: string; today: string; trash_days: number };

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.error?.code ?? "error", data?.error?.message ?? res.statusText);
  return data as T;
}

/** Builds "?a=1&b=2", skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") p.set(k, String(v));
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** A request index.html already started for this path, used once; later reads go to the network. */
function takePrefetched<T>(path: string): Promise<T> | undefined {
  const store = (window as unknown as { __smritiPrefetch?: Record<string, Promise<T>> }).__smritiPrefetch;
  const hit = store?.[path];
  if (hit) delete store[path];
  return hit?.catch(() => request<T>("GET", path));
}

export const api = {
  get: <T>(path: string) => takePrefetched<T>(path) ?? request<T>("GET", path),
  post: <T>(path: string, body: unknown = {}) => request<T>("POST", path, body),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  del: <T = void>(path: string) => request<T>("DELETE", path),
};
