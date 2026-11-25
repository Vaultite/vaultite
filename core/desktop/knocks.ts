import { agentTint } from "../agenttint.ts"
import { hasNews, waitsOnUser } from "../attention.ts"

export const URGENCIES = ["low", "normal", "high"] as const
export type Urgency = typeof URGENCIES[number]
export type KnockState = "waiting" | "showing" | "later" | "told" | "ignored" | "opened" | "expired" | "moot"
export type Knock = { id: string; from: string; who: string; line: string; urgency: Urgency; at: number; until: number; state: KnockState
  shown?: number; later?: number
  why?: string
  job?: string
  open?: string
  hold?: number }

export const GRACE_MS = 3000
export const READY_HOLD_MS = 15_000
export const HERE_MS = 10_000
export const holdOf = (k: Pick<Knock, "hold">) => k.hold ?? GRACE_MS
export const STILL_MS: Record<Urgency, number> = { high: 0, normal: 1500, low: 6000 }
export const AWAY_MS = 5 * 60_000
export const LATER_MS = 60_000
export const LIVES: Record<Urgency, number> = { high: 15 * 60_000, normal: 60 * 60_000, low: 4 * 3600_000 }
const RANK: Record<Urgency, number> = { high: 0, normal: 1, low: 2 }
const OVER = new Set<KnockState>(["ignored", "opened", "expired", "moot"])
export const over = (k: Knock) => OVER.has(k.state)

export function duration(s: string) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d)?\s*$/i.exec(s)
  if (!m) return NaN
  const unit = (m[2] ?? "m").toLowerCase()
  return Number(m[1]) * (unit.startsWith("s") ? 1000 : unit.startsWith("h") ? 3600_000 : unit === "d" ? 86_400_000 : 60_000)
}

export function makeKnock(p: { id: string; from: string; who: string; line: string; urgency?: string; life?: number; open?: string; hold?: number; job?: string }, now: number): Knock {
  const line = p.line.replace(/\s+/g, " ").trim()
  if (!line) throw new Error("a knock needs its line: what it wants, in a few words")
  const urgency = (p.urgency || "normal") as Urgency
  if (!URGENCIES.includes(urgency)) throw new Error(`urgency is low, normal or high, not ${p.urgency}`)
  const life = p.life ?? LIVES[urgency]
  if (!(life > 0)) throw new Error("a knock's life is a duration: 90s, 30m, 2h")
  if (p.hold !== undefined && !(p.hold > 0 && p.hold <= 120_000)) throw new Error("a knock's hold is a duration up to 2m: 15s")
  const k: Knock = { id: p.id, from: p.from, who: p.who.trim().slice(0, 60) || "A session", line: line.length > 140 ? `${line.slice(0, 139)}…` : line,
    urgency, at: now, until: now + Math.min(life, 86_400_000), state: "waiting" }
  if (p.open) k.open = p.open
  if (p.hold) k.hold = p.hold
  if (p.job) k.job = p.job
  return k
}

const sameAsker = (x: Knock, k: Knock) => x.from === k.from && (!!k.from || (!!k.open && x.open === k.open && x.who === k.who))
export function addKnock(ks: Knock[], k: Knock, muted: (from: string) => boolean): Knock[] {
  const out = ks.map((x) => (sameAsker(x, k) && !over(x) ? { ...x, state: "expired" as const } : x))
  out.push(k.from && muted(k.from) ? { ...k, state: "ignored" } : k)
  return out
}

export function expire(ks: Knock[], now: number) {
  return ks.map((k) => (!over(k) && k.until <= now ? { ...k, state: "expired" as const } : k))
}

export type Pause = { now: number; talking: boolean; still: number }

export function pick(ks: Knock[], p: Pause): Knock | null {
  const showing = ks.find((k) => k.state === "showing" && k.until > p.now)
  if (showing) return showing
  if (p.talking || p.still >= AWAY_MS) return null
  const movedSince = (t: number) => p.now - p.still > t
  const pause = (k: Knock) => (k.hold ? Math.max(STILL_MS[k.urgency], STILL_MS.normal) : STILL_MS[k.urgency])
  const ready = ks.filter((k) => k.until > p.now && p.still >= pause(k) &&
    (k.state === "waiting" || (k.state === "later" && p.now - (k.later ?? 0) >= LATER_MS && movedSince(k.later ?? 0))))
  return ready.sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || a.at - b.at)[0] ?? null
}

export type KnockAct = "show" | "later" | "told" | "ignore" | "open"
export function actOn(k: Knock, act: KnockAct, now: number): Knock {
  if (over(k)) return k
  if (act === "show") return k.state === "waiting" || k.state === "later" ? { ...k, state: "showing", shown: now } : k
  if (act === "later") return k.state === "showing" || k.state === "told" || k.state === "waiting" ? { ...k, state: "later", later: now } : k
  if (act === "told") return k.state === "showing" ? { ...k, state: "told" } : k
  if (act === "ignore") return { ...k, state: "ignored" }
  return { ...k, state: "opened" }
}
export const HEARD_MS = 30_000
export function knockReply(text: string): "later" | "ignore" | "mute" | "open" | null {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()
  if (!t || t.split(" ").length > 6) return null
  if (/^(?:(?:no |nah |ok |okay )?not now|later|not yet|maybe later|in a (?:bit|minute|moment|sec(?:ond)?))(?: thanks| thank you| please)?$/.test(t)) return "later"
  if (/^(?:mute|silence) (?:that|this|it|them)(?: session| one)?$|^ignore (?:that|this) session$/.test(t)) return "mute"
  if (/^(?:ignore|skip|dismiss)(?: (?:that|it|this))?(?: one)?(?: please)?$|^never ?mind$/.test(t)) return "ignore"
  if (/^(?:ok |okay |yes |yeah )?(?:show me|show it|open it|open that|let'?s see)(?: please)?$/.test(t)) return "open"
  return null
}
export const graceOver = (k: Knock, now: number) => k.state === "showing" && now - (k.shown ?? now) >= holdOf(k)
export const graceWaits = (k: Knock, p: { talking: boolean; still: number; locked?: boolean }) =>
  k.state === "showing" && (p.talking || (!!k.hold && (!!p.locked || p.still >= HERE_MS)))

export type SessionNow = { listed: boolean | null; working: boolean; restedAt: number }
export type JobNow = { state: string; at: number; seen: boolean } | null
/** Why a knock no longer stands: its job changed or was opened, or its session ended or rested and works again. */
export function mootWhy(k: Knock, o: { job?: JobNow; session?: SessionNow; listedAt: number }): string | null {
  if (over(k)) return null
  if (o.job !== undefined) {
    const j = o.job
    return !j ? "its job is gone" : j.at > k.at ? `its job is ${j.state} now` : j.seen ? "they opened its job" : null
  }
  const s = o.session
  if (!k.from || !s || o.listedAt < k.at) return null
  if (s.listed === false) return "its session ended"
  return s.working && s.restedAt >= k.at ? "its session went on" : null
}
export const settleMoot = (k: Knock, why: string): Knock => ({ ...k, state: "moot", why })

export type PresenceState = "needs you" | "ready" | "working" | "done"
export type PresenceAsk = { what: string; id?: string }
export type Presence = { id: string; who: string; tint: string; state: PresenceState; since: number; step?: string; line?: string; knock?: string; urgency?: Urgency; terminal?: string; open?: string
  job?: string; chat?: string; link?: string; agent?: string; where?: string; ask?: PresenceAsk }
export type TermRow = { id: string; agent?: string | null; state?: string; needs?: boolean; review?: boolean; name?: string; title?: string; machineLabel?: string; msg?: string
  source?: "chat" | "job"; at?: number; job?: string; kind?: string; ask?: PresenceAsk }
export const DONE_MS = 15 * 60_000
export const PRESENCE_GROUPS: { state: PresenceState; label: string }[] = [
  { state: "needs you", label: "Needs you" }, { state: "ready", label: "Ready for review" }, { state: "working", label: "Working" }, { state: "done", label: "Done" },
]
export const restCounts = (ps: Pick<Presence, "state">[]) => ({ needs: ps.filter((p) => p.state === "needs you").length, working: ps.filter((p) => p.state === "working").length })
export const atRest = (ps: Pick<Presence, "state">[]) => { const n = restCounts(ps); return n.needs + n.working > 0 }
const RANKED: Record<PresenceState, number> = { "needs you": 0, ready: 1, working: 2, done: 3 }
const oneLine = (s: string | undefined) => s?.replace(/\s+/g, " ").trim() ?? ""
const stateOf = (r: TermRow): PresenceState | null =>
  waitsOnUser(r) ? "needs you" : r.state === "working" ? "working" : hasNews(r) ? "ready" : r.state === "done" || r.state === "error" ? "done" : null

type Known = { titles?: Map<string, string>; ready?: Set<string>; skip?: Set<string>; jobs?: Map<string, string>; settled?: Record<string, number> }

function presenceOf(r: TermRow, state: PresenceState, since: number, title?: string): Presence {
  const p: Presence = { id: r.id, who: title || r.name || r.title || r.agent || "A session", tint: agentTint(r.id.replace(/^\w+:/, "")), state, since }
  if (!r.source) p.terminal = r.id
  if (r.source === "chat") p.chat = r.id.replace(/^chat:/, "")
  if (r.agent) p.agent = r.agent
  if (r.job) p.job = r.job
  if (r.machineLabel) p.where = r.machineLabel
  const step = oneLine(r.msg)
  if (step) p.step = step
  if (r.ask && state === "needs you") p.ask = r.ask
  return p
}

function knocked(out: Map<string, Presence>, k: Knock) {
  const p = out.get(k.from), state: PresenceState = k.hold && p?.state !== "needs you" ? "ready" : "needs you"
  const of: Presence = p ?? { id: k.from || `knock:${k.id}`, who: k.who, tint: agentTint(k.from || k.who), state, since: 0 }
  if (!p && k.from && !k.from.includes(":")) of.terminal = k.from
  Object.assign(of, { state, line: k.line, knock: k.id, urgency: k.urgency, since: k.shown ?? k.at })
  if (k.open) of.open = k.open
  out.set(of.id, of)
}

export function presencesOf(rows: TermRow[], knocks: Knock[], seen: Map<string, { state: PresenceState; since: number }>, now: number, o: Known = {}): Presence[] {
  const out = new Map<string, Presence>(), settled = o.settled ?? {}
  for (const r of rows) {
    const said = r.agent ? stateOf(r) : null
    if (!said || o.skip?.has(r.id)) continue
    const state = o.ready?.has(r.id) && said !== "needs you" ? "ready" : said
    const was = seen.get(r.id), since = was?.state === state ? was.since : r.at ?? now
    seen.set(r.id, { state, since })
    if ((state === "done" && now - since > DONE_MS) || (settled[r.id] && (state === "done" || state === "ready"))) continue
    out.set(r.id, presenceOf(r, state, since, o.titles?.get(r.id)))
  }
  for (const id of [...seen.keys()]) if (!rows.some((r) => r.id === id)) seen.delete(id)
  for (const k of knocks) if (k.state === "showing" || k.state === "told") knocked(out, k)
  for (const p of out.values()) { const job = p.terminal && o.jobs?.get(p.terminal); if (job) p.job = job }
  return byNeed([...out.values()])
}
export const byNeed = (ps: Presence[]) => ps.sort((a, b) => RANKED[a.state] - RANKED[b.state] || (a.state === "done" ? b.since - a.since : a.since - b.since))

const SETTLED_MS = 7 * 86_400_000
export function stillSettled(settled: Record<string, number>, rows: TermRow[], now: number) {
  const back = new Set(rows.flatMap((r) => (r.state === "working" || waitsOnUser(r) ? [r.id] : [])))
  return Object.fromEntries(Object.entries(settled).filter(([id, at]) => !back.has(id) && now - at < SETTLED_MS))
}
