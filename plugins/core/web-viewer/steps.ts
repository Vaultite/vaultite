// Agents' steps as the replay shows them: what each did in words, its kind (an icon and a colour), how long things
// took, and a long run's repeats folded into one card (a script run 6,000 times in a row is one thing to look at).
import { AppWindow, ArrowDownUp, BookOpen, Braces, Camera, CircleAlert, ClipboardList, FileText, Hand, Hourglass, KeyRound, Keyboard, ListChecks,
  MousePointer2, MousePointerClick, Navigation, Square, SquareCheck, SquareTerminal, TextCursorInput, Upload, type LucideIcon } from "lucide-react"
import { numberText } from "@vaultite"

export type Step = {
  t: number; tab: number; by: string; task?: string; summary?: string; url: string; title: string; action: string; ref?: string; name?: string; value?: string
  fields?: { name?: string; ref: string; value?: string }[]
  /** Its picture's name (runshots.ts), null for none. */
  shot: string | null
  /** A call that failed: why (electron/browser/agent.ts `failed`). */
  failed?: string
  /** How long the call took, ms (steps kept since this was). */
  ms?: number
  [more: string]: unknown
}
export type Run = {
  run: string; by: string; task: string; summary: string; steps: number; start: number; end: number; title: string; url: string
  failed: number; hosts: string[]; shots: string[]; activity: number[]; fails: number[]
}

const WHAT: Record<string, string> = { open: "Opened", navigate: "Went to", click: "Clicked", dblclick: "Double-clicked", hover: "Pointed at", fill: "Filled",
  type: "Typed in", press: "Pressed", check: "Checked", uncheck: "Unchecked", select: "Picked", scroll: "Scrolled", upload: "Uploaded", evaluate: "Ran a script",
  run: "Ran a flow", help: "Asked the user", pdf: "Saved as PDF", login: "Logged in", read: "Read the page", wait: "Waited", screenshot: "Took a screenshot",
  snapshot: "Looked at the page", act: "Acted", form: "Filled a form" }
/** What a run of the same step says, folded ("Ran a script ×6,929"). */
export const verbOf = (action: string) => WHAT[action] ?? capital(action)
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** The step in a line: "Clicked “Save”", "Typed in “Email”: alice@…". */
export function said(s: Partial<Step>) {
  if (s.action === "form") return `Filled ${(s.fields ?? []).map((f) => f.name || f.ref).join(", ") || "a form"}`
  const what = verbOf(s.action ?? "")
  const on = s.name ? ` “${s.name}”` : ""
  const v = typeof s.value === "string" ? s.value : ""
  const value = !v || ["run", "evaluate", "help", "login"].includes(s.action ?? "") ? ""
    : s.action === "fill" || s.action === "type" || s.action === "select" ? `: ${v}`
    : s.action === "open" || s.action === "navigate" ? ` ${hostOf(v)}` : ` ${v}`
  return `${what}${on}${value}`
}
const hostOf = (u: string) => { try { return new URL(u).host.replace(/^www\./, "") } catch { return u } }

type Kind = { icon: LucideIcon; color: string; kind: "go" | "input" | "script" | "look" | "user" | "failed" }
const go = (icon: LucideIcon): Kind => ({ icon, color: "var(--blue)", kind: "go" })
const input = (icon: LucideIcon): Kind => ({ icon, color: "var(--purple)", kind: "input" })
const look = (icon: LucideIcon): Kind => ({ icon, color: "var(--teal)", kind: "look" })
const KINDS: Record<string, Kind> = {
  open: go(AppWindow), navigate: go(Navigation),
  click: input(MousePointerClick), dblclick: input(MousePointerClick), act: input(MousePointerClick), hover: input(MousePointer2), fill: input(TextCursorInput),
  type: input(TextCursorInput), form: input(ClipboardList), press: input(Keyboard), check: input(SquareCheck), uncheck: input(Square), select: input(ListChecks),
  scroll: input(ArrowDownUp), upload: input(Upload),
  evaluate: { icon: Braces, color: "var(--orange)", kind: "script" }, run: { icon: SquareTerminal, color: "var(--orange)", kind: "script" },
  read: look(BookOpen), snapshot: look(BookOpen), wait: look(Hourglass), screenshot: look(Camera), pdf: look(FileText),
  help: { icon: Hand, color: "var(--green)", kind: "user" }, login: { icon: KeyRound, color: "var(--green)", kind: "user" },
}
const FAILED: Kind = { icon: CircleAlert, color: "var(--red)", kind: "failed" }
/** Its icon and colour: what kind of thing it did (a failed one is red, whatever it was). */
export const kindOf = (s: Pick<Step, "action" | "failed">): Kind => (s.failed ? FAILED : KINDS[s.action] ?? input(MousePointerClick))
/** The kinds a run's strip shows, for its legend. */
export const LEGEND: { label: string; color: string }[] = [
  { label: "Pages", color: "var(--blue)" }, { label: "Input", color: "var(--purple)" }, { label: "Scripts", color: "var(--orange)" },
  { label: "Reading", color: "var(--teal)" }, { label: "The user", color: "var(--green)" }, { label: "Failed", color: "var(--red)" },
]

/** A time span in words: "0.4 s", "12 s", "3 min 5 s", "1 h 12 min". */
export function span(ms: number) {
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)} s`
  if (s < 60) return `${Math.round(s)} s`
  const m = Math.floor(s / 60)
  if (m < 60) return m < 10 && Math.round(s % 60) ? `${m} min ${Math.round(s % 60)} s` : `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}
/** The same, short, between two cards: "4s", "38s", "3m", "2h". */
export function short(ms: number) {
  const s = ms / 1000
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`
}
/** A pause before a step worth showing, and one that's slow. */
export const PAUSE_MS = 8_000
export const SLOW_MS = 60_000

/** A page by its address, without its query (a doc's `?tab=` is the same page). */
export const pageOf = (url: string) => { try { const u = new URL(url); return u.host + u.pathname } catch { return url } }

/** What the filmstrip draws: a step, or a run of the same step on one page folded (`first` to `last`). */
export type Item = { first: number; last: number; folded: boolean; startsPage: boolean }
/** Repeats from this many in a row fold. */
const FOLD = 4
export function itemsOf(steps: Step[], open: ReadonlySet<number>): Item[] {
  const items: Item[] = []
  let i = 0, page = ""
  while (i < steps.length) {
    const s = steps[i], p = pageOf(s.url)
    let j = i
    if (!s.failed) while (j + 1 < steps.length && steps[j + 1].action === s.action && !steps[j + 1].failed && pageOf(steps[j + 1].url) === p) j++
    const startsPage = p !== page
    page = p
    if (j - i + 1 >= FOLD && !open.has(i)) items.push({ first: i, last: j, folded: true, startsPage })
    else for (let k = i; k <= j; k++) items.push({ first: k, last: k, folded: false, startsPage: k === i && startsPage })
    i = j + 1
  }
  return items
}
/** The run of repeats a step is in, folded or not: its first and last (none: a step alone). */
export function repeatsOf(steps: Step[], i: number): [number, number] | null {
  const s = steps[i]
  if (!s || s.failed) return null
  const same = (k: number) => steps[k] && steps[k].action === s.action && !steps[k].failed && pageOf(steps[k].url) === pageOf(s.url)
  let a = i, b = i
  while (same(a - 1)) a--
  while (same(b + 1)) b++
  return b - a + 1 >= FOLD ? [a, b] : null
}

/** Where each step sits on the run's strip (0 to 1): by time, pauses over a minute shortened to one, so a run with a
 *  night between its steps still shows them; `breaks` are those pauses, where they are and how long they were. */
export function axisOf(steps: Step[]) {
  const CAP = 60_000
  const x = new Float64Array(steps.length)
  const breaks: { at: number; ms: number }[] = []
  let sum = 0
  for (let i = 1; i < steps.length; i++) {
    const gap = Math.max(0, steps[i].t - steps[i - 1].t)
    if (gap > CAP) breaks.push({ at: i, ms: gap })
    sum += Math.min(gap, CAP)
    x[i] = sum
  }
  // (a run of one step, or all at once: spread evenly)
  if (!sum) for (let i = 0; i < steps.length; i++) x[i] = steps.length > 1 ? i / (steps.length - 1) : 0.5
  else for (let i = 0; i < steps.length; i++) x[i] /= sum
  return { x, breaks: breaks.map((b) => ({ at: x[b.at] - (Math.min(b.ms, CAP) / sum) / 2, ms: b.ms })) }
}
/** The step nearest `at` (0 to 1) on the strip. */
export function nearest(x: Float64Array, at: number) {
  let lo = 0, hi = x.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (x[mid] < at) lo = mid + 1; else hi = mid }
  return lo > 0 && Math.abs(x[lo - 1] - at) <= Math.abs(x[lo] - at) ? lo - 1 : lo
}

export const count = (n: number) => numberText(n)
