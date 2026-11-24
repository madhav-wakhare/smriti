# Smriti web UI: design rules

Smriti should feel like a calm, ordinary web app: plain words, one obvious action per area, and nothing
to decode. The green terminal palette stays as a theme, but the layout is a normal website.

Develop with `make dev` (UI at http://localhost:5190, API in its own container).

## Layout

- **Top bar:** the mark (a stepped S of five bars in the text colour, then "Smriti"), then the page tabs (Today, Tasks, Learn, Inbox, Revisit, Report), then the
  running timer (when one runs), Search (⌘K), New, and a settings menu (Settings, Trash). The theme is chosen only in Settings.
  On a phone the tabs move to a second row that scrolls sideways.
- **Pages:** `<PageHeader title lede actions />`, then content in `px-4 md:px-8`, at most 1400px wide.
- **Tasks** has three views: Board, List and Timeline. Timeline shows a day as a trace: one row per item, its
  time spans on an hour axis, subtasks under their parent, and planned tasks with no time yet.
- **Opened things:** a task or a source opens in a centred window (`?task=ID`, `?source=ID`). The
  main column holds the title, description, checklist, time and notes. The right column holds the
  few settings that matter, and the rest goes under "More".

## Rules

1. **Plain words.** Write labels in sentence case ("Due date", not "DUE"). Show priority as a word
   (Low, Medium, High, Urgent) and nothing for None. Use statuses "To do / Doing / Done" for tasks
   and "To start / In progress / Done" for sources. Never use bracket counts or `>` prefixes.
2. **Text in sans, numbers in mono.** IBM Plex Sans for text; IBM Plex Mono only for keys
   (`WORK-12`), times and numbers.
3. **Soft shapes.** Cards: `rounded-xl border border-line bg-surface p-4` with a
   `text-[15px] font-semibold` heading. Controls: `rounded-md`. Shadows only on menus and dialogs.
4. **One way to log time.** Always use `<TimeBox>` from `components/time.tsx`. It shows the total,
   Start/Stop, one-click +15m / +30m / +1h / +2h, and "Log time". "Log time" works as in Arc: type the
   time spent ("1h 30m", "45m", "1:30", "1d" = 8h), and the start defaults to now minus that. Typed
   durations always go through `parseDuration` in `lib/format.tsx`, and the task estimate uses it too.
5. **Show only what needs attention.** A board card shows its title, its key, and only the
   priority, due date or "Today" when one applies.
6. **Empty states** are one friendly sentence plus one action, with at most one small ASCII figure.
7. **Use theme tokens only** (`bg`, `surface`, `line`, `fg`, `fg-2`, `fg-3`, `accent`, status
   colours). There are four themes (Black, Terminal, Obsidian, White), stored under `smriti-theme`.

## Shared pieces

- `components/ui.tsx`: Button, IconButton, Switch, Menu, Input, Textarea, Select, DateInput, Checkbox,
  Field, Card, PageHeader, Tabs (segmented control), Kbd, Empty, Modal, Drawer, toasts.
- `components/common.tsx`: useWrite, BlurInput/BlurTextarea (they save when you leave the field),
  TimerButton, useTodayDate, parseTags, dates.
- `components/time.tsx`: TimeBox, StartStop.
- `components/Layout.tsx`: the shell, `useActions()` (openTask, openSource, newTask, newSource,
  newRevisit, capture, search), and `useTheme`.
- `lib/api.ts` (typed client), `lib/hooks.ts` (queries), `lib/format.tsx` (formatting, PRIORITY,
  PriorityMark).

## Speed

- **Build:** the build writes Brotli and gzip copies of every asset (`scripts/compress.mjs`). The API sends
  them as they are, with a one-year cache, because file names change whenever their content changes.
- **API responses:** answers over 1 KB are gzipped.
- **Fonts:** only the Latin font files load (5 files).
- **First data:** `index.html` starts the first data requests while the app downloads, and `api.get` uses
  those answers instead of asking again.
- **Page code:** after the first paint, the browser fetches the other pages' code when idle, so switching
  tabs doesn't wait on the network.
- **Keep it fast:** before adding a library, check its size in the build output. Today ships in the main
  bundle, and every other page loads lazily.
