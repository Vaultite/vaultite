// Player: where you stopped in each audio or video file (.vaultite/plugins/player/places.json, so every device picks
// up where another left off), and the queue block's text.
import { bullets, Plugin, section } from "../../../core/plugins.ts"
import { isArchived, str, type Item } from "../../../core/vault.ts"
import { leftText, shelfOf, type Place, type Shelf } from "./shelves.ts"

export const plugin = new Plugin(import.meta.url)

const MAX = 500
const places = () => (plugin.settings({}, "places").places ?? {}) as Record<string, Place>
function save(all: Record<string, Place>) {
  const kept = Object.entries(all).sort((a, b) => b[1].at - a[1].at).slice(0, MAX)
  plugin.saveSettings(kept.length ? { places: Object.fromEntries(kept) } : null, "places")
}

plugin.route("GET", "player/places", () => ({ places: places() }))

// The app's own: a place as it plays (on pause, every so often, on leaving), or `done` set by hand.
plugin.route("PUT", "player/places", (req) => {
  const { path, t, d, done } = req.body as { path?: string; t?: number; d?: number; done?: boolean }
  if (!path || typeof path !== "string") return { ok: false }
  const all = { ...places() }
  const was = all[path]
  const len = Number.isFinite(d) && d! > 0 ? d! : was?.d
  const at = Number.isFinite(t) ? Math.max(0, t!) : was?.t ?? 0
  // The last bit (credits, a sign-off) counts as finished; starting over un-finishes it.
  const finished = done ?? (len ? at >= len - Math.min(30, len * 0.05) : was?.done)
  all[path] = { t: finished && done === undefined ? 0 : at, ...(len ? { d: Math.round(len) } : {}), at: Date.now(), ...(finished ? { done: true } : {}) }
  save(all)
  return { place: all[path] }
})

plugin.onMove((from, to) => {
  const all = places()
  if (!all[from]) return
  const next = { ...all }
  if (to) next[to] = next[from]
  delete next[from]
  save(next)
})

const LABEL: Record<Shelf, string> = { watch: "Watch", listen: "Listen", read: "Read" }

plugin.block("queue", (ctx) => {
  const show = str(ctx.options.show) || "all"
  const all = places()
  const items = plugin.vault.items("inbox").filter((r) => r.status === "new" && !isArchived(r))
    .map((r) => ({ r, s: shelfOf({ body: str(r.body), source: str(r.source), from: str(r.from) }) }))
    .filter((x): x is { r: Item; s: NonNullable<ReturnType<typeof shelfOf>> } => !!x.s && (show === "all" || x.s.shelf === show))
  ctx.source(items.map((x) => x.r))
  const line = ({ r, s }: (typeof items)[number]) => {
    const path = s.media ? plugin.vault.resolveLink(s.media, `${r.id}.md`) : null
    const left = path ? leftText(all[path]) : ""
    return `[[${r.id}|${r.title}]]${left ? ` (${left})` : ""}`
  }
  const shelves = (["watch", "listen", "read"] as Shelf[]).filter((k) => show === "all" || show === k)
  const parts = shelves.map((k) => [k, items.filter((x) => x.s.shelf === k)] as const).filter(([, xs]) => xs.length)
    .map(([k, xs]) => `${LABEL[k]}:\n${bullets(xs.map(line))}`)
  return section("Queue", ...(parts.length ? parts : ["_Nothing waiting._"]))
})
