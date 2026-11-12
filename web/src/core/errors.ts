import { onActivity } from "@/core/activity"
import { BUILD, offerNewBuild } from "@/core/builds"
import { safeToReload } from "@/core/unsaved"

export type AppError = {
  t: number
  /** uncaught, rejection, boundary (a block or view failed), stopped (the app unmounted), boot (before it started), stale
   *  (an old build's file: reloaded), shown (told in plain words: notifyError), plugin (a vault plugin couldn't start). */
  kind: "uncaught" | "rejection" | "boundary" | "stopped" | "boot" | "stale" | "shown" | "plugin"
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

const KEY = "vaultite.errors"
const MAX = 20
const RELOADED = "vaultite.reloadedForBuild"

// Benign or empty: a ResizeObserver that didn't finish in a frame, a cross-origin script's opaque "Script error."
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

function textOf(e: unknown): string {
  if (e instanceof Error) return `${e.name && e.name !== "Error" ? `${e.name}: ` : ""}${e.message}`
  if (typeof e !== "object" || e === null) return String(e)
  // Not an Error (an Event, a DOMException-like object): JSON would say "{}".
  const o = e as { name?: unknown; message?: unknown; type?: unknown; target?: unknown }
  const str = (v: unknown) => (typeof v === "string" ? v : "")
  const kind = str(o.name) || (e.constructor?.name !== "Object" ? str(e.constructor?.name) : "")
  const el = o.target instanceof Element ? o.target as HTMLScriptElement : null
  const said = [str(o.message), str(o.type) && `${o.type} event`, el && `<${el.tagName.toLowerCase()}${el.src ? ` ${el.src}` : ""}>`].filter(Boolean)
  if (kind || said.length) return `${kind || "Object"}${said.length ? `: ${said.join(", ")}` : ""}`
  try { const json = JSON.stringify(e); return json === "{}" ? "An empty object (not an Error)" : json } catch { return String(e) }
}

let minute = 0, inMinute = 0
export function noteAppError(kind: AppError["kind"], error: unknown, extra: { component?: string; fatal?: boolean } = {}) {
  try {
    const message = (textOf(error) || "(an empty error)").split("\n")[0].slice(0, 500)
    if (NOISE.test(message)) return
    const now = Date.now()
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

export const isStaleBuild = (error: unknown) => STALE.test(textOf(error))

async function serverBuild(): Promise<string | null> {
  try {
    const html = await (await fetch("./", { cache: "no-store", signal: AbortSignal.timeout(3000) })).text()
    return /<script type="module"[^>]*\ssrc="[^"]*\/([^"/]+\.js)"/.exec(html)?.[1] ?? ""
  } catch { return null }
}
// The browser's message: "…dynamically imported module: http://…/AppTab-C-zI.js".
const fileIn = (error: unknown) => /\bhttps?:\/\/[^\s"')]+\.(?:m?js|css)\b/.exec(textOf(error))?.[0]
const loads = async (url: string) => {
  try { return (await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(3000) })).ok } catch { return false }
}
function mayReload() {
  try {
    if (Date.now() - (Number(sessionStorage.getItem(RELOADED)) || 0) < 60_000) return false
    sessionStorage.setItem(RELOADED, String(Date.now()))
    return true
  } catch { return false }
}

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
        if (!safeToReload()) { done(); offerNewBuild(); return false }
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
export function startAppErrors() {
  if (started) return
  started = true
  // Checked once every listener ran: a plugin takes one as its own by calling preventDefault().
  addEventListener("error", (e) => {
    if (e.target && e.target !== window) return // a resource that didn't load (an image): not the app's error
    setTimeout(() => { if (!e.defaultPrevented) noteAppError("uncaught", e.error ?? e.message) })
  })
  addEventListener("unhandledrejection", (e) => setTimeout(() => { if (!e.defaultPrevented) noteAppError("rejection", e.reason) }))
  // Vite's event for a lazy chunk's failed preload, before the import throws.
  addEventListener("vite:preloadError", (e) => { void recoverFromStaleBuild((e as Event & { payload?: unknown }).payload) })
  onActivity((n) => { trail.push(n.text.slice(0, 120)); if (trail.length > 8) trail.shift() })
}
