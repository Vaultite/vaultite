// A chat session, live: its socket's hello, then each change, merged by id (the chat tab's; ChatTab.tsx draws it).
import { useEffect, useRef, useState } from "react"
import { announceAgent, get, type AgentPhase } from "@vaultite"
import type { Entry } from "./chatlog"
import { nameTab, NEW } from "./titles"

export type Mode = "default" | "acceptEdits" | "plan" | "auto" | "dontAsk" | "bypassPermissions"
export type Summary = { id: string; state: "starting" | "working" | "waiting" | "idle" | "error"; cwd: string; account: string; model: string; effort: string
  mode: Mode; at: number; asks: string[]; error?: string; background?: number }

export type Live = { ready: boolean; found: boolean; s: Summary | null; title: string; cwd: string; account: string; model: string; effort: string; tui: string | null
  /** The plugin driving it with the tools it serves (the companion), or "": it can't go to a terminal. */
  driven: string
  /** Its entries in order; a user message's `images` each have a `src` the app loads (api/claude-code/chat/...). */
  entries: Entry[]; start: number
  /** Why it may not be shown (not the owner's, not a session): for good. */
  refused?: string
  /** The machine it runs on isn't answering now: tried again until it does (what's shown stays). */
  unreachable?: string
  /** It couldn't be read several times running: why (it keeps trying). */
  failed?: string }

const PHASE: Record<Summary["state"], AgentPhase> = { starting: "working", working: "working", waiting: "waiting", idle: "done", error: "failed" }
/** The server pings every 20 s: a socket quiet longer went dead (a phone's, back from the background). */
const QUIET_MS = 35_000
/** Hellos failed in a row before the tab says it couldn't load. */
const TRIES = 3

export function useChat(id: string) {
  const map = useRef(new Map<string, Entry>())
  const [live, setLive] = useState<Live>({ ready: false, found: true, s: null, title: "", cwd: "", account: "", model: "", effort: "", tui: null, driven: "", entries: [], start: 0 })
  const meta = useRef(live)
  const now = useRef<() => void>(() => {})
  // (a picture's src as the server names it, under the session's chat URL: this tab's id, another machine's too)
  const shown = (e: Entry): Entry => (e.k === "user" && e.images?.length
    ? { ...e, images: e.images.map((i) => ({ src: /^(api\/|\/|https?:)/.test(i.src) ? i.src : `api/claude-code/chat/${encodeURIComponent(id)}/${i.src}` })) } : e)
  useEffect(() => {
    if (!id || id === NEW) return
    let ws: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | null = null, frame = 0, retry = 0, failures = 0, closed = false, last = 0
    // (a stream's pieces come many a second: drawn once a frame)
    const draw = () => { frame ||= requestAnimationFrame(() => { frame = 0; setLive({ ...meta.current, entries: [...map.current.values()] }) }) }
    const again = () => { if (!closed && !meta.current.refused && !timer) timer = setTimeout(open, Math.min(15_000, 500 * 2 ** retry++)) }
    const heard = () => { const { unreachable: _u, failed: _f, ...rest } = meta.current; meta.current = rest }
    const open = () => {
      timer = null
      last = Date.now()
      const s = ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/claude-code/chat/${encodeURIComponent(id)}`)
      s.onmessage = (ev) => {
        last = Date.now()
        let m: Record<string, unknown>
        try { m = JSON.parse(String(ev.data)) } catch { return }
        if (m.t === "ping") return
        if (m.t === "hello") {
          retry = failures = 0
          map.current = new Map((m.history as { entries: Entry[] }).entries.map((e) => [e.id, shown(e)]))
          meta.current = { ready: true, found: !!m.found, s: m.s as Summary | null, title: String(m.title ?? ""), cwd: String(m.cwd ?? ""), account: String(m.account ?? ""), model: String(m.model ?? ""), effort: String(m.effort ?? ""),
            tui: (m.tui as string | null) ?? null, driven: String(m.driven ?? ""), entries: [], start: (m.history as { start: number }).start }
          nameTab(id, meta.current.title)
        } else if (m.t === "put") {
          const e = m.e as Entry
          map.current.set(e.id, shown(e))
          meta.current = { ...meta.current, found: true }
        } else if (m.t === "drop") map.current.delete(String(m.e))
        else if (m.t === "state") {
          const was = meta.current.s?.state, now = (m.s as Summary | null)?.state
          announceAgent(meta.current.title || "Claude", was ? PHASE[was] : null, now ? PHASE[now] : null)
          meta.current = { ...meta.current, s: m.s as Summary | null, found: true }
        }
        else if (m.t === "tui") { meta.current = { ...meta.current, tui: (m.tui as string | null) ?? null, title: String(m.title || meta.current.title) }; nameTab(id, meta.current.title) }
        else if (m.t === "title") { meta.current = { ...meta.current, title: String(m.title ?? "") }; nameTab(id, meta.current.title) }
        else if (m.t === "refused") meta.current = { ...meta.current, ready: true, refused: String(m.reason ?? "") }
        else if (m.t === "unreachable") meta.current = { ...meta.current, unreachable: String(m.reason ?? "") }
        else if (m.t === "error" && ++failures >= TRIES) meta.current = { ...meta.current, ready: true, failed: String(m.reason ?? "") }
        if (m.t === "hello") heard()
        draw()
      }
      s.onclose = () => { if (ws === s) { ws = null; again() } }
    }
    /** Back in view, online again, or a page restored: a socket gone quiet is dropped for a new one now. */
    const revive = () => {
      if (closed || document.visibilityState !== "visible" || meta.current.refused) return
      if (ws && Date.now() - last < QUIET_MS) return
      if (ws) { const s = ws; ws = null; s.onclose = null; s.close() }
      if (timer) { clearTimeout(timer); timer = null }
      retry = 0
      open()
    }
    open()
    // (Try now: whatever the socket's state, a new one at once)
    now.current = () => { if (ws) { const s = ws; ws = null; s.onclose = null; s.close() } last = 0; revive() }
    document.addEventListener("visibilitychange", revive)
    addEventListener("online", revive)
    addEventListener("pageshow", revive)
    const watch = setInterval(revive, QUIET_MS / 2)
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      clearInterval(watch)
      document.removeEventListener("visibilitychange", revive)
      removeEventListener("online", revive)
      removeEventListener("pageshow", revive)
      cancelAnimationFrame(frame)
      ws?.close()
    }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  /** The page before what's shown, from its transcript. */
  const earlier = async () => {
    const r = await get<{ entries: Entry[]; start: number }>(`claude-code/chat/${encodeURIComponent(id)}/history?before=${meta.current.start}`)
    map.current = new Map([...r.entries.map((e) => [e.id, shown(e)] as const), ...map.current])
    meta.current = { ...meta.current, start: r.start }
    setLive({ ...meta.current, entries: [...map.current.values()] })
  }
  /** Connect again now rather than when the next try is due (a Try now button). */
  const retry = () => now.current()
  return { ...live, earlier, retry }
}
