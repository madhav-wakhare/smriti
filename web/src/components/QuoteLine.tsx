/**
 * One quote, quietly, under the page title. Every 15 seconds it switches to another quote picked at
 * random (never the same one twice in a row), and waits while the pointer is over it. The arrow
 * shows another one at once. Turned on or off in Settings, per browser.
 */
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocalState, useQuotes } from "../lib/hooks";

export const QUOTES_KEY = "smriti-quotes-on";
const EVERY_MS = 15_000;

/** A random index into a list of n, different from `not` when there is more than one. */
function pick(n: number, not: number) {
  if (n < 2) return 0;
  const i = Math.floor(Math.random() * (n - 1));
  return i >= not ? i + 1 : i;
}

export function QuoteLine() {
  const [on] = useLocalState(QUOTES_KEY, true);
  const { data: quotes } = useQuotes();
  const n = quotes?.length ?? 0;
  const [index, setIndex] = useState(-1);
  const [hover, setHover] = useState(false);
  const next = useCallback(() => setIndex((i) => pick(n, i)), [n]);

  // A random first quote once the list arrives, then a new random one every 15 seconds.
  useEffect(() => {
    if (n && (index < 0 || index >= n)) next();
  }, [n, index, next]);
  useEffect(() => {
    if (hover || n < 2) return;
    const t = setInterval(next, EVERY_MS);
    return () => clearInterval(t);
  }, [hover, n, next]);

  if (!on || !quotes?.length) return null;
  const q = quotes[Math.max(0, index) % n];
  return (
    <figure
      className="group mx-4 mb-6 flex items-start gap-3.5 rounded-xl border border-line bg-surface px-4 py-3 md:mx-8"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <QuoteMark />
      <blockquote key={q.id} className="anim-fade min-w-0 flex-1 self-center text-[14px] leading-relaxed text-fg" aria-live="polite">
        {q.text}
        {q.author && <figcaption className="mt-1 text-[13px] text-fg-2">— {q.author}</figcaption>}
      </blockquote>
      {n > 1 && (
        <button
          onClick={next}
          aria-label="Show another quote"
          title="Another quote"
          className="mt-1 rounded p-1 text-fg-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg focus:opacity-100"
        >
          <RefreshCw size={14} />
        </button>
      )}
    </figure>
  );
}

/** A filled pair of opening quote marks on a soft accent tile. */
function QuoteMark() {
  return (
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent-soft text-accent" aria-hidden>
      <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
        <path d="M4 18.5v-5.2C4 9.1 6.2 6.2 10.2 5l.8 1.6C8.6 7.6 7.4 9.4 7.3 11.6H10.5v6.9H4Zm9.5 0v-5.2c0-4.2 2.2-7.1 6.2-8.3l.8 1.6c-2.4 1-3.6 2.8-3.7 5H20v6.9h-6.5Z" />
      </svg>
    </span>
  );
}
