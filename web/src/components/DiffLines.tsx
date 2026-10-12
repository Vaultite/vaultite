// A line diff of two texts as the app draws one (File history's versions, Provenance's review): green for lines only in
// the second text, red struck through for lines only in the first, long unchanged runs folded when asked.
import { useLayoutEffect, useRef, useState } from "react"
import { cn, plural } from "@/lib/utils"
import { diffLines } from "@/core/diff"

/** Kept, only in the second text (add), only in the first (del), or `n` unchanged lines folded away (gap). */
export type DiffLine = { kind: "same" | "add" | "del" | "gap"; text: string; n?: number }

/** `before` against `after`, line by line; with `context`, unchanged runs further than that from a change are folded. */
export async function textDiff(before: string, after: string, context?: number): Promise<DiffLine[]> {
  const lines = (t: string) => (t ? t.replace(/\n$/, "").split("\n") : [])  // a file's last newline isn't a line of its own
  const a = lines(before), b = lines(after)
  const out: DiffLine[] = []
  for (const [tag, i1, i2, j1, j2] of await diffLines(a, b)) {
    if (tag === "equal") { for (let j = j1; j < j2; j++) out.push({ kind: "same", text: b[j] }); continue }
    for (let i = i1; i < i2; i++) out.push({ kind: "del", text: a[i] })
    for (let j = j1; j < j2; j++) out.push({ kind: "add", text: b[j] })
  }
  if (context === undefined) return out
  const near = new Array(out.length).fill(false)
  out.forEach((l, i) => { if (l.kind !== "same") for (let k = Math.max(0, i - context); k <= Math.min(out.length - 1, i + context); k++) near[k] = true })
  const folded: DiffLine[] = []
  for (let i = 0; i < out.length;) {
    if (near[i]) { folded.push(out[i++]); continue }
    let j = i
    while (j < out.length && !near[j]) j++
    folded.push({ kind: "gap", text: "", n: j - i })
    i = j
  }
  return folded
}

const ROW = 19 // px: a diff line's height (leading-[19px], never wrapped)
/** The diff's lines, only those in sight drawn (a file of a million lines scrolls like a short one), wherever it scrolls. */
export function DiffRows({ lines }: { lines: DiffLine[] }) {
  const ref = useRef<HTMLDivElement>(null)
  const [span, setSpan] = useState<[number, number]>([0, 200])
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const look = () => {
      const r = el.getBoundingClientRect()
      const from = Math.max(0, Math.floor(-r.top / ROW) - 50), to = Math.min(lines.length, Math.ceil((window.innerHeight - r.top) / ROW) + 50)
      setSpan((s) => (s[0] === from && s[1] === to ? s : [from, Math.max(from, to)]))
    }
    look()
    document.addEventListener("scroll", look, { capture: true, passive: true })
    window.addEventListener("resize", look)
    return () => { document.removeEventListener("scroll", look, { capture: true }); window.removeEventListener("resize", look) }
  }, [lines])
  // As wide as the longest line, so scrolling sideways doesn't change with the lines in sight.
  const wide = lines.reduce((n, l) => Math.max(n, l.text.length), 0)
  return (
    <div ref={ref} className="relative" style={{ height: lines.length * ROW, minWidth: `calc(${wide}ch + 2.25rem)` }}>
      {lines.slice(span[0], span[1]).map((l, k) => (
        <div key={span[0] + k} data-diff={l.kind} style={{ position: "absolute", top: (span[0] + k) * ROW, left: 0, right: 0 }}
          className={cn("flex min-w-max pr-3 whitespace-pre",
            l.kind === "add" && "bg-[color-mix(in_srgb,var(--green)_16%,transparent)]",
            l.kind === "del" && "bg-[color-mix(in_srgb,var(--red)_14%,transparent)] text-muted-foreground line-through decoration-[color-mix(in_srgb,var(--red)_60%,transparent)]",
            l.kind === "gap" && "bg-foreground/[0.03] font-sans text-[12px] text-tertiary")}>
          <span aria-hidden className={cn("w-6 shrink-0 text-center select-none", l.kind === "add" ? "text-[var(--green)]" : l.kind === "del" ? "text-[var(--red)]" : "text-tertiary")}>
            {l.kind === "add" ? "+" : l.kind === "del" ? "−" : l.kind === "gap" ? "⋯" : ""}
          </span>
          <span>{l.kind === "gap" ? plural(l.n ?? 0, "unchanged line") : l.text || " "}</span>
        </div>
      ))}
    </div>
  )
}
