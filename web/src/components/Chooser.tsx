// Pick one of a list in the palette overlay (`choose` in the plugin API; an agent's `vau choose`, through the server's
// ask). Mounted once.
import { isValidElement, useMemo, useState, type ReactNode } from "react"
import { Check, type LucideIcon } from "lucide-react"
import { anyIcon } from "@/core/icons"
import { answerUi } from "@/core/live"
import { fuzzy } from "@/core/search"
import { Marked, Palette } from "@/components/Palette"
import { signal } from "@/core/signal"

export type Choice = { id: string; label: string; detail?: string
  /** Drawn before the label: a lucide icon, or anything (an app's icon). */
  icon?: LucideIcon | ReactNode }
export type Choose<C extends Choice = Choice> = {
  /** What it's for ("Insert template"), read by screen readers. */
  title: string
  placeholder: string
  items: C[]
  onPick: (item: C) => void
  /** Closed without a pick (Esc, a click outside, another `choose` in its place). */
  onDismiss?: () => void
  /** A line above the list (the question asked). */
  heading?: string
  /** What shows when there's nothing to pick. */
  empty?: ReactNode
  /** The id of the current value: checked, and selected while nothing is typed. */
  current?: string
  /** An item for what's typed when no item is called exactly that (a name that isn't listed), after the matches. */
  other?: (typed: string) => C | null
  /** A row's label drawn another way (a font in itself); `marks` are the matched letters (see `Marked`). */
  label?: (item: C, marks: number[]) => ReactNode
}
const iconOf = (i: LucideIcon | ReactNode) => {
  if (isValidElement(i) || typeof i !== "object" || i === null) return i as ReactNode
  const Icon = i as unknown as LucideIcon
  return <Icon className="size-4 text-muted-foreground" strokeWidth={2} />
}
let asking: Choose<never> | null = null
const subs = signal()
let shown = 0 // each ask its own picker, so a second list with the same title starts afresh
const show = (c: Choose<never> | null) => { asking = c; shown++; subs.notify() }
/** Ask the user to pick one of `items`. */
export function choose<C extends Choice>(c: Choose<C> | null) {
  const was = asking
  show(c as unknown as Choose<never> | null)
  if (was && was !== asking) was.onDismiss?.()
}

export function Chooser() {
  const c = subs.use(() => asking) as unknown as Choose | null
  return c ? <Picker key={shown} c={c} onClose={() => choose(null)} /> : null
}

// An agent's list (ui.choose, core/coreops.ts): the index picked, what was typed ({typed}), or null when dismissed or
// when its time is up (the server has stopped waiting).
const TYPED = "\u0000typed"
answerUi("choose", (m, ended) => new Promise((done) => {
  const items = (Array.isArray(m.items) ? m.items : []) as { label?: unknown; detail?: unknown; icon?: unknown }[]
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
  let c: Choose, typed = ""
  const timer = setTimeout(() => { if ((asking as unknown) === c) choose(null) }, (typeof m.timeout === "number" ? m.timeout : 300) * 1000)
  const end = (answer: unknown) => { clearTimeout(timer); done(answer) }
  const prompt = str(m.prompt)
  c = {
    title: prompt ?? "Pick one", heading: prompt, placeholder: items.length ? "Type to filter…" : "Type your answer…",
    empty: items.length ? undefined : <span />,
    items: items.map((it, i) => {
      const icon = str(it.icon) && anyIcon(str(it.icon)!)
      return { id: String(i), label: str(it.label) ?? String(i + 1), detail: str(it.detail), ...(icon ? { icon } : {}) }
    }),
    current: typeof m.current === "number" ? String(m.current) : undefined,
    other: m.other ? (t) => { typed = t; return { id: TYPED, label: `Use "${t}"` } } : undefined,
    onPick: (it) => end(it.id === TYPED ? { typed } : { index: Number(it.id) }),
    onDismiss: () => end(null),
  }
  ended.addEventListener("abort", () => { if ((asking as unknown) === c) choose(null) })
  choose(c)
}))

function Picker({ c, onClose }: { c: Choose; onClose: () => void }) {
  const [q, setQ] = useState("")
  const items = useMemo(() => {
    const query = q.trim()
    if (!query) return c.items.map((it) => ({ ...it, marks: [] as number[] }))
    const hits = c.items.flatMap((it) => { const m = fuzzy(query, it.label); return m ? [{ ...it, ...m }] : [] }).sort((a, b) => b.score - a.score)
    const extra = !c.items.some((it) => it.label.toLowerCase() === query.toLowerCase()) && c.other?.(query)
    return extra ? [...hits, { ...extra, marks: [] as number[] }] : hits
  }, [c, q])
  const start = Math.max(0, c.items.findIndex((it) => it.id === c.current))
  return (
    <Palette label={c.title} placeholder={c.placeholder} query={q} setQuery={setQ} items={items} onClose={onClose} start={start}
      onPick={(it) => { if (!it) return; show(null); c.onPick(it) }} heading={c.heading}
      empty={c.empty ?? <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">Nothing matches "{q.trim()}".</p>}
      hints={[["ArrowUp ArrowDown", "to navigate"], ["Enter", "to pick"], ["Escape", "to dismiss"]]}
      row={(h) => (
        <>
          {h.icon && <span className="flex size-5 shrink-0 items-center justify-center">{iconOf(h.icon)}</span>}
          <span className="min-w-0 flex-1 truncate text-[15px] leading-[21px] text-foreground/90">{c.label ? c.label(h, h.marks) : <Marked text={h.label} marks={h.marks} />}</span>
          {h.detail && <span className="shrink-0 text-[13px] text-muted-foreground">{h.detail}</span>}
          {c.current !== undefined && <Check className={h.id === c.current ? "size-4 shrink-0 text-primary" : "invisible size-4 shrink-0"} strokeWidth={2.5} />}
        </>
      )} />
  )
}
