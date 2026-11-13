import { useEffect, useRef, useState } from "react"
import { announceAgent, get, type AgentPhase } from "@vaultite"
import type { Entry } from "./chatlog"
import { Page, type State, type Summary, TabMessage } from "./chatprotocol"
import { nameTab, NEW } from "./titles"

export type Live = { ready: boolean; found: boolean; s: Summary | null; title: string; cwd: string; account: string; model: string; effort: string; tui: string | null
  driven: string
  entries: Entry[]; start: number
  refused?: string
  unreachable?: string
  failed?: string }

const PHASE: Record<State, AgentPhase> = { starting: "working", working: "working", waiting: "waiting", idle: "done", error: "failed" }
const QUIET_MS = 35_000
const TRIES = 3

export function useChat(id: string) {
  const map = useRef(new Map<string, Entry>())
  const [live, setLive] = useState<Live>({ ready: false, found: true, s: null, title: "", cwd: "", account: "", model: "", effort: "", tui: null, driven: "", entries: [], start: 0 })
  const meta = useRef(live)
  const now = useRef<() => void>(() => {})
  const shown = (e: Entry): Entry => (e.k === "user" && e.images?.length
    ? { ...e, images: e.images.map((i) => ({ src: /^(api\/|\/|https?:)/.test(i.src) ? i.src : `api/claude-code/chat/${encodeURIComponent(id)}/${i.src}` })) } : e)
  useEffect(() => {
    if (!id || id === NEW) return
    let ws: WebSocket | null = null, timer: ReturnType<typeof setTimeout> | null = null, frame = 0, retry = 0, failures = 0, closed = false, last = 0
    const draw = () => { frame ||= requestAnimationFrame(() => { frame = 0; setLive({ ...meta.current, entries: [...map.current.values()] }) }) }
    const again = () => { if (!closed && !meta.current.refused && !timer) timer = setTimeout(open, Math.min(15_000, 500 * 2 ** retry++)) }
    const heard = () => { const { unreachable: _u, failed: _f, ...rest } = meta.current; meta.current = rest }
    const open = () => {
      timer = null
      last = Date.now()
      const s = ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/api/claude-code/chat/${encodeURIComponent(id)}`)
      s.onmessage = (ev) => {
        last = Date.now()
        let raw: unknown
        try { raw = JSON.parse(String(ev.data)) } catch { return }
        const read = TabMessage.safeParse(raw)
        if (!read.success) return
        const m = read.data
        if (m.t === "ping") return
        if (m.t === "hello") {
          retry = failures = 0
          map.current = new Map(m.history.entries.map((e) => [e.id, shown(e)]))
          meta.current = { ready: true, found: m.found, s: m.s, title: m.title, cwd: m.cwd, account: m.account, model: m.model, effort: m.effort,
            tui: m.tui, driven: m.driven, entries: [], start: m.history.start }
          nameTab(id, meta.current.title)
        } else if (m.t === "put") {
          map.current.set(m.e.id, shown(m.e))
          meta.current = { ...meta.current, found: true }
        } else if (m.t === "drop") map.current.delete(m.e)
        else if (m.t === "state") {
          const was = meta.current.s?.state, now = m.s?.state
          announceAgent(meta.current.title || "Claude", was ? PHASE[was] : null, now ? PHASE[now] : null)
          meta.current = { ...meta.current, s: m.s, found: true }
        }
        else if (m.t === "tui") { meta.current = { ...meta.current, tui: m.tui, title: m.title || meta.current.title }; nameTab(id, meta.current.title) }
        else if (m.t === "title") { meta.current = { ...meta.current, title: m.title }; nameTab(id, meta.current.title) }
        else if (m.t === "refused") meta.current = { ...meta.current, ready: true, refused: m.reason }
        else if (m.t === "unreachable") meta.current = { ...meta.current, unreachable: m.reason }
        else if (m.t === "error" && ++failures >= TRIES) meta.current = { ...meta.current, ready: true, failed: m.reason }
        if (m.t === "hello") heard()
        draw()
      }
      s.onclose = () => { if (ws === s) { ws = null; again() } }
    }
    const revive = () => {
      if (closed || document.visibilityState !== "visible" || meta.current.refused) return
      if (ws && Date.now() - last < QUIET_MS) return
      if (ws) { const s = ws; ws = null; s.onclose = null; s.close() }
      if (timer) { clearTimeout(timer); timer = null }
      retry = 0
      open()
    }
    open()
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
  const earlier = async () => {
    const r = Page.parse(await get(`claude-code/chat/${encodeURIComponent(id)}/history?before=${meta.current.start}`))
    map.current = new Map([...r.entries.map((e) => [e.id, shown(e)] as const), ...map.current])
    meta.current = { ...meta.current, start: r.start }
    setLive({ ...meta.current, entries: [...map.current.values()] })
  }
  const retry = () => now.current()
  return { ...live, earlier, retry }
}
