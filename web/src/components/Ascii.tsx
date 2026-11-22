/**
 * ASCII figures for empty states, drawn in characters and typed in line by line on first show.
 */
import clsx from "clsx";
import { useEffect, useState, type CSSProperties } from "react";

const ART: Record<string, { means: string; lines: string[] }> = {
  wordmark: {
    means: "Smriti, set in characters",
    lines: [
      "   ;;;;  ;;   ;;  ;;;;;   ;;  ;;;;;;  ;;  ",
      "  ;;     ;;; ;;;  ;;  ;;  ;;    ;;    ;;  ",
      "   ;;;   ;; ; ;;  ;;;;;   ;;    ;;    ;;  ",
      "     ;;  ;;   ;;  ;; ;;   ;;    ;;    ;;  ",
      "  ;;;;   ;;   ;;  ;;  ;;  ;;    ;;    ;;  ",
    ],
  },
  shelf: {
    means: "an empty shelf",
    lines: [
      "  .------------------------------------.",
      "  |                                    |",
      "  |                                    |",
      "  |____________________________________|",
      "  ======================================",
      "    ||                              ||  ",
      "    ||                              ||  ",
    ],
  },
  scope: {
    means: "a radar scope with nothing on it",
    lines: [
      "           .-~~~~~~~-.          ",
      "        .'      |      '.       ",
      "       /        |        \\      ",
      "      |  -------+-------  |     ",
      "       \\        |      * /      ",
      "        '.      |      .'       ",
      "           '-.......-'          ",
    ],
  },
  hammock: {
    means: "an empty hammock between two posts",
    lines: [
      "   |\\                              /|  ",
      "   | \\_                          _/ |  ",
      "   |   '-._                  _.-'   |  ",
      "   |       '-..__________..-'       |  ",
      "   |                                |  ",
      " __|________________________________|__",
    ],
  },
};

export function Ascii({ name, className }: { name: string; className?: string; plate?: string }) {
  const art = ART[name];
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!art) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setShown(art.lines.length);
    setShown(0);
    const t = setInterval(() => setShown((n) => (n >= art.lines.length ? (clearInterval(t), n) : n + 1)), 70);
    return () => clearInterval(t);
  }, [art]);
  if (!art) return null;
  return (
    <div role="img" aria-label={art.means} className={clsx("flex justify-center", className)}>
      <pre className="t-ascii text-[11px] md:text-[12px]" style={{ minHeight: `${art.lines.length * 1.15}em` } as CSSProperties}>
        {art.lines.slice(0, shown).join("\n")}
      </pre>
    </div>
  );
}
