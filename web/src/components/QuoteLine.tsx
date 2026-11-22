/**
 * One quote, quietly, under the page title. It changes every 2 minutes on its own (it waits while
 * the pointer is over it), and the arrow shows the next one at once. Turned on or off in Settings,
 * per browser.
 */
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useLocalState, useQuotes } from "../lib/hooks";

export const QUOTES_KEY = "smriti-quotes-on";
const EVERY_MS = 2 * 60_000;

export function QuoteLine() {
  const [on] = useLocalState(QUOTES_KEY, true);
  const { data: quotes } = useQuotes();
  // Start from the current 2-minute slot, so a reload shows the same quote rather than jumping back.
  const [index, setIndex] = useState(() => Math.floor(Date.now() / EVERY_MS));
  const [hover, setHover] = useState(false);

  useEffect(() => {
    if (hover || !quotes || quotes.length < 2) return;
    const t = setInterval(() => setIndex((i) => i + 1), EVERY_MS);
    return () => clearInterval(t);
  }, [hover, quotes]);

  if (!on || !quotes?.length) return null;
  const q = quotes[index % quotes.length];
  return (
    <figure
      className="group mx-4 mb-6 flex items-start gap-3 rounded-xl border border-line bg-surface px-4 py-3 md:mx-8"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className="font-serif text-[28px] leading-none text-accent select-none" aria-hidden>
        “
      </span>
      <blockquote key={q.id} className="anim-fade min-w-0 flex-1 pt-1 text-[14px] leading-relaxed text-fg" aria-live="polite">
        {q.text}
        {q.author && <figcaption className="mt-1 text-[13px] text-fg-2">— {q.author}</figcaption>}
      </blockquote>
      {quotes.length > 1 && (
        <button
          onClick={() => setIndex(index + 1)}
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
