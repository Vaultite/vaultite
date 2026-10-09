// The app's errors, queued for the Errors plugin (localStorage: one that stopped the app is sent after the reload), heard
// in the core since the worst take the plugins down. A chunk that didn't load reloads once the server answers, when
// nothing is lost by it (unsaved.ts), else offers Reload.
import { onActivity } from "@/core/activity"
import { notify } from "@/core/notify"
import { safeToReload } from "@/core/unsaved"

export type AppError = {
  t: number
  /** How it was heard: uncaught, rejection, boundary (one block or view failed), stopped (it unmounted the app), boot
   *  (before the app started), stale (a file of the app didn't load: reloaded once the server answered). */
  kind: "uncaught" | "rejection" | "boundary" | "stopped" | "boot" | "stale"
  message: string
  stack?: string
  /** React's component stack (a boundary's error, one that stopped the app). */
  component?: string
  /** It stopped the app. */
  fatal?: boolean
  /** Where the app was (its address) and which build it ran (its entry script's name). */
  url: string
  build?: string
  /** The last things the user did before it (commands, drops: core/activity.ts), oldest first. */
  trail?: string[]
}

const KEY = "vaultite.errors" // the queue (index.html writes it too)
const MAX = 20
const RELOADED = "vaultite.reloadedForBuild"

/** Benign or empty: a ResizeObserver that didn't finish in a frame, a cross-origin script's opaque "Script error.". */
const NOISE = /^(ResizeObserver loop|Script error\.?$)/
const STALE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|Loading (CSS )?chunk \S+ failed/i

let queue: AppError[] = read()
const subs = new Set<() => void>()
const trail: string[] = []

function read(): AppError[] {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "[]"); return Array.isArray(v) ? v.slice(-MAX) : [] } catch { return [] }
}
function save() {
  try { if (queue.length) localStorage.setItem(KEY, JSON.stringify(queue)); else localStorage.removeItem(KEY) } catch { /* private mode, full: memory only */ }
}

/** This page's build: its entry script's file name (named by content). */
const BUILD = (() => {
  try {
    const src = (document.querySelector('script[type="module"][src*="assets/"]') as HTMLScriptElement | null)?.src
    return src ? src.slice(src.lastIndexOf("/") + 1) : undefined
  } catch { return undefined }
})()

const textOf = (e: unknown) => (e instanceof Error ? `${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message}` : typeof e === "string" ? e : (() => { try { return JSON.stringify(e) ?? String(e) } catch { return String(e) } })())

let minute = 0, inMinute = 0
/** An error the app had. `extra`: React's component stack, `fatal`. Never throws. */
export function noteAppError(kind: AppError["kind"], error: unknown, extra: { component?: string; fatal?: boolean } = {}) {
  try {
    const message = (textOf(error) || "(an empty error)").split("\n")[0].slice(0, 500)
    if (NOISE.test(message)) return
    const now = Date.now()
    // A loop (an error every frame) is a few, not thousands: 30 a minute at most, and the same one again within 2 s once.
    if (now - minute > 60_000) { minute = now; inMinute = 0 }
    if (++inMinute > 30) return
    const last = queue[queue.length - 1]
    if (last && last.message === message && last.kind === kind && now - last.t < 2000) return
    const stack = error instanceof Error && error.stack ? error.stack.slice(0, 8000) : undefined
    queue = [...queue, { t: now, kind, message, ...(stack ? { stack } : {}), ...(extra.component ? { component: extra.component.trim().slice(0, 3000) } : {}),
      ...(extra.fatal ? { fatal: true } : {}), url: location.pathname + location.search + location.hash, ...(BUILD ? { build: BUILD } : {}),
      ...(trail.length ? { trail: [...trail] } : {}) }].slice(-MAX)
    save()
    for (const f of subs) try { f() } catch { /* a listener's problem */ }
  } catch { /* never into the app */ }
}

/** The errors waiting to be sent, oldest first; they're the caller's now (the queue is emptied). */
export function takeAppErrors(): AppError[] {
  const out = queue
  queue = []
  save()
  return out
}

/** Hear that an error is waiting (then takeAppErrors); returns how to stop. */
export const onAppError = (fn: () => void) => { subs.add(fn); return () => { subs.delete(fn) } }

/** The error is an older build's file that's gone (a chunk or its CSS that didn't load). */
export const isStaleBuild = (error: unknown) => STALE.test(textOf(error))

/** The entry script the server's index.html names now; null when the server doesn't answer. */
async function serverBuild(): Promise<string | null> {
  try {
    const html = await (await fetch("./", { cache: "no-store", signal: AbortSignal.timeout(3000) })).text()
    return /<script type="module"[^>]*\ssrc="[^"]*\/([^"/]+\.js)"/.exec(html)?.[1] ?? ""
  } catch { return null }
}
/** The file that didn't load, from the browser's message ("…dynamically imported module: http://…/AppTab-C-zI.js"). */
const fileIn = (error: unknown) => /\bhttps?:\/\/[^\s"')]+\.(?:m?js|css)\b/.exec(textOf(error))?.[0]
const loads = async (url: string) => {
  try { return (await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) })).ok } catch { return false }
}
/** Reloading for this is fine: once a minute at most (a reload that didn't fix it isn't that). */
function mayReload() {
  try {
    if (Date.now() - (Number(sessionStorage.getItem(RELOADED)) || 0) < 60_000) return false
    sessionStorage.setItem(RELOADED, String(Date.now()))
    return true
  } catch { return false }
}

/** "Reconnecting to Vaultite…" at the bottom of the window while it waits: plain DOM, as the app may be gone (it
 *  stopped), drawn only if the wait lasts. Returns how to take it down. */
function reconnecting() {
  let box: HTMLElement | null = null
  const timer = setTimeout(() => {
    box = document.createElement("div")
    box.setAttribute("role", "status")
    box.dataset.reconnecting = ""
    box.textContent = "Reconnecting to Vaultite…"
    box.style.cssText = "position: fixed; left: 50%; bottom: max(24px, env(safe-area-inset-bottom)); transform: translateX(-50%); z-index: 2147483646; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--border, GrayText); background: var(--card, Canvas); color: var(--foreground, CanvasText); font: 13px/1.4 -apple-system, system-ui, sans-serif; box-shadow: 0 8px 28px rgb(0 0 0 / 0.16)"
    document.body.append(box)
  }, 800)
  return () => { clearTimeout(timer); box?.remove() }
}

/** Reloading would lose what the user is doing: the new build is offered instead (the toast live.ts shows too). */
const newVersion = () => notify("A new version of Vaultite is ready", { id: "update", duration: Infinity, action: { label: "Reload", run: () => location.reload() } })

/** A file of the app didn't load (an older build's, or the server away): waits for the server (2 min at most), then
 *  reloads. True when it's reloading; false when reloading can't help. `say`: "Reconnecting to Vaultite…" meanwhile. */
let reloading: Promise<boolean> | null = null
export function recoverFromStaleBuild(error: unknown, say = true): Promise<boolean> {
  if (!isStaleBuild(error)) return Promise.resolve(false)
  return (reloading ??= (async () => {
    const done = say ? reconnecting() : () => {}
    const until = Date.now() + 120_000
    for (let wait = 500; ; wait = Math.min(wait * 2, 4000)) {
      const build = await serverBuild()
      if (build !== null) {
        const file = fileIn(error)
        const back = (!!BUILD && !!build && build !== BUILD) || !file || (await loads(file))
        if (!back) { done(); return false }
        // (typing, or edits not yet saved: the user reloads when they're ready)
        if (!safeToReload()) { done(); newVersion(); return false }
        if (!mayReload()) { done(); return false }
        noteAppError("stale", error)
        location.reload()
        return true
      }
      if (Date.now() > until) { done(); return false }
      await new Promise((r) => setTimeout(r, wait))
    }
  })()).then((r) => { if (!r) reloading = null; return r })
}

let started = false
/** Once, as the app starts (main.tsx): the window's errors and rejections, Vite's failed preloads, the user's trail. */
export function startAppErrors() {
  if (started) return
  started = true
  // (one a plugin takes as its own, preventDefault() in its listener, isn't the app's: asked once every listener ran)
  addEventListener("error", (e) => {
    if (e.target && e.target !== window) return // a resource that didn't load (an image): not the app's error
    setTimeout(() => { if (!e.defaultPrevented) noteAppError("uncaught", e.error ?? e.message) })
  })
  addEventListener("unhandledrejection", (e) => setTimeout(() => { if (!e.defaultPrevented) noteAppError("rejection", e.reason) }))
  // A lazy chunk's preload that failed (Vite's event, before the import throws): likely a build since gone.
  addEventListener("vite:preloadError", (e) => { void recoverFromStaleBuild((e as Event & { payload?: unknown }).payload) })
  onActivity((n) => { trail.push(n.text.slice(0, 120)); if (trail.length > 8) trail.shift() })
}
