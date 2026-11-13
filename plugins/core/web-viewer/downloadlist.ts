import { AlertCircle, ArrowDown, Ban, Check, Copy, Eraser, ExternalLink, FolderOpen, Pause, Play, RotateCw, Trash2, X } from "lucide-react"
import { copyText, menuShowing, openMenu, replaceMenu, showLabel, type MenuItem, type WebDownload } from "@vaultite"
import { act, cancelledHere, going, list, seen } from "./downloads"


const UNITS = ["bytes", "KB", "MB", "GB", "TB"]
const unitOf = (n: number) => { let u = 0; while (n >= 1000 && u < UNITS.length - 1) { n /= 1000; u++ } return u }
const inUnit = (n: number, u: number) => { const v = n / 1000 ** u; return u === 0 ? String(Math.round(v)) : v < 10 ? v.toFixed(1).replace(/\.0$/, "") : String(Math.round(v)) }
const sizeText = (n: number) => { const u = unitOf(n); return `${inUnit(n, u)} ${UNITS[u]}` }
const leftText = (s: number) => s < 60 ? `${Math.max(1, Math.round(s / 5) * 5)} s left` : s < 3600 ? `${Math.round(s / 60)} min left` : `${Math.round(s / 360) / 10} h left`

function statusText(d: WebDownload) {
  if (d.state === "completed") return d.gone ? "Moved or deleted" : sizeText(d.total || d.received)
  if (d.state === "cancelled") return "Cancelled"
  if (d.state === "interrupted") return "Failed"
  const u = unitOf(d.total || d.received)
  const far = d.total ? `${inUnit(d.received, u)} of ${sizeText(d.total)}` : sizeText(d.received)
  if (d.state === "paused") return `Paused, ${far}`
  const r = seen.get(d.id)?.rate ?? 0
  return d.total && r > 0 ? `${far}, ${leftText((d.total - d.received) / r)}` : far
}
const fraction = (d: WebDownload) => (d.total ? d.received / d.total : -1)

const copyLink = (d: WebDownload): MenuItem => ({ label: "Copy download link", icon: Copy, run: () => void copyText(d.url) })
const forget = (d: WebDownload): MenuItem => ({ label: "Remove from list", icon: Trash2, sep: true, run: () => void act(d.id, "forget", "Couldn't remove it from the list") })
const retry = (d: WebDownload): MenuItem => ({ label: d.resumable ? "Resume" : "Download again", icon: RotateCw,
  run: () => void act(d.id, d.resumable ? "resume" : "retry", `Couldn't download ${d.name} again`) })

function rowOf(d: WebDownload): MenuItem {
  const base = { label: d.name, hint: statusText(d) }
  if (going(d)) {
    const paused = d.state === "paused"
    return { ...base, icon: paused ? Pause : ArrowDown, progress: fraction(d), run: () => {}, items: [
      paused ? { label: "Resume", icon: Play, run: () => void act(d.id, "resume", `Couldn't resume ${d.name}`) }
        : { label: "Pause", icon: Pause, run: () => void act(d.id, "pause", `Couldn't pause ${d.name}`) },
      { label: "Cancel download", icon: X, run: () => { cancelledHere.add(d.id); void act(d.id, "cancel", `Couldn't cancel ${d.name}`) } },
      copyLink(d),
    ] }
  }
  if (d.state === "completed" && !d.gone) {
    const open = () => void act(d.id, "open", `Couldn't open ${d.name}`)
    return { ...base, icon: Check, split: true, run: open, items: [
      { label: "Open", icon: ExternalLink, run: open },
      { label: showLabel, icon: FolderOpen, run: () => void act(d.id, "show", `Couldn't show ${d.name}`) },
      copyLink(d), forget(d),
    ] }
  }
  const r = retry(d)
  return { ...base, icon: d.state === "cancelled" ? Ban : d.gone ? Trash2 : AlertCircle, split: true, run: r.run, items: [r, copyLink(d), forget(d)] }
}

function rows(): MenuItem[] {
  const l = list.get()
  return [
    ...(l.length ? l.slice(0, 10).map(rowOf) : [{ caption: true, label: "Nothing downloaded yet. What pages download goes to your Downloads folder.", run: () => {} }]),
    { label: "Open Downloads folder", icon: FolderOpen, sep: true, run: () => void act(null, "folder", "Couldn't open the Downloads folder") },
    ...(l.some((d) => !going(d)) ? [{ label: "Clear list", icon: Eraser, run: () => void act(null, "clear", "Couldn't clear the list") }] : []),
  ]
}

let showing: MenuItem[] | null = null, watching = false
function watch() {
  if (watching) return
  watching = true
  list.subscribe(() => {
    if (!showing) return
    if (!menuShowing()) { showing = null; return }
    const next = rows()
    replaceMenu(showing, next)
    showing = next
  })
}

const visible = (el: HTMLElement | null) => !!el && el.getClientRects().length > 0

export function showDownloads(from?: HTMLElement) {
  watch()
  const items = rows()
  const bar = from ?? [...document.querySelectorAll<HTMLElement>("[data-pane-focused] [data-web-downloads], [data-web-downloads]")].find(visible)
  const status = from ? null : document.querySelector<HTMLElement>("[data-ambient-downloads] button")
  if (bar && visible(bar)) { const r = bar.getBoundingClientRect(); openMenu({ x: r.right - 300, y: r.bottom + 4, flip: r.top - 4 }, items) }
  else if (status && visible(status)) { const r = status.getBoundingClientRect(); openMenu({ x: r.left, y: r.top - 4, flip: r.bottom + 4 }, items, true) }
  else openMenu({ x: innerWidth - 320, y: innerHeight - 72 }, items, true)
  showing = items
}

