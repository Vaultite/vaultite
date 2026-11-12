// The browser's downloads (electron/downloads.ts, this Mac's): a toast as one starts and as it ends, the page bar's
// Downloads button (its ring fills as they go) and the status bar's while one goes, each opening the list (downloadlist.tsx).
import { useEffect, useState, type CSSProperties } from "react"
import { Check } from "lucide-react"
import { AmbientButton, cell, cn, notify, notifyError, showLabel, webPages, type WebDownload, type WebEvent } from "@vaultite"

export const list = cell<WebDownload[]>([])
/** The ones the user cancelled here: no toast says so back. */
export const cancelledHere = new Set<number>()
/** Each going one's last two readings (bytes, ms), for its time left. */
export const seen = new Map<number, { bytes: number; at: number; rate: number }>()

export const going = (d: WebDownload) => d.state === "progressing" || d.state === "paused"
/** The page bar shows its button for an hour after the last one, as long as the list has one. */
const BAR_MS = 60 * 60_000
/** The status bar keeps a finished one this long. */
const DONE_MS = 8000

const can = () => !!webPages?.download
export async function act(id: number | null, what: string, failed: string) {
  try {
    if (!await webPages!.download!(id, what)) notify(failed, { kind: "error" })
  } catch (e) { notifyError(e, failed) }
}

/** How far the going ones are, together (-1: some don't say their size; null: none going). */
function overall(l: WebDownload[]) {
  const on = l.filter(going)
  if (!on.length) return null
  if (on.some((d) => !d.total)) return -1
  return on.reduce((a, d) => a + d.received, 0) / on.reduce((a, d) => a + d.total, 0)
}

// ---------- what the desktop app tells ----------

function heard(d: WebDownload) {
  if (going(d)) {
    const was = seen.get(d.id), now = Date.now()
    // (a smoothed rate: one reading's jumps would make the time left jump)
    if (was && now > was.at) { const r = (d.received - was.bytes) / ((now - was.at) / 1000); seen.set(d.id, { bytes: d.received, at: now, rate: was.rate ? was.rate * 0.7 + r * 0.3 : r }) }
    else if (!was) seen.set(d.id, { bytes: d.received, at: now, rate: 0 })
  } else seen.delete(d.id)
  list.update((l) => (l.some((x) => x.id === d.id) ? l.map((x) => (x.id === d.id ? d : x)) : [d, ...l]))
}

/** A download message (WebEvent `download`): the list kept, and this window's toasts. */
export function downloadCame(m: Extract<WebEvent, { type: "download" }>) {
  if (typeof m.gone === "number") { const id = m.gone; list.update((l) => l.filter((x) => x.id !== id)); return }
  const d = m.download
  if (!d) {
    // (an older desktop app tells only how one ended)
    if (m.ok) notify(`Downloaded ${m.name}`, { action: { label: showLabel, run: () => void webPages?.reveal(m.path ?? "") } })
    else notify(`Couldn't download ${m.name}`, { kind: "error" })
    return
  }
  heard(d)
  const id = `download-${d.id}`
  if (m.event === "started") notify(`Downloading ${d.name}`, { id, action: { label: "Show", run: () => showDownloads() } })
  else if (m.event === "done") {
    if (d.state === "completed") notify(`Downloaded ${d.name}`, { id, action: { label: "Open", run: () => act(d.id, "open", `Couldn't open ${d.name}`) } })
    else if (d.state === "cancelled" && cancelledHere.delete(d.id)) notify(`Cancelled ${d.name}`, { id, duration: 2500 })
    else if (d.state === "cancelled") notify(`The download of ${d.name} was cancelled`, { id, action: { label: "Retry", run: () => act(d.id, "retry", `Couldn't download ${d.name} again`) } })
    else notify(`Couldn't download ${d.name}`, { id, kind: "error", action: { label: d.resumable ? "Resume" : "Retry", run: () => act(d.id, d.resumable ? "resume" : "retry", `Couldn't download ${d.name} again`) } })
  }
}

/** The list, under the button it's opened from (the list's own module, loaded the first time). */
export const showDownloads = (from?: HTMLElement) => { void import("./downloadlist").then((m) => m.showDownloads(from)) }

/** The list as this Mac has it, as the window loads. */
export function readDownloads() {
  void Promise.resolve(webPages?.downloads?.()).then((l) => { if (Array.isArray(l)) list.set(l) }, () => {})
}

// ---------- the buttons ----------

/** A download arrow in a ring that fills as the going ones go (a turning arc when their size isn't known). */
function Ring({ className, style, strokeWidth = 2 }: { className?: string; style?: CSSProperties; strokeWidth?: number }) {
  const f = overall(list.use())
  const r = 10, c = 2 * Math.PI * r
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" className={className} style={style} aria-hidden>
      {f !== null && <circle cx="12" cy="12" r={r} className="opacity-25" />}
      {f !== null && <g className={cn(f < 0 && "origin-center animate-spin [transform-box:fill-box]")}>
        <circle cx="12" cy="12" r={r} stroke="var(--primary)" transform="rotate(-90 12 12)" strokeDasharray={c}
          strokeDashoffset={f < 0 ? c * 0.7 : c * (1 - Math.max(0.04, f))} className="[transition:stroke-dashoffset_var(--motion)_linear]" />
      </g>}
      <path d={f !== null ? "M12 7.5v8m-3.5-3.5L12 15.5l3.5-3.5" : "M12 4v11m-4.5-4.5L12 15l4.5-4.5M5 20h14"} />
    </svg>
  )
}

/** A finished one lately: true for `ms` after it ended. */
function useJustDone(l: WebDownload[], ms: number) {
  const last = Math.max(0, ...l.filter((d) => d.state === "completed" && !d.agent).map((d) => d.done ?? 0))
  const [, redraw] = useState(0)
  const left = last + ms - Date.now()
  useEffect(() => {
    if (left <= 0) return
    const t = window.setTimeout(() => redraw((n) => n + 1), left + 50)
    return () => clearTimeout(t)
  }, [last, left > 0])
  return left > 0
}

/** The page bar's: there while one goes or for an hour after, as Chrome's. */
export function DownloadsButton() {
  const l = list.use()
  const done = useJustDone(l, 2500)
  if (!can() || !l.length) return null
  const on = l.some(going), last = Math.max(...l.map((d) => d.done ?? d.at))
  if (!on && Date.now() - last > BAR_MS) return null
  const f = overall(l)
  const label = on ? `Downloads: ${f !== null && f >= 0 ? `${Math.round(f * 100)}%` : "downloading"}` : "Downloads"
  return (
    <button type="button" aria-label={label} aria-haspopup="menu" data-tip={label} data-web-downloads={on ? "going" : done ? "done" : "idle"}
      onClick={(e) => showDownloads(e.currentTarget)}
      className={cn("grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] hover:bg-foreground/[0.06] hover:text-foreground",
        on || done ? "text-foreground" : "text-muted-foreground")}>
      {done && !on ? <Check className="size-4 text-primary" strokeWidth={2.25} /> : <Ring className="size-4" />}
    </button>
  )
}

/** The status bar's: while one goes ("Block.dmg 45%"), and a moment after one ends, whatever's open (the page bar
 *  hidden, the tab it came from closed). */
export function DownloadsChip() {
  const l = list.use()
  const done = useJustDone(l, DONE_MS)
  const on = l.filter((d) => going(d) && !d.agent)
  if (!can() || (!on.length && !done)) return null
  const f = overall(on)
  const name = on.length === 1 ? on[0].name : on.length ? `${on.length} downloads` : l.find((d) => d.state === "completed")?.name ?? ""
  const text = on.length ? `${name}${f !== null && f >= 0 ? ` ${Math.round(f * 100)}%` : ""}` : name
  const tip = on.length ? `Downloading ${name}` : `Downloaded ${name}`
  return (
    <span data-ambient-downloads={on.length ? "going" : "done"} className="contents">
      <AmbientButton icon={on.length ? Ring : Check} tint={on.length ? undefined : "var(--primary)"} text={text} tip={tip} onClick={() => showDownloads()} />
    </span>
  )
}
