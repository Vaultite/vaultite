// Take-over, the server's side: act on the screen goes to the helper the ask came from (electron/takeover.ts); a
// spoken yes or no while its offer waits answers it instead of being an ask.
import type { WebSocket } from "ws"

type Rect = { x: number; y: number; width: number; height: number }
export type Near = { id: string; role: string; label: string; frame: Rect }
/** What act was told, on the screen. */
export type ScreenAct = { action: string; ax?: string; sx?: number; sy?: number; value?: string; key?: string; direction?: string; ask?: string }
export type Done = { ok: boolean; why?: string; text?: string; how?: string; near?: Near[]; app?: string; title?: string }

/** Their spoken answer to an offer: no at any no word in it ("please stop", "sure, not that one"), yes only when it's
 *  yes words alone, else neither (an ask of its own). */
const NO = /\b(no|nope|nah|don'?t|do not|not|stop|wait|never ?mind|cancel|hold on|later|não)\b/
const YES = /^((yes|yeah|yep|yup|sure|ok|okay|please|go ahead|go for it|do it|let'?s do it|sounds good|alright|all right|absolutely|of course|thanks|thank you|sim|claro|pode)\s*)+$/
export function answerOf(words: string): boolean | null {
  const w = words.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()
  if (!w || w.split(" ").length > 8) return null
  if (NO.test(w)) return false
  return YES.test(w) ? true : null
}

/** The step the helper is sent, from act's params and the ask's elements (`near`). */
export function stepOf(p: ScreenAct, near: Near[]): { action: string; el?: { frame: Rect; role: string; label: string }; at?: { x: number; y: number }; value?: string; key?: string; direction?: string } {
  const action = p.action === "select" ? "click" : p.action
  const base = { action, ...(p.value !== undefined ? { value: p.value } : {}), ...(p.key ? { key: p.key } : {}), ...(p.direction ? { direction: p.direction } : {}) }
  if (p.ax) {
    const e = near.find((x) => x.id === p.ax)
    if (!e) throw new Error(`no element ${p.ax} near their pointer: the ids are the last ask's (or the last step's) near list`)
    return { ...base, el: { frame: e.frame, role: e.role, label: e.label } }
  }
  if (p.sx !== undefined && p.sy !== undefined) return { ...base, at: { x: Math.round(p.sx), y: Math.round(p.sy) } }
  return base
}

/** What act answers after a step on the screen. */
export function doneText(r: Done): string {
  if (!r.ok) return r.text ?? `It didn't work (${r.why ?? "no answer"}).`
  const how = r.how === "ax" ? " (through Accessibility)" : r.how === "point" ? " (with the pointer)" : r.how === "key" ? " (with the keys)" : ""
  const now = r.app ? ` Now in ${r.app}${r.title ? `, "${r.title}"` : ""}.` : ""
  const near = r.near?.length ? `\nNear it now (act or point by id):\n${r.near.slice(0, 20).map((e) => `  ${e.id} ${e.role} ${JSON.stringify(e.label)} at ${e.frame.x},${e.frame.y} ${e.frame.width}×${e.frame.height}`).join("\n")}` : ""
  return `Done${how}.${now}${near}`
}

/** The helpers' take-overs: which helper an ask came from (its steps go there), the steps waiting on each, its offers. */
export function takeovers(send: (ws: WebSocket, m: object) => void, fly: (agent: string, sx: number, sy: number) => void) {
  const waiting = new Map<string, { ws: WebSocket; done: (r: Done) => void }>()
  const offering = new Set<WebSocket>()
  let from: WebSocket | null = null, n = 0
  return {
    /** A moment came from this helper: its steps go there. A yes or a no while its offer waits answers it (true). */
    heard(ws: WebSocket, m: Record<string, unknown>): boolean {
      from = ws
      if (!offering.has(ws) || m.kind !== "ask" || typeof m.text !== "string") return false
      const yes = answerOf(m.text)
      if (yes === null) return false
      offering.delete(ws)
      send(ws, { t: "takeover-answer", yes })
      return true
    },
    /** Its offer is up: a Talk key's press then is its answer, not a barge-in. */
    offering: (ws: WebSocket) => offering.has(ws),
    /** The helper's own messages: an offer shown, a step done (true: handled). */
    message(ws: WebSocket, m: Record<string, unknown>): boolean {
      if (m.t === "takeover-asking") { offering.add(ws); return true }
      if (m.t === "takeover-at") { if (typeof m.agent === "string" && Number.isFinite(m.sx) && Number.isFinite(m.sy)) fly(m.agent, Number(m.sx), Number(m.sy)); return true }
      if (m.t !== "takeover-done" || typeof m.id !== "string") return false
      offering.delete(ws)
      const w = waiting.get(m.id)
      if (w?.ws === ws) { waiting.delete(m.id); w.done(m as unknown as Done) }
      return true
    },
    closed(ws: WebSocket) {
      offering.delete(ws)
      if (from === ws) from = null
      for (const [id, w] of waiting) if (w.ws === ws) { waiting.delete(id); w.done({ ok: false, why: "gone", text: "the helper went away (the app quit or restarted)" }) }
    },
    /** Do a step where the last ask came from; answers once it's done, refused, declined or stopped. */
    async act(step: ReturnType<typeof stepOf>, who: { agent: string; tint: string; ask?: string }): Promise<Done> {
      const ws = from
      // (the companion's private apps and sites: the helper checks what's there against them before each step)
      const { apps, sites } = (await import("./plugin.ts")).privates()
      if (!ws || ws.readyState !== ws.OPEN) return Promise.resolve({ ok: false, why: "none", text: "no Mac's helper asked: acting on the screen works only on an ask made there (the Talk key)" })
      const id = `to${++n}`
      return new Promise((done) => {
        // (an offer waits up to 30 s, typing a long text a while more)
        const late = setTimeout(() => { if (waiting.delete(id)) done({ ok: false, why: "timeout", text: "the helper didn't answer in time" }) }, 120_000)
        waiting.set(id, { ws, done: (r) => { clearTimeout(late); done(r) } })
        send(ws, { t: "takeover", id, agent: who.agent, tint: who.tint, step, apps, sites, ...(who.ask ? { ask: who.ask } : {}) })
      })
    },
  }
}
