/** Keyboard shortcuts: one list for the ? dialog and Settings, and the G-then-key page jumps. */
import { Kbd, Modal } from "./ui";

/** Press G, then one of these keys, to jump to a page. */
export const GO_TO: Record<string, { to: string; label: string }> = {
  t: { to: "/", label: "Today" },
  k: { to: "/tasks", label: "Tasks" },
  l: { to: "/learn", label: "Learn" },
  a: { to: "/radar", label: "Radar" },
  r: { to: "/revisit", label: "Revisit" },
  p: { to: "/report", label: "Week report" },
  s: { to: "/settings", label: "Settings" },
};

const isMac = typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

export const SHORTCUTS: { group: string; items: [string, string[]][] }[] = [
  {
    group: "General",
    items: [
      ["Search and commands", [isMac ? "⌘" : "Ctrl", "K"]],
      ["Show shortcuts", ["?"]],
      ["Close a drawer or dialog", ["Esc"]],
    ],
  },
  {
    group: "Create",
    items: [
      ["New task", ["C"]],
      ["New source", ["S"]],
      ["Add to Revisit", ["R"]],
      ["Add to Radar", ["N"]],
    ],
  },
  { group: "Go to", items: Object.values(GO_TO).map((g, i) => [g.label, ["G", Object.keys(GO_TO)[i].toUpperCase()]]) },
];

export function ShortcutList() {
  return (
    <div className="space-y-5">
      {SHORTCUTS.map((g) => (
        <section key={g.group}>
          <h3 className="mb-2 text-[13px] font-semibold">{g.group}</h3>
          <ul className="divide-y divide-line rounded-lg border border-line text-[14px]">
            {g.items.map(([label, keys]) => (
              <li key={label} className="flex items-center justify-between px-3 py-2">
                <span className="text-fg-2">{label}</span>
                <span className="inline-flex gap-1">
                  {keys.map((k) => (
                    <Kbd key={k}>{k}</Kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Modal open={open} onClose={onClose} title="Keyboard shortcuts">
      <ShortcutList />
    </Modal>
  );
}
