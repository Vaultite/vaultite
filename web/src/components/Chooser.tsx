import { memo, isValidElement, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react"
import { Check } from "lucide-react"
import { anyIcon, type IconType } from "@/core/icons"
import { answerUi } from "@/core/askers"
import { fuzzy } from "@/core/fuzzy"
import { marked, NoMatches, Palette, type Pick as How } from "@/components/Palette"
import { signal } from "@/core/signal"
import { isObj } from "../../../core/values.ts"

export type Choice = { id: string; label: string; detail?: string
  /** Drawn before the label: an icon, or anything drawn (an app's icon). */
  icon?: IconType | ReactElement }
export type Choose<C extends Choice = Choice> = {
  /** What it's for ("Insert template"), read by screen readers. */
  title: string
  placeholder: string
  items: C[]
  /** `how.mod`: picked with ⌘Enter or a ⌘-click (what that does besides: `modHint`). */
  onPick: (item: C, how: How) => void
  /** What picking with ⌘ does too, said along the bottom ("to always open it there"). */
  modHint?: string
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
  /** What the field holds at first, selected: a name to edit (Rename tab…). */
  typed?: string
  /** Enter with the field empty and nothing listed (a name cleared: back to the automatic one). */
  onBlank?: () => void
  /** A row's label drawn another way (a font in itself); `marks` are the matched letters (see `Marked`). */
  label?: (item: C, marks: number[]) => ReactNode
  /** The selected item as the selection moves, to show it for now (a colour scheme on the whole app); null once the
   *  picker closes, after `onPick` or `onDismiss`. */
  preview?: (item: C | null) => void
}
const iconOf = (I: IconType | ReactElement) => (isValidElement(I) ? I : <I className="size-4 text-muted-foreground" strokeWidth={2} />)
type Asking = { of: object; onDismiss?: () => void; draw: (key: number, onClose: () => void) => ReactNode }
let asking: Asking | null = null
const subs = signal()
let shown = 0
const show = (c: Asking | null) => { asking = c; shown++; subs.notify() }
/** Ask the user to pick one of `items`. */
export function choose<C extends Choice>(c: Choose<C> | null) {
  const was = asking
  show(c && { of: c, onDismiss: c.onDismiss, draw: (key, onClose) => <Picker key={key} c={c} onClose={onClose} /> })
  if (was && was.of !== c) was.onDismiss?.()
}

/** The palette as a text field: Enter gives what's typed (trimmed; `label` names the row it makes), an empty Enter
 *  `onBlank` where there is one, Esc nothing. */
export function askText(o: Pick<Choose, "title" | "heading" | "placeholder" | "typed" | "onBlank" | "onDismiss"> & {
  hint: ReactNode; label: (text: string) => string; icon?: Choice["icon"]; onText: (text: string) => void }) {
  const { hint, label, icon, onText, ...rest } = o
  choose({ ...rest, items: [], empty: <p className="px-3 py-6 text-center text-[15px] text-muted-foreground">{hint}</p>,
    other: (t) => (t.trim() ? { id: t.trim(), label: label(t.trim()), icon } : null), onPick: (it) => onText(it.id) })
}

export const Chooser = memo(function Chooser() {
  const c = subs.use(() => asking)
  return c ? c.draw(shown, () => choose(null)) : null
})

const TYPED = "\u0000typed"
answerUi("choose", (m, ended) => new Promise((done) => {
  const items = (Array.isArray(m.items) ? m.items : []).map((it): Record<string, unknown> => (isObj(it) ? it : {}))
  const str = (v: unknown) => (typeof v === "string" && v ? v : undefined)
  let c: Choose, typed = ""
  const timer = setTimeout(() => { if (asking?.of === c) choose(null) }, (typeof m.timeout === "number" ? m.timeout : 300) * 1000)
  const end = (answer: unknown) => { clearTimeout(timer); done(answer) }
  const prompt = str(m.prompt)
  c = {
    title: prompt ?? "Pick one", heading: prompt, placeholder: items.length ? "Type to filter…" : "Type your answer…",
    empty: items.length ? undefined : <span />,
    items: items.map((it, i) => {
      const name = str(it.icon), icon = name && anyIcon(name)
      return { id: String(i), label: str(it.label) ?? String(i + 1), detail: str(it.detail), ...(icon ? { icon } : {}) }
    }),
    current: typeof m.current === "number" ? String(m.current) : undefined,
    other: m.other ? (t) => { typed = t; return { id: TYPED, label: `Use "${t}"` } } : undefined,
    onPick: (it) => end(it.id === TYPED ? { typed } : { index: Number(it.id) }),
    onDismiss: () => end(null),
  }
  ended.addEventListener("abort", () => { if (asking?.of === c) choose(null) })
  choose(c)
}))

function Picker<C extends Choice>({ c, onClose }: { c: Choose<C>; onClose: () => void }) {
  const [q, setQ] = useState(c.typed ?? "")
  useEffect(() => () => c.preview?.(null), [c])
  const items = useMemo(() => {
    const query = q.trim()
    const none = (): number[] => []
    if (!query) return c.items.map((it) => ({ ...it, marks: none() }))
    const hits = c.items.flatMap((it) => { const m = fuzzy(query, it.label); return m ? [{ ...it, ...m }] : [] }).sort((a, b) => b.score - a.score)
    const extra = !c.items.some((it) => it.label.toLowerCase() === query.toLowerCase()) && c.other?.(query)
    return extra ? [...hits, { ...extra, marks: none() }] : hits
  }, [c, q])
  const start = Math.max(0, c.items.findIndex((it) => it.id === c.current))
  const field = !c.items.length && !!c.other
  return (
    <Palette label={c.title} placeholder={c.placeholder} query={q} setQuery={setQ} items={items} onClose={onClose} start={start} onSelect={c.preview} select={!!c.typed}
      onPick={(it, how) => {
        if (it) { show(null); c.onPick(it, how) } else if (!q.trim() && c.onBlank) { show(null); c.onBlank() }
      }} heading={c.heading}
      empty={c.empty ?? <NoMatches what="Nothing matches" query={q} />}
      hints={field ? [["Enter", "to confirm"], ["Escape", "to cancel"]] : [["ArrowUp ArrowDown", "to navigate"], ["Enter", "to pick"], ...(c.modHint ? [["Mod+Enter", c.modHint] satisfies [string, string]] : []), ["Escape", "to dismiss"]]}
      row={(h) => (
        <>
          {h.icon && <span className="flex size-5 shrink-0 items-center justify-center">{iconOf(h.icon)}</span>}
          <span className="min-w-0 flex-1 truncate text-[15px] leading-[21px] text-foreground/90">{c.label ? c.label(h, h.marks) : marked(h.label, h.marks)}</span>
          {h.detail && <span className="shrink-0 text-[13px] text-muted-foreground">{h.detail}</span>}
          {c.current !== undefined && <Check className={h.id === c.current ? "size-4 shrink-0 text-primary" : "invisible size-4 shrink-0"} strokeWidth={2.5} />}
        </>
      )} />
  )
}
