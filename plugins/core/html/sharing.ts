import { DEVICE } from "@vaultite"

type Values = Record<string, unknown>
export type SharedLink = { set: (values: Values) => void; close: () => void }

export function joinShared(path: string, tell: (m: Record<string, unknown>) => void): SharedLink {
  let ws: WebSocket | null = null, n = 0, tries = 0, closed = false, retry: ReturnType<typeof setTimeout> | null = null
  const sent = new Map<number, Values>()
  let unsent: Values = {}
  const mine = () => new Set([...sent.values(), unsent].flatMap((v) => Object.keys(v)))
  const send = (values: Values) => {
    if (ws?.readyState !== WebSocket.OPEN) return void Object.assign(unsent, values)
    sent.set(++n, values)
    ws.send(JSON.stringify({ t: "set", n, values }))
  }

  function open() {
    retry = null
    const url = new URL("api/artifact/shared", location.href)
    url.searchParams.set("path", path)
    if (DEVICE) url.searchParams.set("device", DEVICE)
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
    const s = new WebSocket(url)
    ws = s
    s.onmessage = (e) => {
      let m: Record<string, any>
      try { m = JSON.parse(String(e.data)) } catch { return }
      if (m.t === "hello") {
        tries = 0
        const again: Values = Object.assign({}, ...sent.values(), unsent)
        sent.clear(); unsent = {}
        tell({ state: { ...m.state, ...again }, me: m.me, people: m.people, online: true })
        if (Object.keys(again).length) send(again)
      } else if (m.t === "set") {
        const own = mine(), values = Object.fromEntries(Object.entries(m.values ?? {}).filter(([k]) => !own.has(k)))
        if (Object.keys(values).length) tell({ set: values, by: m.by })
      } else if (m.t === "ok") sent.delete(m.n)
      else if (m.t === "no") {
        sent.delete(m.n)
        console.warn(`vau.shared(): a change wasn't kept: ${m.why}`)
        tell({ set: m.values ?? {}, by: "" })
      } else if (m.t === "people") tell({ people: m.people })
    }
    s.onclose = (e) => {
      if (ws !== s) return
      ws = null
      tell({ online: false })
      if (e.code === 4001) closed = true
      if (!closed && document.visibilityState === "visible") retry = setTimeout(open, Math.min(10_000, 500 * 2 ** tries++))
    }
  }
  const back = () => { if (!closed && !ws && document.visibilityState === "visible") { if (retry) clearTimeout(retry); open() } }
  document.addEventListener("visibilitychange", back)
  open()
  return {
    set: send,
    close() {
      closed = true
      if (retry) clearTimeout(retry)
      document.removeEventListener("visibilitychange", back)
      const s = ws
      ws = null
      s?.close()
    },
  }
}
