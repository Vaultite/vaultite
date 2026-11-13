import { useEffect, useRef } from "react"
import { heardBuild } from "@/core/builds"
import { DEVICE } from "@/core/device"
import { notify } from "@/core/notify"
import { share } from "@/core/share"
import { askerOf } from "@/core/askers"
import { liveMessageOf, uiActionOf, type UiAction } from "@/core/liveMessage"
import { isNumber, isObj, isText } from "../../../core/values.ts"

export type Paths = string[] | null
type Fn = (paths: Paths) => void

const subs = new Set<Fn>()
const PING = 25_000, POLL = 10_000, LOST = 10_000

export function onVaultChange(fn: Fn) {
  subs.add(fn)
  return () => { subs.delete(fn) }
}

const moveSubs = new Set<(from: string, to: string | null) => void>()
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

type KeptFn = (names: string[] | null, state: boolean) => void
const keptSubs = new Set<KeptFn>()
export function onKeptChange(fn: KeptFn) {
  keptSubs.add(fn)
  return () => { keptSubs.delete(fn) }
}
let keptHeld: { names: string[] | null; state: boolean } | undefined
function emitKept(names: string[] | null, state: boolean) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    const h = keptHeld
    keptHeld = { names: !h ? names : h.names === null || names === null ? null : [...new Set([...h.names, ...names])], state: state || !!h?.state }
    return
  }
  for (const fn of [...keptSubs]) {
    try { fn(names, state) } catch (e) { console.error(e) }
  }
}
let keptSeen: string | null = null
let keptState: number | null = null
function heardKept(names: string[] | null, kept: string | undefined, state: number | undefined) {
  if (kept === undefined || state === undefined) return
  const stateMoved = keptState !== null && state !== keptState, moved = keptSeen !== null && kept !== keptSeen
  keptSeen = kept
  keptState = state
  if (names ? names.length : moved) emitKept(names, stateMoved)
}

const backSubs = new Set<() => void>()
export function onReconnect(fn: () => void) {
  backSubs.add(fn)
  return () => { backSubs.delete(fn) }
}

/** Does this change touch `path` (the file itself, or a folder it's in)? */
export const touches = (paths: Paths, path: string) => paths === null || paths.some((p) => p === path || path.startsWith(p + "/"))

function emit(paths: Paths) {
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return hold(paths)
  for (const fn of [...subs]) {
    try { fn(paths) } catch (e) { console.error(e) }
  }
}

let held: Paths | undefined
function hold(paths: Paths) {
  held = held === undefined ? paths : held === null || paths === null ? null : [...new Set([...held, ...paths])]
  if (held && held.length > 500) held = null
}
function release() {
  const k = keptHeld
  keptHeld = undefined
  if (k) emitKept(k.names, k.state)
  if (held === undefined) return
  const paths = held
  held = undefined
  emit(paths)
}

let uiHandler: ((m: UiAction) => unknown) | null = null
export const onUiAction = (fn: (m: UiAction) => unknown) => { uiHandler = fn }
const asking = new Map<string, AbortController>()

let said = 0
const DOUBLE_CLICK_MS = 300
const sayActive = (e?: Event) => {
  if (e?.type === "pointerdown" && Date.now() - said < DOUBLE_CLICK_MS) return
  if (ws?.readyState !== WebSocket.OPEN) return
  said = Date.now()
  ws.send(JSON.stringify({ type: "active", answers: true, ...windowState() }))
}
let windowState: () => Record<string, unknown> = () => ({})
export const setWindowState = (fn: () => Record<string, unknown>) => { windowState = fn }
export const sayWindowState = () => { if (document.hasFocus()) { said = 0; sayActive() } }

let ws: WebSocket | null = null
let seen: string | null = null
let heard: string | null = null
let lastHeard = 0
let tries = 0
let retry: ReturnType<typeof setTimeout> | null = null
let poll: ReturnType<typeof setInterval> | null = null
let started = false
let downSince: number | null = null

const startPoll = () => { poll ??= setInterval(() => document.visibilityState === "visible" && emit(null), POLL) }

function connect() {
  if (retry) { clearTimeout(retry); retry = null }
  if (ws) return
  const url = new URL("api/events", location.href)
  if (heard) url.searchParams.set("at", heard)
  if (DEVICE) url.searchParams.set("device", DEVICE)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  const s = new WebSocket(url)
  ws = s
  lastHeard = Date.now()
  s.onmessage = (e) => {
    lastHeard = Date.now()
    let raw: unknown
    try { raw = JSON.parse(String(e.data)) } catch { return }
    if (!isObj(raw)) return
    const m = liveMessageOf(raw)
    if (m.type === "hello") {
      tries = 0
      if (poll) { clearInterval(poll); poll = null }
      if (downSince !== null && Date.now() - downSince > LOST) notify("Reconnected", { id: "live" })
      downSince = null
      if (heard && m.paths !== undefined) { if (m.paths === null || m.paths.length) emit(m.paths) }
      else if (seen !== null && m.v !== seen) emit(null)
      seen = m.v ?? null
      heard = m.at ?? null
      heardKept(null, m.kept, m.state)
      for (const fn of [...backSubs]) { try { fn() } catch (e) { console.error(e) } }
      if (share && m.role && m.role !== share.role)
        notify(m.role === "read" ? "You can now only view this folder" : m.role === "edit" ? "You can now edit this folder" : "You can now comment in this folder", { id: "share-role", duration: Infinity, action: { label: "Reload", run: () => location.reload() } })
      heardBuild(m.web)
    } else if (m.type === "web") {
      heardBuild(m.web)
    } else if (m.type === "change") {
      seen = m.v ?? seen
      heard = m.at ?? heard
      emit(m.paths ?? null)
    } else if (m.type === "kept" && Array.isArray(m.names)) {
      heardKept(m.names, m.kept, m.state)
    } else if (m.type === "moved" && m.from) {
      for (const fn of [...moveSubs]) { try { fn(m.from, m.to ?? null) } catch (e) { console.error(e) } }
    } else if (m.type === "ui" && m.action === "ask-end") {
      if (m.rid) asking.get(m.rid)?.abort()
    } else if (m.type === "ui" && m.action && askerOf(m.action)) {
      const asker = askerOf(m.action)
      const ended = new AbortController()
      if (m.rid) asking.set(m.rid, ended)
      const reply = (a: object) => {
        if (m.rid) asking.delete(m.rid)
        let text: string
        try { text = JSON.stringify({ type: "ui-done", rid: m.rid, ...a }) } catch (e) { text = JSON.stringify({ type: "ui-done", rid: m.rid, ran: false, error: `the answer isn't JSON (${e instanceof Error ? e.message : String(e)})` }) }
        if (s.readyState === WebSocket.OPEN) s.send(text)
      }
      Promise.resolve().then(() => asker?.(m.raw, ended.signal))
        .then((result) => reply({ ran: true, result }), (e) => reply({ ran: false, error: e instanceof Error ? e.message : String(e) }))
    } else if (m.type === "ui" && m.action) {
      let r: unknown = true
      try { r = uiHandler?.(uiActionOf(m.raw, m.action)) } catch (e) { r = Promise.reject(e) }
      void Promise.resolve(r).then((v) => {
        if (!m.rid) return
        const notices = isObj(v) && Array.isArray(v.notices) ? v.notices : undefined
        s.send(JSON.stringify({ type: "ui-done", rid: m.rid, ran: v !== false, ...(notices?.length ? { notices } : {}) }))
      }, (e) => {
        console.error(e)
        if (m.rid) s.send(JSON.stringify({ type: "ui-done", rid: m.rid, ran: false, error: e instanceof Error ? e.message : String(e) }))
      })
    }
  }
  s.onopen = () => {
    s.send(JSON.stringify({ type: "caps", answers: true }))
    if (document.hasFocus()) sayActive()
  }
  s.onclose = () => {
    if (ws !== s) return
    ws = null
    if (document.visibilityState === "visible") downSince ??= Date.now()
    startPoll()
    retry = setTimeout(connect, Math.min(30_000, 1000 * 2 ** tries++))
  }
}

// A phone waking up keeps a dead WebSocket "open".
function revive() {
  if (ws && Date.now() - lastHeard < PING + 10_000) return
  if (ws) { const s = ws; ws = null; s.onclose = null; s.close(); startPoll(); downSince = null }
  tries = 0
  connect()
}

export function startLive(from?: { at?: unknown; kept?: unknown; state?: unknown }) {
  if (started || typeof WebSocket === "undefined") return
  started = true
  if (isText(from?.at)) heard = from.at
  if (isText(from?.kept) && isNumber(from.state)) { keptSeen = from.kept; keptState = from.state }
  connect()
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") { if (!ws || ws.readyState !== WebSocket.OPEN) downSince = Date.now(); release(); revive() }
    else downSince = null
  })
  addEventListener("online", revive)
  addEventListener("pageshow", revive)
  addEventListener("focus", sayActive)
  addEventListener("pointerdown", sayActive, { capture: true, passive: true })
  setInterval(() => document.visibilityState === "visible" && revive(), PING)
}

let writing = 0
let edits = 0
const idle = new Set<() => void>()

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
  const late = setTimeout(done, 60_000)
  p.then(done, done)
  return p
}

export const edited = () => { edits++ }
export const editCount = () => edits
export const settled = () => (writing ? new Promise<void>((r) => idle.add(r)) : Promise.resolve())
