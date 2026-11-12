// A job's life: its state (JOB_NEXT), its landed change going live (Going), when each read of it is due (Clock). No
// clock and no I/O: workers.ts reads the worker, CI and the server, passes what it read with the time, does what's returned.
import { type Job, type JobState, live, mergedSaid, NEWS, type Transition } from "./jobs.ts"

/** What moves a job: its machine back (start: one waiting for it starts), its worker as read (working, asks, error), its turn's end (changed: to review; answered: none;
 *  landed: what they kept, merged), its terminal's end with nothing to show (endEvent), their steer (told) and stop. */
export type JobEvent = "start" | "working" | "asks" | "changed" | "answered" | "landed" | "error" | "ended" | "told" | "stop"

export const JOB_NEXT: Record<JobState, Partial<Record<JobEvent, JobState>>> = {
  // (handed to a machine that's offline: it starts once that machine is back)
  waiting: { start: "starting", error: "failed", stop: "stopped" },
  starting: { working: "working", asks: "needs you", changed: "ready for review", answered: "done", landed: "done", error: "failed", ended: "failed", stop: "stopped" },
  working: { asks: "needs you", changed: "ready for review", answered: "done", landed: "done", error: "failed", ended: "failed", stop: "stopped" },
  "needs you": { working: "working", told: "working", changed: "ready for review", answered: "done", landed: "done", error: "failed", ended: "failed", stop: "stopped" },
  // (reviewed: closing it, its terminal ending, or its change found on main, is done; a steer or the user typing in it goes on)
  "ready for review": { working: "working", told: "working", asks: "needs you", ended: "done", landed: "done", stop: "done" },
  done: { working: "working", told: "working", asks: "needs you" },
  failed: { working: "working", told: "working" },
  stopped: {},
}

export function step(j: Job, ev: JobEvent, t: number): Transition | null {
  const to = JOB_NEXT[j.state][ev]
  if (!to || to === j.state) return null
  const x = { t, ev, from: j.state, to }
  j.log.push(x)
  if (j.log.length > 40) j.log.splice(0, j.log.length - 40)
  Object.assign(j, { state: to, at: t }, NEWS.has(to) ? { seen: false } : {})
  if (to === "working" && ev === "told") j.turn = t
  return x
}

/** Job `j`'s told move `x` (none: told didn't move it) taken back to `was`, its words not taken, unless something
 *  moved it since; its move back, if any. */
export function untell(j: Job, x: Transition | undefined, was: Pick<Job, "state" | "turn" | "now" | "at">) {
  if (x && j.log.at(-1) !== x) return null
  Object.assign(j, x ? was : { turn: was.turn, now: was.now })
  if (!x) return null
  j.log.pop()
  return { from: x.to, to: x.from }
}

/** How long a job landing itself may rest, its change neither landed nor said not to be, before it's ready for review. */
export const LAND_WAIT = 10 * 60_000
/** A worker's turn at rest: still `working` while its background tasks run (their end starts its next turn), or while
 *  one landing itself hasn't said "Merged:" or "Not merged:" (LAND_WAIT since `at`); else landed, changed or answered. */
export function restEvent(o: { background?: number; landed: boolean; changes: boolean; lands?: boolean; text: string; at: number; now: number }): JobEvent {
  if (o.landed) return "landed"
  if (o.background) return "working"
  if (o.lands && o.changes && mergedSaid(o.text) === null && o.now - o.at < LAND_WAIT) return "working"
  return o.changes ? "changed" : "answered"
}

/** How a worker's terminal ending moves its job, by what it left: an answer in its turn since the job's began (`final`:
 *  that turn over), changes to review, and whether it crashed (lost, killed, an error code) rather than was ended. */
export function endEvent(o: { text: boolean; final: boolean; changes: boolean; crashed: boolean }): JobEvent {
  // (a worker closing itself, as one that ships all the way does, ends mid-turn: on purpose, so what it left stands)
  return (o.text || o.changes) && (o.final || !o.crashed) ? (o.changes ? "changed" : "answered") : "ended"
}

/** A change a job landed where its own server takes main (Where.live): waited on by that server till it's live there,
 *  never by its worker. Its commit, since when, how many times CI's red sent it back, and its card's line (`why`). */
export type Going = { commit: string; since: number; fixes: number; state: "waiting" | "fixing" | "live" | "stuck"; why: string }
export const FIXES = 2
export const LIVE_WAIT = 60 * 60_000
/** app.version's answer on a commit: `final`, it won't be live by itself (CI red on `red`, a blocked checkout). */
export type Verdict = { live: boolean; final: boolean; why: string; red?: string }
/** `landed` "": nothing to wait on. A verdict or unsent names the going it was for (commit, since): a stale one is
 *  dropped. `where`: its server's name. */
export type GoingEvent =
  | { type: "landed"; commit: string }
  | { type: "verdict"; commit: string; since: number; v: Verdict | null; where: string }
  | { type: "unsent"; commit: string; why: string }
  | { type: "worked" }
  | { type: "rested" }

type GoingMove = { going: Going | undefined; ev?: JobEvent; fix?: undefined } | { going: Going; ev?: undefined; fix: string }
const short = (commit: string) => commit.slice(0, 7)

function verdict(g: Going, v: Verdict | null, where: string, now: number): GoingMove {
  const c = short(g.commit)
  if (v?.live) return { going: { ...g, state: "live", why: `Live: ${c} runs on ${where}` }, ev: "landed" }
  if (v?.final && v.red) return red(g, v)
  if (v?.final || now - g.since >= LIVE_WAIT) {
    const why = v ? v.why.replace(/^\S+ won't be live here: /, "") : `${where} didn't say it is after ${Math.round((now - g.since) / 60_000)} min`
    return { going: { ...g, state: "stuck", why: `Merged ${c}, not live: ${why}` }, ev: "landed" }
  }
  return { going: { ...g, why: `Merged ${c}: waiting for it to go live${v ? ` (${v.why.replace(/^\S+ isn't live here yet: /, "")})` : ""}` } }
}

function red(g: Going, v: Verdict): GoingMove {
  const c = short(g.commit)
  if (g.fixes < FIXES) return { going: { ...g, state: "fixing", fixes: g.fixes + 1, why: `CI failed on ${c}: sent back to fix it forward` }, fix: v.why }
  return { going: { ...g, state: "stuck", why: `CI failed on ${c} after ${g.fixes} fix${g.fixes === 1 ? "" : "es"} forward: it needs you` }, ev: "asks" }
}

function landed(g: Going | undefined, commit: string, now: number): GoingMove {
  if (!commit) return { going: undefined, ev: "landed" }
  return { going: { commit, since: now, fixes: g?.fixes ?? 0, state: "waiting", why: `Merged ${short(commit)}: waiting for it to go live` }, ev: "working" }
}

function unsent(g: Going | undefined, commit: string, why: string): GoingMove {
  if (g?.state !== "fixing" || g.commit !== commit) return { going: g }
  return { going: { ...g, state: "stuck", why: `CI failed on ${short(g.commit)}, and it couldn't be sent back: ${why}` }, ev: "asks" }
}

// A turn after its change went live, or after it was told it isn't, is about something else.
const worked = (g: Going | undefined): Going | undefined => (g?.state === "live" ? undefined : g?.state === "stuck" ? { ...g, state: "fixing" } : g)

/** Going `g` after `e`: `g` itself when `e` is stale, how its job moves, or the fix to send its worker. */
export function going(g: Going | undefined, e: GoingEvent, now: number): GoingMove {
  switch (e.type) {
    case "landed": return landed(g, e.commit, now)
    case "verdict": return g?.state === "waiting" && g.commit === e.commit && g.since === e.since ? verdict(g, e.v, e.where, now) : { going: g }
    case "unsent": return unsent(g, e.commit, e.why)
    case "worked": return { going: worked(g) }
    case "rested": return { going: g?.state === "fixing" ? undefined : g }
  }
}
/** Its turn's end and its terminal's were read already: neither moves it again. */
export const waitsLive = (g: Going | undefined) => g?.state === "waiting" || g?.state === "stuck"
/** Its card's line while it goes live; "" while it's fixed, its worker's doing says. */
export const goingLine = (g: Going | undefined) => (g && g.state !== "fixing" ? g.why : "")

export type Pace = {
  tick: number
  hold: number
  read: number
  ship: number
  live: number
  learn: number
  prune: number
  /** How long one done keeps its terminal: follow-ups mostly come within a minute or two, and still find it running. */
  grace: number
  flush: number
}
export const PACE: Pace = { tick: 3000, hold: 1500, read: 15_000, ship: 5 * 60_000, live: 20_000, learn: 30_000, prune: 3600_000, grace: 120_000, flush: 5 }

/** When each of a job's reads last came, on this server (not kept with the job); `rest`: its worker first seen at rest,
 *  `goingOn`: its turn ended with its work going on. */
export type Clock = { rest?: number; goingOn?: number; read?: number; ship?: number; live?: number; learn?: number; prune?: number; opened?: number }

const ago = (t: number | undefined, now: number) => (t === undefined ? Infinity : now - t)

export type Worker = { running: boolean; state?: string }
export type Next = { do: "end" | "finish" | "tidy" | "learn" } | { do: "again"; ms: number }

const resting = (w: Worker) => w.state === "idle" || w.state === "done"
const TURNS = new Set<JobState>(["working", "needs you", "starting"])

/** Job `j` with its worker read as `w`. A rest that holds is its turn's end, unless it's being typed into (`sending`):
 *  its words not taken yet, it hasn't begun. */
export function read(j: Pick<Job, "state" | "going" | "exited" | "session" | "at">, c: Clock, w: Worker, now: number, o: { sending: boolean; pace: Pace }) {
  const g = w.state === "working" ? going(j.going, { type: "worked" }, now).going : j.going
  const clock: Clock = { ...c }, next: Next[] = []
  function working(): JobEvent {
    delete clock.rest; delete clock.goingOn
    if (!j.session && ago(c.learn, now) >= o.pace.learn) { clock.learn = now; next.push({ do: "learn" }) }
    return "working"
  }
  function rest() {
    if (o.sending) delete clock.rest
    else if (c.rest === undefined) { clock.rest = now; next.push({ do: "again", ms: o.pace.hold + 100 }) }
    else if (now - c.rest >= o.pace.hold && ago(c.goingOn, now) >= o.pace.read && !waitsLive(g)) next.push({ do: "finish" })
  }
  const stops = (ev: JobEvent) => { delete clock.rest; return ev }
  let ev: JobEvent | null = null
  if (!w.running) { delete clock.rest; if (!j.exited) next.push({ do: "end" }) }
  else if (w.state === "working") ev = working()
  else if (w.state === "blocked") ev = stops("asks")
  else if (w.state === "error") ev = stops("error")
  else if (resting(w) && TURNS.has(j.state)) rest()
  else if (j.state === "done" && resting(w) && now - Math.max(j.at, c.opened ?? 0) >= o.pace.grace) next.push({ do: "tidy" })
  return { clock, going: g, ev, next }
}

export function turnOver(j: Pick<Job, "going">, c: Clock, ev: JobEvent, commit: string, now: number) {
  if (ev === "working") return { clock: { ...c, goingOn: now }, going: j.going, ev, by: null }
  const clock = { ...c }
  delete clock.rest; delete clock.goingOn
  const e: GoingEvent = ev === "landed" ? { type: "landed", commit } : { type: "rested" }
  const x = going(j.going, e, now)
  return { clock, going: x.going, ev: x.ev ?? ev, by: e.type }
}

export const readTurn = (j: Pick<Job, "state">, c: Clock, now: number, pace: Pace) => live(j.state) && ago(c.read, now) >= pace.read
/** Looked for on main however old: landed by anyone, not only through its terminal. */
export const shipDue = (j: Pick<Job, "state" | "where">, c: Clock, now: number, pace: Pace) => j.state === "ready for review" && !!j.where.repo && ago(c.ship, now) >= pace.ship

const RECENT = 6 * 3600_000
type Due = Pick<Job, "state" | "at" | "where" | "exited" | "going" | "pruned">

/** Read now and then, not live: on another machine, done with its terminal running (for tidy), or ready for review (its
 *  terminal's end is its end). */
const readsLater = (j: Due, recent: boolean) =>
  (!!j.where.machine && j.state !== "stopped" && recent) || (j.state === "done" && !j.exited) || (j.state === "ready for review" && recent)
const closed = (j: Due) => j.state === "stopped" || (j.state === "done" && !!j.exited)
const pruneDue = (j: Due, c: Clock, n: number, now: number, pace: Pace) =>
  n % 20 === 0 && !!j.where.tree && !j.where.cloud && !j.where.watched && !j.pruned && ago(c.prune, now) >= pace.prune && closed(j)

export function due(j: Due, c: Clock, n: number, now: number, pace: Pace) {
  return {
    read: live(j.state) ? !!j.where.machine || n % 2 === 0 : readsLater(j, now - j.at < RECENT) && n % 10 === 0,
    ship: shipDue(j, c, now, pace),
    live: j.going?.state === "waiting" && ago(c.live, now) >= pace.live,
    prune: pruneDue(j, c, n, now, pace),
  }
}
