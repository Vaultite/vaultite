import fs from "node:fs"
import { parseTerminal } from "../../../core/agents.ts"
import { Relayed } from "../../../core/contracts/version.ts"
import { logger, type OpCtx, OpError, type Plugin, type Who, whoOf } from "../../../core/plugins.ts"
import { cardOf, commitsIn, turnWord, fixTask, landedSaid, mergedCommit, mergedSaid, type Handoff, type Job, type JobCard, jobsLine, jobTimings, lastOf, linkOf, linksIn, live, type Marks, messageOf, nowOf,
  type Queued, toldBy, type Result, resumeOf, str, type Waits, type Where } from "./jobs.ts"
import { JobLogRow } from "./rows.ts"
import { type Clock, due, endEvent, type Going, type GoingEvent, going, goingLine, type JobEvent, PACE, type Pace, read, readTurn, restEvent, shipDue, step, turnOver, waitsLive } from "./joblife.ts"
import { diffSince, marksOf, onMainSince } from "./jobgit.ts"
import { handoffOps } from "./jobhandoff.ts"
import { jobMachines } from "./jobmachines.ts"
import { jobsOps } from "./jobops.ts"
import { jobStarts } from "./jobstart.ts"
import { jobTell } from "./jobtell.ts"
import { jobPlaces, sameDir } from "./jobplace.ts"
import type { JobAsk, Moment } from "./types.ts"
import { tilde, type Over } from "./where.ts"
import { type Read, workerLinks } from "./links.ts"
import { workerOps } from "./workerops.ts"

export type JobDeps = {
  askOf: (name: string) => Moment | undefined
  own: (name: string, ctx: OpCtx) => boolean
  say: (ctx: OpCtx, name: string, text: string) => Promise<unknown>
  saidSince?: (name: string, since: number) => string[]
  turnEnd?: (name: string) => Promise<void> | null
  did: (name: string, op: string) => void
  who: (p: Record<string, unknown>) => string
  cards: (cards: JobCard[]) => void
  moved?: (j: Job, from: string) => void
  warm?: (j: Job) => boolean
  onScreen?: (link: string) => boolean
  paneTo?: (id: string) => string
  as: object
}
export type Seen = { running: boolean; state?: string; kind?: string; msg?: string; title?: string; typed?: number; asks?: string[]; waits?: Omit<Waits, "at">
  turn?: { text: string; files: string[]; at: number; final: boolean; session?: string; prompt?: string; background?: number } | null; diff?: string
  exit?: { code: number; signal: number; lost?: boolean }
  unreachable?: string
  context?: { tokens: number; window: number }
  onMain?: boolean
  marks?: Marks }

const KEEP = 40, KEEP_DAYS = 7
export type JobCore = {
  all: () => Job[]; jobOf: (id: string) => Job; changed: () => void; refresh: (j: Job, now?: boolean) => Promise<void>
  wake: (ctx: OpCtx, j: Job, prompt?: string) => Promise<boolean>; close: (ctx: OpCtx, j: Job) => Promise<void>
  unsure: (j: Job, m: Moment | undefined, which: string) => string; seen: (ids: string[]) => void; clockOf: (j: Job) => Clock
  links: ReturnType<typeof workerLinks>; keep: (j: Job, q: Queued) => boolean
  land: (ctx: OpCtx, j: Job, note?: string, shown?: string, by?: string) => Promise<void>
  steer: (ctx: OpCtx, j: Job, text: string, shown?: string, by?: string, how?: "tell" | "land") => Promise<void>
  retitle: (ctx: OpCtx, j: Job, title: string) => Promise<void>
  begin: (ctx: OpCtx, task: string | ((w: Where) => Promise<string>), m: JobAsk | undefined, p: Handoff, by?: string) => Promise<Job>
}
const APP = whoOf("app/companion", null)
const Answered = Relayed.omit({ machine: true })
const SIGHUP = 1
const crashed = (x: Seen["exit"]) => !!x && (!!x.lost || x.code !== 0 || (x.signal !== 0 && x.signal !== SIGHUP))
const pace: Pace = { ...PACE }
export const paced = (p: Partial<Pace>) => void Object.assign(pace, p)
const unanswered = new Map<string, number>()
const AWAY = 30_000
function lasted(seen: Map<string, number>, id: string, ms: number, now = Date.now()) {
  if (!seen.has(id)) seen.set(id, now)
  return now - (seen.get(id) ?? now) >= ms
}

export function jobOps(plugin: Plugin, d: JobDeps) {
  const links = workerLinks(plugin, { seenHere: (id, r) => seenHere(id, r), landing: (cwd, base, text, branch, kept) => landing(cwd, base, text, branch, kept) }), atMachine = links.atMachine
  const machines = jobMachines(plugin, links), { setting, jobsAgent } = machines
  const places = jobPlaces(plugin, machines, atMachine), { placeHere } = places

  let held: { vault: string; jobs: Job[] } | null = null
  const jobLog = plugin.dayLog("jobs", JobLogRow), log = logger("companion")
  function all(): Job[] {
    if (held?.vault === plugin.vault.path) return held.jobs
    held = { vault: plugin.vault.path, jobs: plugin.kept<{ jobs: Job[] }>("jobs", { jobs: [] }).jobs ?? [] }
    return held.jobs
  }
  function changed() {
    const since = Date.now() - KEEP_DAYS * 86_400_000
    held!.jobs = all().filter((j, i) => live(j.state) || (j.at >= since && i < KEEP))
    plugin.keep("jobs", { jobs: held!.jobs })
    d.cards(cards())
  }
  const cards = () => all().map((j) => cardOf(j))
  function move(j: Job, ev: JobEvent, t = Date.now()) {
    const x = step(j, ev, t)
    if (!x) return false
    jobLog.append(x.t, [{ t: x.t, job: j.id, ev, from: x.from, to: x.to }])
    jobLog.prune(30)
    d.moved?.(j, x.from)
    return true
  }

  async function seenHere(id: string, o: Read = {}): Promise<Seen> {
    const running = await plugin.ask<boolean>("terminal:runs", false, id)
    const st = await plugin.ask<{ state?: string; kind?: string; msg?: string } | null>("terminal:state", null, id)
    const info = running ? await plugin.ask<{ title?: string; typed?: number } | null>("terminal:info", null, id) : null
    const exit = running ? null : await plugin.ask<Seen["exit"] | null>("terminal:ended", null, id)
    const unreachable = running || exit ? null : await plugin.ask<string | null>("terminal:trouble", null, id).catch(() => null)
    if (unreachable) return { running: false, unreachable }
    const agent = parseTerminal(id)?.agent ?? ""
    type Turn = { text?: string; files?: string[]; at?: number; final?: boolean; session?: string; prompt?: string; background?: number }
    const turn = o.turn && agent ? await plugin.ask<Turn | null>(`agent-turn:${agent}`, null, id, o.session ?? "") : null
    const context = o.context && running && agent ? await plugin.ask<Seen["context"] | null>(`agent-context:${agent}`, null, id, o.session ?? "").catch(() => null) : null
    type Q = { question?: string; multi?: boolean; options?: { label?: string }[] }
    const blocked = running && agent && st?.state === "blocked"
    const asking = blocked && st?.kind === "question" ? await plugin.ask<{ questions?: Q[] } | null>(`agent-asking:${agent}`, null, id, o.session ?? "").catch(() => null) : null
    const asks = o.turn ? (asking?.questions ?? []).map((q) => str(q.question)).filter(Boolean) : []
    const waits = blocked ? await waitsOf(id, st, asking?.questions) : null
    return { running, ...(st?.state ? { state: st.state } : {}), ...(st?.kind ? { kind: st.kind } : {}), ...(st?.msg ? { msg: st.msg } : {}), ...(info?.title ? { title: info.title } : {}),
      ...(info?.typed ? { typed: info.typed } : {}), ...(asks.length ? { asks } : {}), ...(waits ? { waits } : {}), ...(context?.tokens ? { context } : {}),
      ...(exit ? { exit: { code: exit.code, signal: exit.signal, ...(exit.lost ? { lost: true } : {}) } } : {}),
      ...(o.turn ? { turn: turn ? { text: str(turn.text), files: turn.files ?? [], at: turn.at ?? 0, final: turn.final !== false && !!turn.text, ...(turn.session ? { session: turn.session } : {}),
        ...(turn.prompt ? { prompt: turn.prompt } : {}), ...(turn.background ? { background: turn.background } : {}) } : null } : {}),
      ...(o.turn && o.cwd && o.base ? { diff: await changesOf(o.cwd, o.base, o.tree ?? "", [turn?.text, o.said].filter(Boolean).join("\n")) } : {}),
      ...(o.cwd && o.base && (o.turn || o.said || o.branch) ? await landing(o.cwd, o.base, [turn?.text, o.said].filter(Boolean).join("\n"), o.branch ?? "", o.marks) : {}) }
  }
  async function changesOf(cwd: string, base: string, tree: string, text: string) {
    const commit = landedSaid(text) ? mergedCommit(text) : ""
    const there = tree && fs.existsSync(tree)
    return diffSince(there ? tree : cwd, base, commit, !!tree && !there && !sameDir(tree, cwd))
  }
  async function landing(cwd: string, base: string, text: string, branch: string, kept?: Marks) {
    const marks = branch ? await marksOf(cwd, branch) : null
    return { onMain: await onMainSince(cwd, base, text, branch, marks ?? kept), ...(marks ? { marks } : {}) }
  }
  async function waitsOf(id: string, st: { kind?: string; msg?: string }, questions?: { question?: string; multi?: boolean; options?: { label?: string }[] }[]): Promise<Seen["waits"] | null> {
    if (st.kind === "auth") return null
    if (st.kind === "question") {
      const q = questions?.[0]
      if (!q?.question) return st.msg ? { kind: "question", question: st.msg, choices: [] } : null
      const one = questions!.length === 1 && !q.multi
      return { kind: "question", question: str(q.question), choices: one ? (q.options ?? []).map((x) => str(x.label)).filter(Boolean) : [] }
    }
    const shown = await plugin.ask<{ says: string; choices: string[] } | null>("terminal:ask", null, id).catch(() => null)
    return { kind: "permission", question: st.msg || shown?.says || "Asks permission", choices: shown?.choices ?? ["Approve", "Deny"] }
  }
  const seenOf = (j: Job, turn = false, diff = turn) => {
    const said = [j.result?.text, j.last?.text].filter(Boolean).join("\n").slice(0, 8000)
    const o = { ...(turn ? { turn, ...(j.session ? { session: j.session } : {}) } : {}), ...(diff ? { cwd: j.where.cwd, ...(j.where.base ? { base: j.where.base } : {}), ...(j.where.tree ? { tree: j.where.tree } : {}),
      ...(j.where.branch ? { branch: j.where.branch } : {}), ...(said ? { said } : {}), ...(j.marks ? { marks: j.marks } : {}) } : {}) }
    return links.of(j.where).seen(j.terminal, o).then((s) => {
      if (s.marks && JSON.stringify(s.marks) !== JSON.stringify(j.marks)) { j.marks = s.marks; marked.add(j.id) }
      // (Claude Code speaking OSC 7501 mutes its hooks, yet may never say its state)
      const w = turn && s.running && !s.state ? turnWord(s.turn, Date.now()) : undefined
      return w ? { ...s, state: w } : s
    })
  }
  const marked = new Set<string>()

  const clocks = new Map<string, Clock>()
  const clockOf = (j: Job) => { let c = clocks.get(j.id); if (!c) clocks.set(j.id, c = {}); return c }
  const busy = new Set<string>()
  const sending = new Set<string>()
  const again = new Map<string, boolean>()
  async function refresh(j: Job, now = false) {
    if (j.state === "stopped" || !j.terminal) return
    if (busy.has(j.id)) return void again.set(j.id, now || !!again.get(j.id))
    busy.add(j.id)
    try {
      const fresh = now || readTurn(j, clockOf(j), Date.now(), pace)
      const s = await seenOf(j, fresh, false).catch(() => null)
      if (!s) return
      if (s.unreachable) { if (lasted(unanswered, j.id, AWAY) && j.unreachable !== s.unreachable) { j.unreachable = s.unreachable; changed() } return }
      unanswered.delete(j.id); if (j.unreachable) { delete j.unreachable; marked.add(j.id) }
      let moved = false, waited = false
      const was = j.now, said = j.last?.at, t = Date.now()
      if (fresh) { clockOf(j).read = t; heard(j, s) }
      const r = read(j, clockOf(j), s, t, { sending: sending.has(j.id), pace })
      clocks.set(j.id, r.clock)
      setGoing(j, r.going, "worked", t)
      j.now = goingLine(j.going) || nowOf(j, s)
      const w = s.state === "blocked" ? s.waits : undefined
      if (JSON.stringify(w ?? null) !== JSON.stringify(j.waits ? { kind: j.waits.kind, question: j.waits.question, choices: j.waits.choices } : null)) {
        if (w) j.waits = { ...w, at: t }
        else delete j.waits
        waited = true
      }
      if (s.running && j.exited) { delete j.exited; delete j.closed; moved = true }
      if ((s.typed ?? 0) > j.started && !j.held) { j.held = true; moved = true }
      if (r.ev === "working") j.stepped ??= t
      if (r.ev) moved = move(j, r.ev, t) || moved
      for (const x of r.next) {
        if (x.do === "again") setTimeout(() => void refresh(j), x.ms).unref?.()
        else if (x.do === "end") moved = await ended(j, s) || moved
        else if (x.do === "finish") moved = await finish(j) || moved
        else if (x.do === "tidy") moved = await tidy(j) || moved
        else moved = await learn(j) || moved
      }
      if (shipDue(j, clockOf(j), Date.now(), pace)) moved = await shippedSince(j) || moved
      if (moved || waited || j.now !== was || j.last?.at !== said || marked.delete(j.id)) changed()
    } finally {
      busy.delete(j.id)
      const next = again.get(j.id)
      if (next !== undefined) { again.delete(j.id); void refresh(j, next).catch((e) => log.error("jobs", e)) }
    }
  }
  function setGoing(j: Job, g: Going | undefined, ev: GoingEvent["type"], t = Date.now()) {
    const from = j.going?.state ?? "none", to = g?.state ?? "none"
    if (g) j.going = g
    else delete j.going
    if (from !== to) jobLog.append(t, [{ t, job: j.id, ev: `going ${ev}`, from: `going ${from}`, to: `going ${to}` }])
  }
  function heard(j: Job, s: Seen) {
    if (!s.turn) return
    j.last = lastOf(s.turn, s.asks)
    const by = j.last.told ? toldBy(j, s.turn.prompt ?? "", s.typed) : ""
    if (by) j.last.by = by
    if (s.turn.session) j.session ??= s.turn.session
  }
  function resultOf(j: Job, s: Seen) {
    const t = s.turn, text = t && t.at >= j.turn - 1000 ? t.text : ""
    if (t?.session) j.session = t.session
    const result: Result = { ...(text ? { text: text.slice(0, 4000) } : {}), ...(t?.files?.length ? { files: t.files.map((f) => tilde(f)).slice(0, 40) } : {}),
      ...(s.diff ? { diff: s.diff } : !s.diff && t?.files?.length && j.where.repo ? { diff: `${t.files.length} file${t.files.length > 1 ? "s" : ""} changed` } : {}),
      ...linksIn(text, j.where.preview) }
    return { result, text, changes: !!j.where.repo && !!(s.diff || t?.files?.length) }
  }
  async function finish(j: Job) {
    const s = await seenOf(j, true).catch(() => null)
    if (!s) return false
    const t = s.turn
    // (Claude Code rests a moment before its first step)
    if (j.state === "starting" && !(t?.final && t.at >= j.turn - 1000)) return false
    const r = resultOf(j, s), now = Date.now()
    heard(j, s)
    const ev = restEvent({ background: t?.background, landed: landed(j, r.text) || shipped(j, s, r.text), changes: r.changes, lands: j.where.lands, text: r.text, at: t?.at || j.turn, now })
    if (ev === "working") j.now = nowOf(j, s)
    else j.result = r.result
    return over(j, turnOver(j, clockOf(j), ev, j.where.live ? mergedCommit(r.text) : "", now), now)
  }
  function over(j: Job, x: ReturnType<typeof turnOver>, t: number) {
    clocks.set(j.id, x.clock)
    if (x.by) setGoing(j, x.going, x.by, t)
    if (x.going?.state === "waiting") j.now = x.going.why
    return move(j, x.ev, t)
  }
  const looking = new Set<string>()
  async function golive(j: Job) {
    const g = j.going
    if (g?.state !== "waiting" || looking.has(j.id)) return
    looking.add(j.id)
    clockOf(j).live = Date.now()
    try {
      const out = Answered.safeParse(await links.of(j.where).there(appCtx(), "app.version", { commit: g.commit }, 30).catch(() => null)).data
      const was = j.going?.why
      const x = going(j.going, { type: "verdict", commit: g.commit, since: g.since, v: out?.live ?? null, where: j.where.label || "its server" }, Date.now())
      if (x.going === j.going) return
      setGoing(j, x.going, "verdict")
      if (x.ev) move(j, x.ev)
      if (x.fix !== undefined) {
        try { await steer(appCtx(), j, fixTask(j.where, g.commit, x.fix), x.going.why) } catch (e) {
          const y = going(j.going, { type: "unsent", commit: g.commit, why: messageOf(e) }, Date.now())
          setGoing(j, y.going, "unsent")
          if (y.ev) move(j, y.ev)
        }
      }
      j.now = j.going?.why ?? j.now
      if (j.going?.why !== was) changed()
    } finally { looking.delete(j.id) }
  }
  const shipped = (j: Job, s: Seen, text: string) => !!j.where.repo && !(j.land && j.land.at === undefined) && (s.onMain === true || (!commitsIn(text).length && landedSaid(text)))
  async function shippedSince(j: Job) {
    clockOf(j).ship = Date.now()
    const s = await seenOf(j, false, true).catch(() => null)
    return !!s && shipped(j, s, [j.result?.text, j.last?.text].filter(Boolean).join("\n")) && move(j, "landed")
  }
  async function ship(j: Job) {
    if (busy.has(j.id)) return
    if (await shippedSince(j) || marked.delete(j.id)) changed()
  }
  function landed(j: Job, text: string) {
    if (!j.land || j.land.at !== undefined) return false
    j.land = { ...j.land, at: Date.now(), merged: mergedSaid(text) === true }
    return j.land.merged === true
  }
  async function ended(j: Job, s: Seen) {
    if (!live(j.state)) { j.exited = Date.now(); move(j, "ended"); resumable(j); return true }
    if (waitsLive(j.going)) { j.exited = Date.now(); resumable(j); return true }
    const r = await seenOf(j, true).catch(() => null)
    if (!r) return false
    const t = j.exited = Date.now()
    const x = s.exit, done = resultOf(j, r)
    if (done.text || done.result.files?.length) j.result = done.result
    heard(j, r)
    if (landed(j, done.text) || shipped(j, r, done.text)) over(j, turnOver(j, clockOf(j), "landed", j.where.live ? mergedCommit(done.text) : "", t), t)
    else {
      move(j, endEvent({ text: !!done.text.trim(), final: !!r.turn?.final && !!done.text, changes: done.changes, crashed: crashed(x) }))
      const y = going(j.going, { type: "ended" }, t)
      setGoing(j, y.going, "ended", t)
      if (y.ev) move(j, y.ev, t)
    }
    resumable(j)
    return true
  }
  function resumable(j: Job) {
    const to = j.state === "stopped" ? "" : resumeOf(j)
    if (to) j.terminal = to
  }

  async function tidy(j: Job) {
    if (j.held || d.warm?.(j)) return false
    // (a cloud session at rest pauses by itself; a follow-up still reaches it)
    if (j.where.cloud) { j.exited = Date.now(); return true }
    const t = await seenOf(j, true, false).catch(() => null)
    if (t?.turn?.session) j.session ??= t.turn.session
    if (!t?.running || t.turn?.background || !resumeOf(j) || d.onScreen?.(linkOf(j))) return false
    await links.of(j.where).end(appCtx(), j.terminal)
    j.exited = j.closed = Date.now()
    resumable(j)
    return true
  }
  async function prune(j: Job) {
    const w = j.where
    clockOf(j).prune = Date.now()
    const r = await links.of(w).there(appCtx(), "companion.worktree-drop", { cwd: w.cwd, tree: w.tree, branch: w.branch ?? "" }, 150)
    if (!(r instanceof Object && "why" in r && r.why)) { j.pruned = Date.now(); changed() }
  }
  async function learn(j: Job) {
    const s = await seenOf(j, true, false).catch(() => null)
    if (s?.turn?.session) j.session = s.turn.session
    return !!j.session
  }

  const tell = jobTell({ all, changed, move, log: jobLog, clockOf, sending, links, setting, d, seenOf, ended, refresh })
  const { wake, fresh, retitle, steer, land, close, unsure } = tell
  const { keep, flush, begin } = jobStarts(plugin, { all, changed, move, links, machines, places, appCtx, tell })
  plugin.onEvent({ types: ["terminal.state", "terminal.ended"] }, (ev) => {
    const j = all().find((x) => !x.where.machine && x.terminal === str(ev.id))
    if (j) void refresh(j).catch((e) => log.error("jobs", e))
  })
  let ticks = 0
  const timer = setInterval(() => {
    ticks++
    for (const j of all()) {
      const n = due(j, clockOf(j), ticks, Date.now(), pace)
      if (n.read) void refresh(j).catch(() => {})
      if (n.ship) void ship(j).catch(() => {})
      if (n.live) void golive(j).catch((e) => log.error("jobs", e))
      if (n.prune) void prune(j).catch(() => {})
    }
    if (ticks % pace.flush === 0) void flush().catch((e) => log.error("jobs", e))
  }, pace.tick)
  timer.unref?.()
  plugin.onUnload(() => clearInterval(timer))

  function appCtx(by: Who = APP) {
    return plugin.ctx({ who: by })
  }
  const jobOf = (id: string) => {
    const want = id.trim(), j = all().find((x) => x.id === want) ?? all().find((x) => want.length >= 3 && x.id.endsWith(want))
    if (!j) throw new OpError(`no job ${want} (companion jobs lists them)`, 404)
    return j
  }

  function seen(ids: string[]) {
    let any = false
    for (const j of all()) if (ids.includes(j.id) && !j.seen) { j.seen = true; any = true }
    if (any) changed()
  }

  const core: JobCore = { all, jobOf, changed, refresh, wake, close, unsure, seen, clockOf, links, keep, land, steer, retitle, begin }
  handoffOps(plugin, d, core, machines)
  jobsOps(plugin, d, core)
  workerOps(plugin, { places, machines, links, seenHere })

  return {
    list: all, cards, seen, jobsAgent, begin,
    find: jobOf,
    tell: (ctx: OpCtx, id: string, text: string, shown?: string, by?: string) => steer(ctx, jobOf(id), text, shown, by),
    fresh: (ctx: OpCtx, id: string, text: string, shown?: string, by?: string) => fresh(ctx, jobOf(id), text, shown, by),
    context: async (j: Job) => (await links.of(j.where).seen(j.terminal, { context: true, ...(j.session ? { session: j.session } : {}) }).catch(() => null))?.context ?? null,
    land: (ctx: OpCtx, id: string) => land(ctx, jobOf(id), "", undefined, "you, by Keep and merge"),
    shipped: async (id: string) => {
      const j = jobOf(id)
      if (j.state !== "ready for review" || !j.where.repo || !(await shippedSince(j))) return false
      changed()
      return true
    },
    close: (ctx: OpCtx, id: string) => close(ctx, jobOf(id)),
    unsure: (id: string, m: Moment | undefined, which = "") => unsure(jobOf(id), m, which),
    placeHere: (o: Over) => placeHere(o, "", "", false),
    line: () => jobsLine(all()),
    atMachine,
    changed,
    timings: (day: string, dayOf: (t: number) => string) => jobTimings(all().filter((j) => dayOf(j.started) === day)),
  }
}
