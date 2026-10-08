// Live updates: one WebSocket (/api/events) says which files changed, moved, or what an agent asks the window to do.
// It reconnects with backoff (refreshing once after a gap), holds changes while hidden, and offers a reload on a new build.
import { useEffect, useRef } from "react"
import { notify } from "@/core/notify"

/** Changed vault paths (a folder: anything in it), or null: anything may have changed. */
export type Paths = string[] | null
type Fn = (paths: Paths) => void

const subs = new Set<Fn>()
/** This page's build: its entry script's name (in development there's none). */
const BUILD = import.meta.env.PROD
  ? document.querySelector<HTMLScriptElement>("script[type=module][src]")?.src.split("/").pop() ?? null : null
const PING = 25_000, POLL = 10_000, LOST = 10_000

export function onVaultChange(fn: Fn) {
  subs.add(fn)
  return () => { subs.delete(fn) }
}

const moveSubs = new Set<(from: string, to: string | null) => void>()
/** A file or folder moved or renamed through the API (by this app, another device, an AI): fn(from, to); to null:
 *  trashed. */
export function onVaultMove(fn: (from: string, to: string | null) => void) {
  moveSubs.add(fn)
  return () => { moveSubs.delete(fn) }
}

/** Run fn when these paths change, or a folder they're in (or anything, when paths is omitted); a folder's files need a
 *  predicate, `(p) => p.startsWith("dir/")`. fn is always the latest one. */
export function useVaultChange(fn: Fn, paths?: string[] | ((p: string) => boolean)) {
  const ref = useRef({ fn, paths })
  ref.current = { fn, paths }
  useEffect(() => onVaultChange((changed) => {
    const { fn, paths } = ref.current
    if (!paths || changed === null) return fn(changed)
    const hit = changed.filter((c) => (typeof paths === "function" ? paths(c) : paths.some((p) => touches([c], p))))
    if (hit.length) fn(hit)
  }), [])
}

/** Does this change touch `path` (the file itself, or a folder it's in)? */
export const touches = (paths: Paths, path: string) => paths === null || paths.some((p) => p === path || path.startsWith(p + "/"))

function emit(paths: Paths) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return hold(paths)
  for (const fn of [...subs]) {
    try { fn(paths) } catch (e) { console.error(e) }
  }
}

// While the page is hidden (another tab in front, the phone locked, the window minimized), changes wait, merged, and
// are told once when it's shown again: nothing refetches or redraws for a page nobody sees.
let held: Paths | undefined
function hold(paths: Paths) {
  held = held === undefined ? paths : held === null || paths === null ? null : [...new Set([...held, ...paths])]
  if (held && held.length > 500) held = null
}
function release() {
  if (held === undefined) return
  const paths = held
  held = undefined
  emit(paths)
}

/** Something an agent asked this window to do (server.ts /api/ui): open a path, run a command or notify. The handler
 *  answers false for a command it couldn't run. */
export type UiAction = { action: string; path?: string; split?: "right" | "down" | null; newTab?: boolean; id?: string; rid?: string
  text?: string; kind?: "error" | null; button?: { label: string; open: string } | null }
let uiHandler: ((m: UiAction) => unknown) | null = null
export const onUiAction = (fn: (m: UiAction) => unknown) => { uiHandler = fn }
/** What the server asks this window for, by action (its commands, the dev tools: core/dev.ts): the result, sent back as
 *  the answer (an error's message if it throws). */
const askers = new Map<string, (m: Record<string, unknown>) => unknown>()
export const answerUi = (action: string, fn: (m: Record<string, unknown>) => unknown) => { askers.set(action, fn) }

/** Tell the server this window is the one in use (so `ui` messages come here). */
let said = 0
const sayActive = (e?: Event) => {
  if (e?.type === "pointerdown" && Date.now() - said < 300) return // a double click
  if (ws?.readyState !== WebSocket.OPEN) return
  said = Date.now()
  ws.send(JSON.stringify({ type: "active", answers: true, ...windowState() }))
}
/** What the window says about itself with `active` (the current workspace), set by the app: the server answers it to
 *  `vau` (GET /api/ui), so an agent changes the workspace the user is looking at. */
let windowState: () => Record<string, unknown> = () => ({})
export const setWindowState = (fn: () => Record<string, unknown>) => { windowState = fn }
/** Say it again now (the workspace changed), if this window has the focus. */
export const sayWindowState = () => { if (document.hasFocus()) { said = 0; sayActive() } }

// ---------- the connection ----------
let ws: WebSocket | null = null
let seen: string | null = null // the server's "<boot>:<version>" last heard
let last = 0                  // when it last said anything (pings come every 25 s)
let tries = 0
let retry: ReturnType<typeof setTimeout> | null = null
let poll: ReturnType<typeof setInterval> | null = null
let started = false
let down: number | null = null // since when the connection's been lost while the page was in view

/** While disconnected: check everything now and then. */
const startPoll = () => { poll ??= setInterval(() => document.visibilityState === "visible" && emit(null), POLL) }

function connect() {
  if (retry) { clearTimeout(retry); retry = null }
  if (ws) return
  const url = new URL("api/events", location.href)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  const s = new WebSocket(url)
  ws = s
  last = Date.now()
  s.onmessage = (e) => {
    last = Date.now()
    let m: { type?: string; v?: string; web?: string; paths?: Paths; from?: string; to?: string | null } & Partial<UiAction>
    try { m = JSON.parse(String(e.data)) } catch { return }
    if (m.type === "hello") {
      tries = 0
      if (poll) { clearInterval(poll); poll = null }
      if (down !== null && Date.now() - down > LOST) notify("Reconnected", { id: "live" })
      down = null
      if (seen !== null && m.v !== seen) emit(null) // missed something while away
      seen = m.v ?? null
      if (m.web && BUILD && m.web !== BUILD)
        notify("A new version of Vaultite is ready", { id: "update", duration: Infinity, action: { label: "Reload", run: () => location.reload() } })
    } else if (m.type === "change") {
      seen = m.v ?? seen
      emit(m.paths ?? null)
    } else if (m.type === "moved" && m.from) {
      for (const fn of [...moveSubs]) { try { fn(m.from, m.to ?? null) } catch (e) { console.error(e) } }
    } else if (m.type === "ui" && m.action && askers.has(m.action)) {
      const reply = (a: object) => {
        let text: string
        try { text = JSON.stringify({ type: "ui-done", rid: m.rid, ...a }) } catch (e) { text = JSON.stringify({ type: "ui-done", rid: m.rid, ran: false, error: `the answer isn't JSON (${(e as Error).message})` }) }
        if (s.readyState === WebSocket.OPEN) s.send(text)
      }
      Promise.resolve().then(() => askers.get(m.action!)!(m as Record<string, unknown>))
        .then((result) => reply({ ran: true, result }), (e) => reply({ ran: false, error: e instanceof Error ? e.message : String(e) }))
    } else if (m.type === "ui" && m.action) {
      let ran = true
      try { ran = uiHandler?.(m as UiAction) !== false } catch (e) { console.error(e) }
      if (m.rid) s.send(JSON.stringify({ type: "ui-done", rid: m.rid, ran }))
    }
  }
  s.onopen = () => {
    s.send(JSON.stringify({ type: "caps", answers: true })) // it answers asks, focused or not
    if (document.hasFocus()) sayActive()
  }
  s.onclose = () => {
    if (ws !== s) return
    ws = null
    if (document.visibilityState === "visible") down ??= Date.now()
    startPoll()
    retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++))
  }
}

/** Drop a connection that went quiet (a phone waking up keeps a dead one "open") and connect again now. */
function revive() {
  if (ws && Date.now() - last < PING + 10_000) return
  if (ws) { const s = ws; ws = null; s.onclose = null; s.close(); startPoll(); down = null } // asleep, not lost
  tries = 0
  connect()
}

/** Start listening (once, from the store). */
export function startLive() {
  if (started || typeof WebSocket === "undefined") return
  started = true
  connect()
  document.addEventListener("visibilitychange", () => {
    // Only time in view counts as lost: back in view while still down, it counts from now.
    if (document.visibilityState === "visible") { if (!ws || ws.readyState !== WebSocket.OPEN) down = Date.now(); release(); revive() }
    else down = null
  })
  addEventListener("online", revive)
  addEventListener("pageshow", revive)
  addEventListener("focus", sayActive)
  addEventListener("pointerdown", sayActive, { capture: true, passive: true })
  setInterval(() => document.visibilityState === "visible" && revive(), PING)
}

// ---------- writes on their way ---------- A
// refresh started before one of this app's writes landed would flash old data (a tick undone, then back): it's dropped.
let writing = 0
let edits = 0
const idle = new Set<() => void>()

/** A write to the vault (or an optimistic change): counted until it settles. */
export function tracked<T>(p: Promise<T>): Promise<T> {
  writing++
  edits++
  let over = false
  const done = () => {
    if (over) return
    over = true
    clearTimeout(late)
    edits++
    if (--writing === 0) for (const f of [...idle]) { idle.delete(f); f() }
  }
  // (one that never settles stops counting after a minute, or refreshes would wait on it for good)
  const late = setTimeout(done, 60_000)
  p.then(done, done)
  return p
}

/** Something changed locally (mutate): a refresh started before it is stale. */
export const edited = () => { edits++ }
export const editCount = () => edits
/** Resolves when no write is on its way. */
export const settled = () => (writing ? new Promise<void>((r) => idle.add(r)) : Promise.resolve())
