// Knocks: a background session asking for the user in one line, without interrupting: the helper brings each up at a
// pause, one at a time, by the notch with the sessions' presences. Plain functions: knockops.ts keeps them.

export const URGENCIES = ["low", "normal", "high"] as const
export type Urgency = typeof URGENCIES[number]
/** waiting: queued; showing: the island has it, its grace running; later: "not now", till the next break; told: shown
 *  and not put off (its presence needs you till it's opened); ignored, opened, expired: over. */
export type KnockState = "waiting" | "showing" | "later" | "told" | "ignored" | "opened" | "expired"
export type Knock = { id: string; from: string; who: string; line: string; urgency: Urgency; at: number; until: number; state: KnockState
  /** When it showed, and when it was put off (its "not now"). */
  shown?: number; later?: number
  /** What its click opens when it isn't a terminal's (a note, a link). */
  open?: string }

/** How long a shown knock waits for "not now" before it's told. */
export const GRACE_MS = 3000
/** How still the user must be (no key, no pointer) for a knock to come up: an urgent one at any pause in the talk. */
export const STILL_MS: Record<Urgency, number> = { high: 0, normal: 1500, low: 6000 }
/** Still longer than this, they're away from this Mac: nothing comes up (another Mac's helper may have them). */
export const AWAY_MS = 5 * 60_000
/** A knock put off comes back no sooner, and only at a break after it (they did something since). */
export const LATER_MS = 60_000
/** How long a knock lives by default. */
export const LIVES: Record<Urgency, number> = { high: 15 * 60_000, normal: 60 * 60_000, low: 4 * 3600_000 }
const RANK: Record<Urgency, number> = { high: 0, normal: 1, low: 2 }
const OVER = new Set<KnockState>(["ignored", "opened", "expired"])
export const over = (k: Knock) => OVER.has(k.state)

/** A duration as people write it (90s, 30m, 2h, 1d; a bare number is minutes), in ms; NaN if it isn't one. */
export function duration(s: string) {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(s|sec|m|min|h|hr|d)?\s*$/i.exec(s)
  if (!m) return NaN
  const unit = (m[2] ?? "m").toLowerCase()
  return Number(m[1]) * (unit.startsWith("s") ? 1000 : unit.startsWith("h") ? 3600_000 : unit === "d" ? 86_400_000 : 60_000)
}

/** A new knock from `from` (its session's id, or ""), named `who`; `life` ms (else its urgency's). Throws on a bad one. */
export function makeKnock(p: { id: string; from: string; who: string; line: string; urgency?: string; life?: number; open?: string }, now: number): Knock {
  const line = p.line.replace(/\s+/g, " ").trim()
  if (!line) throw new Error("a knock needs its line: what it wants, in a few words")
  const urgency = (p.urgency || "normal") as Urgency
  if (!URGENCIES.includes(urgency)) throw new Error(`urgency is low, normal or high, not ${p.urgency}`)
  const life = p.life ?? LIVES[urgency]
  if (!(life > 0)) throw new Error("a knock's life is a duration: 90s, 30m, 2h")
  return { id: p.id, from: p.from, who: p.who.trim().slice(0, 60) || "A session", line: line.length > 140 ? `${line.slice(0, 139)}…` : line,
    urgency, at: now, until: now + Math.min(life, 86_400_000), state: "waiting", ...(p.open ? { open: p.open } : {}) }
}

/** Add knock `k`: an earlier one from its session still to come or still telling is replaced by it (its newest word
 *  wins); one from a session the user ignored comes ignored. */
export function addKnock(ks: Knock[], k: Knock, muted: (from: string) => boolean): Knock[] {
  const out = ks.map((x) => (k.from && x.from === k.from && !over(x) ? { ...x, state: "expired" as const } : x))
  out.push(k.from && muted(k.from) ? { ...k, state: "ignored" } : k)
  return out
}

/** Its life over: expired. A told one lives on (its presence needs you) only as long. */
export function expire(ks: Knock[], now: number) {
  return ks.map((k) => (!over(k) && k.until <= now ? { ...k, state: "expired" as const } : k))
}

/** What the helper knows now: whether anyone talks (the companion speaking or answering, the user holding its Talk key
 *  or dictating), and how long the user's been still (system idle). */
export type Pause = { now: number; talking: boolean; still: number }

/** The knock to show now, if any: the one showing stays; else, at a pause long enough for its urgency while they're at
 *  this Mac, the most urgent, oldest first. One put off waits a while, and for a break after it. */
export function pick(ks: Knock[], p: Pause): Knock | null {
  const showing = ks.find((k) => k.state === "showing" && k.until > p.now)
  if (showing) return showing
  if (p.talking || p.still >= AWAY_MS) return null
  // (they moved since `t`: still for less time than has passed since it)
  const movedSince = (t: number) => p.now - p.still > t
  const ready = ks.filter((k) => k.until > p.now && p.still >= STILL_MS[k.urgency] &&
    (k.state === "waiting" || (k.state === "later" && p.now - (k.later ?? 0) >= LATER_MS && movedSince(k.later ?? 0))))
  return ready.sort((a, b) => RANK[a.urgency] - RANK[b.urgency] || a.at - b.at)[0] ?? null
}

export type KnockAct = "show" | "later" | "told" | "ignore" | "open"
/** Knock `k` after `act`: shown (its grace starts), put off, told (its grace ran out), ignored, opened. An act that
 *  doesn't fit its state changes nothing. */
export function actOn(k: Knock, act: KnockAct, now: number): Knock {
  if (over(k)) return k
  if (act === "show") return k.state === "waiting" || k.state === "later" ? { ...k, state: "showing", shown: now } : k
  if (act === "later") return k.state === "showing" || k.state === "told" || k.state === "waiting" ? { ...k, state: "later", later: now } : k
  if (act === "told") return k.state === "showing" ? { ...k, state: "told" } : k
  if (act === "ignore") return { ...k, state: "ignored" }
  return { ...k, state: "opened" }
}
/** How long after a knock showed a short spoken word still answers it ("not now", "ignore that one", "show me"). */
export const HEARD_MS = 30_000
/** What a short spoken answer to a knock means: put off, ignored, its session muted, or opened; null: not one (a real
 *  ask, for the companion). */
export function knockReply(text: string): "later" | "ignore" | "mute" | "open" | null {
  const t = text.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim()
  if (!t || t.split(" ").length > 6) return null
  if (/^(?:(?:no |nah |ok |okay )?not now|later|not yet|maybe later|in a (?:bit|minute|moment|sec(?:ond)?))(?: thanks| thank you| please)?$/.test(t)) return "later"
  if (/^(?:mute|silence) (?:that|this|it|them)(?: session| one)?$|^ignore (?:that|this) session$/.test(t)) return "mute"
  if (/^(?:ignore|skip|dismiss)(?: (?:that|it|this))?(?: one)?(?: please)?$|^never ?mind$/.test(t)) return "ignore"
  if (/^(?:ok |okay |yes |yeah )?(?:show me|show it|open it|open that|let'?s see)(?: please)?$/.test(t)) return "open"
  return null
}
/** A showing knock whose grace ran out without a "not now": told. */
export const graceOver = (k: Knock, now: number) => k.state === "showing" && now - (k.shown ?? now) >= GRACE_MS

// ---------- presences: the background sessions, small by the notch

export type PresenceState = "working" | "needs you" | "done"
/** One session as the notch shows it: who, in what state, a knock's line when it knocked; `terminal`: what a click opens
 *  and a Talk key held over it talks to. */
export type Presence = { id: string; who: string; tint: string; state: PresenceState; since: number; line?: string; knock?: string; urgency?: Urgency; terminal?: string; open?: string }
/** A terminal as terminal.list gives it, the fields read here. */
export type TermRow = { id: string; agent?: string | null; state?: string; needs?: boolean; name?: string; title?: string; machineLabel?: string }
/** A done session stays a while, then goes. */
export const DONE_MS = 15 * 60_000
export const MOST = 6
const TINTS = ["orange", "teal", "purple", "green", "pink", "indigo", "yellow", "blue"]
/** A session's own tint, the same each time. */
export function tintFor(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TINTS[h % TINTS.length]
}
const RANKED: Record<PresenceState, number> = { "needs you": 0, working: 1, done: 2 }
const stateOf = (r: TermRow): PresenceState | null =>
  r.state === "blocked" || r.needs ? "needs you" : r.state === "working" ? "working" : r.state === "done" || r.state === "error" ? "done" : null

/** Each agent's terminal at work, needing the user or just done (`since`: as first seen; `titles`: jobs'), and each live
 *  knock on its session's or its own; `skip`: the companion's. Needing them first, then working, then done, newest first. */
export function presencesOf(rows: TermRow[], knocks: Knock[], seen: Map<string, { state: PresenceState; since: number }>, now: number,
  { titles = new Map<string, string>(), skip = new Set<string>() }: { titles?: Map<string, string>; skip?: Set<string> } = {}): Presence[] {
  const out = new Map<string, Presence>()
  for (const r of rows) {
    const state = r.agent ? stateOf(r) : null
    if (!state || skip.has(r.id)) continue
    const was = seen.get(r.id), since = was?.state === state ? was.since : now
    seen.set(r.id, { state, since })
    if (state === "done" && now - since > DONE_MS) continue
    out.set(r.id, { id: r.id, who: titles.get(r.id) || r.name || r.title || r.agent || "A session", tint: tintFor(r.id), state, since, terminal: r.id })
  }
  for (const id of [...seen.keys()]) if (!rows.some((r) => r.id === id)) seen.delete(id)
  for (const k of knocks) {
    if (k.state !== "showing" && k.state !== "told") continue
    const p = out.get(k.from)
    const knocked = { state: "needs you" as const, line: k.line, knock: k.id, urgency: k.urgency, since: k.shown ?? k.at, ...(k.open ? { open: k.open } : {}) }
    if (p) Object.assign(p, knocked)
    else out.set(k.from || `knock:${k.id}`, { id: k.from || `knock:${k.id}`, who: k.who, tint: tintFor(k.from || k.who), ...knocked, ...(k.from && !k.from.includes(":") ? { terminal: k.from } : {}) })
  }
  return [...out.values()].sort((a, b) => RANKED[a.state] - RANKED[b.state] || b.since - a.since)
}
