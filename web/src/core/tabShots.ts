// The iPhone app's real picture of each pane (a card shows its tab's focused one), taken by the shell as it's left,
// kept in the Cache API. Without the shell's `snapshot`, cards are drawn stand-ins.
import { activePane, getWorkspace } from "@/core/workspace"
import { allPanes } from "../../../core/layout.ts"
import { phoneApp } from "@/core/phoneapp"
import { signal } from "@/core/signal"

type Shot = { to: string; url: string }
const shots = new Map<string, Shot>()
const subs = signal()
const changed = () => subs.notify()
const CACHE = "vaultite-tab-shots"
/** (by pane id) */
const key = (id: string) => new URL(`__tab-shot/${encodeURIComponent(id)}`, location.href).href
/** A picture is the page's own width and sharpness (at the screen's scale): a tab grows from its card to the whole
 *  screen, where a smaller or rougher one shows soft till the page replaces it. */
const QUALITY = 0.82
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

/** The panes open in this window and its pop-outs. */
const openIds = () => { const w = getWorkspace(); return new Set([w, ...(w.windows ?? [])].flatMap(allPanes).map((p) => p.id)) }

/** The picture being taken, shared by whoever asks for the same page meanwhile (the bar's press starts it). */
let taking: { id: string; to: string; at: number; done: Promise<void> } | null = null

/** Take a picture of the pane on screen (resolves when it's kept, or after WAIT at most; never rejects). */
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
      // Decoded before it's shown: the tab list zooms from it the moment it opens.
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
      // An app built before it could: stop asking.
      if (/not implemented|unimplemented/i.test(String(e))) off = true
    })
  taking = { id: pane.id, to: pane.to, at: performance.now(), done }
  return capped(done)
}
const capped = (p: Promise<void>) => Promise.race([p, new Promise<void>((r) => setTimeout(r, WAIT))])

/** Pane `id`'s picture now, if it's still of what the pane shows (`to`). */
export function shotOf(id: string, to: string): string | null {
  const s = shots.get(id)
  return s && s.to === to ? s.url : null
}

/** Pictures of panes that have closed go. */
function forgetClosed() {
  const open = openIds()
  for (const [id, s] of shots) {
    if (open.has(id)) continue
    URL.revokeObjectURL(s.url)
    shots.delete(id)
    openCache().then((c) => c.delete(key(id))).catch(() => {})
  }
}

/** The picture of pane `id`, while it still shows what it showed then (else null: draw the stand-in). */
export function useTabShot(id: string, to: string): string | null {
  load()
  const s = subs.use(() => shots.get(id))
  return s && s.to === to ? s.url : null
}
