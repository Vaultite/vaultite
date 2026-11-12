import { activePane, getWorkspace } from "@/core/workspace"
import { allPanes } from "../../../core/layout.ts"
import { phoneApp } from "@/core/phoneapp"
import { signal } from "@/core/signal"

type Shot = { to: string; url: string }
const shots = new Map<string, Shot>()
const subs = signal()
const changed = () => subs.notify()
const CACHE = "vaultite-tab-shots"
const key = (id: string) => new URL(`__tab-shot/${encodeURIComponent(id)}`, location.href).href
const QUALITY = 0.82
const WAIT = 250

let off = !phoneApp
const openCache = () => (typeof caches === "undefined" ? Promise.reject(new Error("no Cache API")) : caches.open(CACHE))

let loaded = false
function load() {
  if (loaded || off) return
  loaded = true
  openCache().then(async (c) => {
    const open = openIds()
    for (const req of await c.keys()) {
      const id = decodeURIComponent(req.url.split("/__tab-shot/")[1] ?? "")
      if (!open.has(id)) { void c.delete(req); continue }
      const res = await c.match(req)
      const to = res?.headers.get("X-Tab-To")
      if (!res || to === null || to === undefined || shots.has(id)) continue
      shots.set(id, { to, url: URL.createObjectURL(await res.blob()) })
    }
    changed()
  }).catch(() => { /* no cache here: pictures last while the app runs */ })
}

const openIds = () => { const w = getWorkspace(); return new Set([w, ...(w.windows ?? [])].flatMap(allPanes).map((p) => p.id)) }

let taking: { id: string; to: string; at: number; done: Promise<void> } | null = null

export function shootTab(): Promise<void> {
  if (off) return Promise.resolve()
  const pane = activePane()
  if (!pane || document.querySelector("dialog[open]")) return Promise.resolve()
  const top = document.querySelector("[data-phone-header]")?.getBoundingClientRect().bottom ?? 0
  const bottom = document.querySelector("[data-phone-bar]")?.getBoundingClientRect().top ?? innerHeight
  if (bottom - top < 40) return Promise.resolve()
  if (taking && taking.id === pane.id && taking.to === pane.to && performance.now() - taking.at < 600) return capped(taking.done)
  const done = phoneApp!.snapshot({ x: 0, y: top, width: innerWidth, height: bottom - top, scaled: innerWidth, quality: QUALITY })
    .then(async ({ url }) => {
      const blob = await (await fetch(url)).blob()
      const was = shots.get(pane.id), own = URL.createObjectURL(blob)
      const img = new Image()
      img.src = own
      await img.decode().catch(() => {})
      if (was) URL.revokeObjectURL(was.url)
      shots.set(pane.id, { to: pane.to, url: own })
      forgetClosed()
      changed()
      openCache().then((c) => c.put(key(pane.id), new Response(blob, { headers: { "Content-Type": "image/jpeg", "X-Tab-To": pane.to } }))).catch(() => {})
    })
    .catch((e: unknown) => {
      if (/not implemented|unimplemented/i.test(String(e))) off = true
    })
  taking = { id: pane.id, to: pane.to, at: performance.now(), done }
  return capped(done)
}
const capped = (p: Promise<void>) => Promise.race([p, new Promise<void>((r) => setTimeout(r, WAIT))])

export function shotOf(id: string, to: string): string | null {
  const s = shots.get(id)
  return s && s.to === to ? s.url : null
}

function forgetClosed() {
  const open = openIds()
  for (const [id, s] of shots) {
    if (open.has(id)) continue
    URL.revokeObjectURL(s.url)
    shots.delete(id)
    openCache().then((c) => c.delete(key(id))).catch(() => {})
  }
}

export function useTabShot(id: string, to: string): string | null {
  load()
  const s = subs.use(() => shots.get(id))
  return s && s.to === to ? s.url : null
}
