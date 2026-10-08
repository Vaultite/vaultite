// The iPhone app's real picture of each tab for its card, taken by the shell as the tab is left (only the shown tab
// is drawn), kept in the Cache API. Without the shell's `snapshot`, cards are drawn stand-ins.
import { activeTab, getWorkspace } from "@/core/workspace"
import { leaves } from "@/core/layout"
import { phoneApp } from "@/core/phoneapp"
import { signal } from "@/core/signal"

type Shot = { to: string; url: string }
const shots = new Map<string, Shot>()
const subs = signal()
const changed = () => subs.notify()
const CACHE = "vaultite-tab-shots"
const key = (id: string) => new URL(`__tab-shot/${encodeURIComponent(id)}`, location.href).href
/** How wide a picture is, in points: sharp enough on a card (about half the screen) and as it grows to the page. */
const WIDTH = 300
/** The longest a tab change waits for its picture (ms): the shell answers in a frame or two. */
const WAIT = 250

let off = !phoneApp
const openCache = () => (typeof caches === "undefined" ? Promise.reject(new Error("no Cache API")) : caches.open(CACHE))

// The pictures kept from before (the app was closed, or reloaded), loaded once.
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

const openIds = () => new Set(leaves(getWorkspace().root).flatMap((g) => g.tabs.map((t) => t.id)))

/** Take a picture of the tab on screen (resolves when it's kept, or after WAIT at most; never rejects). */
export function shootTab(): Promise<void> {
  if (off) return Promise.resolve()
  const tab = activeTab()
  if (!tab || tab.to === "new" || document.querySelector("dialog[open]")) return Promise.resolve()
  const top = document.querySelector("[data-phone-header]")?.getBoundingClientRect().bottom ?? 0
  const bottom = document.querySelector("[data-phone-bar]")?.getBoundingClientRect().top ?? innerHeight
  if (bottom - top < 40) return Promise.resolve()
  const taking = phoneApp!.snapshot({ x: 0, y: top, width: innerWidth, height: bottom - top, scaled: WIDTH, quality: 0.65 })
    .then(async ({ url }) => {
      const blob = await (await fetch(url)).blob()
      const was = shots.get(tab.id)
      if (was) URL.revokeObjectURL(was.url)
      shots.set(tab.id, { to: tab.to, url: URL.createObjectURL(blob) })
      forgetClosed()
      changed()
      openCache().then((c) => c.put(key(tab.id), new Response(blob, { headers: { "Content-Type": "image/jpeg", "X-Tab-To": tab.to } }))).catch(() => {})
    })
    .catch((e: unknown) => {
      // An app built before it could: stop asking.
      if (/not implemented|unimplemented/i.test(String(e))) off = true
    })
  return Promise.race([taking, new Promise<void>((r) => setTimeout(r, WAIT))])
}

/** Pictures of tabs that have closed go. */
function forgetClosed() {
  const open = openIds()
  for (const [id, s] of shots) {
    if (open.has(id)) continue
    URL.revokeObjectURL(s.url)
    shots.delete(id)
    openCache().then((c) => c.delete(key(id))).catch(() => {})
  }
}

/** The picture of a tab, while it still shows what it showed then (else null: draw the stand-in). */
export function useTabShot(id: string, to: string): string | null {
  load()
  const s = subs.use(() => shots.get(id))
  return s && s.to === to ? s.url : null
}
