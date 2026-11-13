import { AppWindow, ArrowDownUp, BookOpen, Braces, Camera, CircleAlert, ClipboardList, FileText, Hand, Hourglass, KeyRound, Keyboard, ListChecks,
  ClipboardPaste, Download, MousePointer2, MousePointerClick, Navigation, Square, SquareCheck, SquareTerminal, TextCursorInput, Upload, type LucideIcon } from "lucide-react"
import { numberText } from "@vaultite"

export type Step = {
  t: number; tab: number; by: string; task?: string; summary?: string; url: string; title: string; action: string; ref?: string; name?: string; value?: string
  fields?: { name?: string; ref: string; value?: string }[]
  shot: string | null
  failed?: string
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
  snapshot: "Looked at the page", act: "Acted", form: "Filled a form", paste: "Pasted into", download: "Downloaded" }
export const verbOf = (action: string) => WHAT[action] ?? capital(action)
const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function said(s: Partial<Step>) {
  if (s.action === "form") return `Filled ${(s.fields ?? []).map((f) => f.name || f.ref).join(", ") || "a form"}`
  const what = verbOf(s.action ?? "")
  const on = s.name ? ` “${s.name}”` : ""
  const v = typeof s.value === "string" ? s.value : ""
  const value = !v || ["run", "evaluate", "help", "login", "paste"].includes(s.action ?? "") ? ""
    : s.action === "fill" || s.action === "type" || s.action === "select" ? `: ${v}`
    : s.action === "open" || s.action === "navigate" || s.action === "download" ? ` ${hostOf(v)}` : ` ${v}`
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
  scroll: input(ArrowDownUp), upload: input(Upload), paste: input(ClipboardPaste),
  evaluate: { icon: Braces, color: "var(--orange)", kind: "script" }, run: { icon: SquareTerminal, color: "var(--orange)", kind: "script" },
  read: look(BookOpen), snapshot: look(BookOpen), wait: look(Hourglass), screenshot: look(Camera), pdf: look(FileText), download: look(Download),
  help: { icon: Hand, color: "var(--green)", kind: "user" }, login: { icon: KeyRound, color: "var(--green)", kind: "user" },
}
const FAILED: Kind = { icon: CircleAlert, color: "var(--red)", kind: "failed" }
export const kindOf = (s: Partial<Pick<Step, "action" | "failed">>): Kind => (s.failed ? FAILED : KINDS[s.action ?? ""] ?? input(MousePointerClick))
export const LEGEND: { label: string; color: string }[] = [
  { label: "Pages", color: "var(--blue)" }, { label: "Input", color: "var(--purple)" }, { label: "Scripts", color: "var(--orange)" },
  { label: "Reading", color: "var(--teal)" }, { label: "The user", color: "var(--green)" }, { label: "Failed", color: "var(--red)" },
]

export function span(ms: number) {
  const s = ms / 1000
  if (s < 10) return `${s.toFixed(1)} s`
  if (s < 60) return `${Math.round(s)} s`
  const m = Math.floor(s / 60)
  if (m < 60) return m < 10 && Math.round(s % 60) ? `${m} min ${Math.round(s % 60)} s` : `${m} min`
  const h = Math.floor(m / 60)
  return m % 60 ? `${h} h ${m % 60} min` : `${h} h`
}
export function short(ms: number) {
  const s = ms / 1000
  return s < 60 ? `${Math.round(s)}s` : s < 3600 ? `${Math.round(s / 60)}m` : `${Math.round(s / 3600)}h`
}
export const PAUSE_MS = 8_000
export const SLOW_MS = 60_000

export const pageOf = (url: string) => { try { const u = new URL(url); return u.host + u.pathname } catch { return url } }

export type Item = { first: number; last: number; folded: boolean; startsPage: boolean }
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
export function repeatsOf(steps: Step[], i: number): [number, number] | null {
  const s = steps[i]
  if (!s || s.failed) return null
  const same = (k: number) => steps[k] && steps[k].action === s.action && !steps[k].failed && pageOf(steps[k].url) === pageOf(s.url)
  let a = i, b = i
  while (same(a - 1)) a--
  while (same(b + 1)) b++
  return b - a + 1 >= FOLD ? [a, b] : null
}

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
  if (!sum) for (let i = 0; i < steps.length; i++) x[i] = steps.length > 1 ? i / (steps.length - 1) : 0.5
  else for (let i = 0; i < steps.length; i++) x[i] /= sum
  return { x, breaks: breaks.map((b) => ({ at: x[b.at] - (Math.min(b.ms, CAP) / sum) / 2, ms: b.ms })) }
}
export function nearest(x: Float64Array, at: number) {
  let lo = 0, hi = x.length - 1
  while (lo < hi) { const mid = (lo + hi) >> 1; if (x[mid] < at) lo = mid + 1; else hi = mid }
  return lo > 0 && Math.abs(x[lo - 1] - at) <= Math.abs(x[lo] - at) ? lo - 1 : lo
}

export const count = (n: number) => numberText(n)
