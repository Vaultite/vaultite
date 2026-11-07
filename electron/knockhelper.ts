// The helper's side of knocks (companion/knocks.ts): each comes up at a pause it sees (no one talking, the user still
// and at this Mac), waits its grace (a ready one's 15 s hold) for "not now", then is told; island.ts draws it.
import { powerMonitor, screen } from "electron"
import { actOn, graceOver, graceWaits, HEARD_MS, holdOf, type Knock, type KnockAct, knockReply, over, pick, type Presence } from "../plugins/core/companion/knocks.ts"
import { islandActs, islandReady, presenceAt, showIsland, spotNow } from "./island.ts"
import type { OtherWindow, Rect, Spot } from "./islandlogic.ts"
import type { WalkScene } from "../plugins/core/companion/walks.ts"

export type KnockHost = {
  /** Tell the server (the companion's socket). */
  say: (m: object) => boolean
  /** Whether anyone talks now: the companion speaking or at work on an ask, the user holding its Talk key or dictating. */
  talking: () => boolean
  /** The server's address for the island's page (null: none open). */
  base: () => string | null
  /** The screen helper's answers: `notch`, `windows`. */
  ask: <T>(op: string, req?: Record<string, unknown>) => Promise<T>
  cue: (name: "knock") => void
  /** Say an urgent knock aloud, in the companion's voice, once nothing else is said. */
  speak: (text: string) => void
  /** Open a presence's session in Vaultite (its terminal), or what its knock names. */
  open: (p: Presence) => void
  /** Type words into a session's terminal and press Enter; whether it went. */
  send: (terminal: string, text: string) => Promise<boolean>
  /** A word by the pointer, a moment. */
  hint: (text: string) => void
  /** How long the user's been still (ms): a scripted copy stands one in. */
  still?: () => number
  /** A QA walk's or a lesson's button pressed on the island: scratch, done, cancel. */
  walk: (what: string) => void
}

let host: KnockHost | null = null
let knocks: Knock[] = []
let presences: Presence[] = []
let timer: ReturnType<typeof setTimeout> | null = null
/** What the island is placed by: each display's notch (asked once a display change), other apps' islands (every few s). */
let notches: { frame: Rect; notch?: Rect }[] | null = null
let others: OtherWindow[] = [], othersAt = 0, asking = false
/** The pointer's on the island: a showing knock's grace waits while they read it. */
let hovering = 0
let spot: Spot | null = null
let lastTick = 0
/** A QA walk or lesson on (walk.ts, teach.ts): it leads the island while it lasts. */
let walk: WalkScene | null = null, walkSaid = ""
/** Still this long, the user's away. */
const AWAY_MS = 5 * 60_000

export function knockHost(h: KnockHost) {
  host = h
  islandActs({
    open: (id) => {
      const p = presences.find((x) => x.id === id || x.knock === id)
      if (!p) return
      if (p.knock) act(p.knock, "open")
      host?.open(p)
    },
    later: (id) => act(id, "later"),
    ignore: (id, mute) => act(id, "ignore", mute),
    walk: (what) => host?.walk(what),
    hover: (on) => {
      const k = knocks.find((x) => x.state === "showing")
      // (the grace left as it was when they came over it)
      if (!on && hovering && k) k.shown = (k.shown ?? Date.now()) + (Date.now() - hovering)
      hovering = on ? Date.now() : 0
      tick()
    },
  })
  for (const e of ["display-added", "display-removed", "display-metrics-changed"] as const) screen.on(e as "display-added", () => { notches = null; tick() })
}
export function stopKnocks() {
  if (timer) clearTimeout(timer)
  timer = null
  knocks = []; presences = []; walk = null; walkSaid = ""
  showIsland(null, null, null)
}

/** The walk or lesson as it is now (the helper's each draw): the island drawn again when it changed. */
export function walkShown(w: WalkScene | null) {
  const text = JSON.stringify(w)
  if (text === walkSaid) return
  walk = w; walkSaid = text
  tick()
}

/** The server's knocks and presences, as it sends them on each change. */
export function knocksHeard(m: Record<string, unknown>) {
  const mine = new Map(knocks.map((k) => [k.id, k]))
  knocks = (Array.isArray(m.knocks) ? m.knocks as Knock[] : []).map((k) => {
    // (what this helper did a moment ago, the server not having said it back yet)
    const had = mine.get(k.id)
    return had && had.state === "showing" && (k.state === "waiting" || k.state === "showing") ? had : k
  })
  presences = Array.isArray(m.presences) ? m.presences as Presence[] : []
  tick()
}

function act(id: string, what: KnockAct, mute = false) {
  const k = knocks.find((x) => x.id === id)
  if (k) Object.assign(k, actOn(k, what, Date.now()))
  if (what === "ignore" && mute && k?.from) for (const x of knocks) if (x.from === k.from) x.state = "ignored"
  host?.say({ t: "knock", id, act: what, ...(mute ? { mute: true } : {}) })
  tick()
}

const stillNow = () => host?.still?.() ?? powerMonitor.getSystemIdleTime() * 1000
const lockedNow = () => !host?.still && powerMonitor.getSystemIdleState(1) === "locked"

function tick() {
  if (timer) { clearTimeout(timer); timer = null }
  if (!host) return
  const now = Date.now()
  const talking = host.talking()
  const k = pick(knocks, { now, talking, still: stillNow() })
  // (its window loading still, or its place not known yet: it shows once it can be seen)
  if (k && k.state !== "showing" && (!islandReady(host.base()) || !spot)) { void place(); timer = setTimeout(tick, 150); return }
  if (k && k.state !== "showing") { act(k.id, "show"); host.cue("knock"); lastTick = now; return }
  // (its grace waits while they talk, while a held one's reader is away, or read it with the pointer on it)
  if (k && !hovering && graceWaits(k, { talking, still: stillNow(), locked: lockedNow() })) k.shown = (k.shown ?? now) + (now - lastTick)
  lastTick = now
  if (k && !hovering && graceOver(k, now)) {
    act(k.id, "told")
    if (k.urgency === "high") host.speak(`${k.who}: ${k.line}`)
    return
  }
  const showing = k?.state === "showing" ? k : null
  // (nobody at the Mac a while: the presences go till they're back; a walk or lesson stays)
  const away = !showing && stillNow() > AWAY_MS
  const live = !!walk || (!away && (presences.length > 0 || !!showing))
  if (live) void place()
  const hold = showing ? holdOf(showing) : 0
  const left = showing ? (hovering ? hold - (hovering - (showing.shown ?? hovering)) : hold - (now - (showing.shown ?? now))) : 0
  const tint = showing ? presences.find((p) => p.knock === showing.id)?.tint ?? "orange" : "orange"
  showIsland(host.base(), live ? { presences, knock: showing ? { ...showing, tint, left: Math.max(0, left) } : null, walk } : null, spot)
  // (quick while one shows, its grace counting; else at a walk while any wait or show)
  const waiting = knocks.some((x) => !over(x) && x.state !== "told")
  if (showing || waiting || live || presences.length) timer = setTimeout(tick, showing ? 200 : 1000)
}

/** Where the island goes now: the pointer's display, its notch and the islands of other apps there; other apps' windows
 *  read again every 2 s while the pointer is near the top (another island opens under it) or a knock shows, else 10 s. */
async function place() {
  if (!host || asking) return
  const now = Date.now(), p = screen.getCursorScreenPoint(), top = screen.getDisplayNearestPoint(p).bounds.y
  const fresh = p.y - top < 200 || knocks.some((k) => k.state === "showing") ? 2000 : 10_000
  if (notches && now - othersAt < fresh) { spot = spotNow(notches, others); return }
  asking = true
  const first = !spot
  try {
    if (!notches) notches = (await host.ask<{ screens?: { frame: Rect; notch?: Rect }[] }>("notch").catch(() => ({ screens: [] }))).screens ?? []
    others = (await host.ask<{ windows?: OtherWindow[] }>("windows").catch(() => ({ windows: [] }))).windows ?? []
    othersAt = Date.now()
    spot = spotNow(notches, others)
  } finally { asking = false }
  if (first) tick()
}

/** Words said with the Talk key: a short answer to the knock showing or just told ("not now", "ignore that one", "mute
 *  it", "show me") is done here, at once, never an ask; anything else is the companion's. */
export function knockSaid(text: string) {
  const reply = knockReply(text), now = Date.now()
  if (!reply || !host) return false
  const k = knocks.find((x) => x.state === "showing") ??
    knocks.filter((x) => x.state === "told" && now - (x.shown ?? 0) < HEARD_MS).sort((a, b) => (b.shown ?? 0) - (a.shown ?? 0))[0]
  if (!k) return false
  if (reply === "open") {
    const p = presences.find((x) => x.knock === k.id) ?? { id: k.from || k.id, who: k.who, tint: "orange", state: "needs you" as const, since: now, ...(k.from && !k.from.includes(":") ? { terminal: k.from } : {}), ...(k.open ? { open: k.open } : {}) }
    act(k.id, "open")
    host.open(p)
  } else act(k.id, reply === "mute" ? "ignore" : reply, reply === "mute")
  return true
}

/** Words said with the Talk key let go over a session by the notch: typed into its terminal, as a reply to it, never an
 *  ask of the companion's. */
export function toPresence(text: string, at: { x: number; y: number }) {
  const id = presenceAt(at), p = id ? presences.find((x) => x.id === id) : null
  if (!host || !p?.terminal || !text.trim()) return false
  const h = host
  void h.send(p.terminal, text.trim()).then((ok) => {
    h.hint(ok ? `Sent to ${p.who}` : `Couldn't reach ${p.who}`)
    if (ok && p.knock) act(p.knock, "open")
  })
  return true
}

/** What a scripted copy's island shows (web/qa/helper.mjs). */
export const islandNow = (at?: { x: number; y: number }) => ({ knocks, presences, walk, spot, showing: knocks.find((k) => k.state === "showing")?.id ?? null, ...(at ? { at: presenceAt(at) } : {}) })
