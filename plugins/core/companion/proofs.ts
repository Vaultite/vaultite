import type { OpCtx, Plugin } from "../../../core/plugins.ts"
import { logger, OpError } from "../../../core/plugins.ts"
import { type Job, landable, live, terminalOf } from "./jobs.ts"
import { type Knock, READY_HOLD_MS } from "../../../core/desktop/knocks.ts"
import type { Moment } from "./types.ts"
import { type Asked, asksToSee, type Choice, choiceSaid, choicesFor, narration, type NotYet, readyLine, readyNow, summaryOf } from "./proof.ts"
import type { Result, Tour } from "./tour.ts"
import type { Screen } from "./tours.ts"
import { messageOf } from "./errors.ts"

const log = logger("companion")

const str = (v: unknown) => (typeof v === "string" ? v : "")
const isChoice = (s: string): s is Choice => s === "keep" || s === "broken" || s === "later"
const CHOOSE_MS = 5 * 60_000
const SETTLE_MS = 900
const REVIEWED_MS = 10 * 60_000

export type ProofDeps = {
  jobs: { list: () => Job[]; find: (id: string) => Job; seen: (ids: string[]) => void; tell: (ctx: OpCtx, id: string, text: string, shown?: string) => Promise<void>
    land: (ctx: OpCtx, id: string) => Promise<void>; shipped: (id: string) => Promise<boolean>; close: (ctx: OpCtx, id: string) => Promise<void>; unsure: (id: string, m: Moment | undefined, which?: string) => string }
  knocks: { knock: (p: { from: string; who: string; line: string; urgency?: string; open?: string; hold?: number }) => Knock; settle: (from: string) => void }
  tours: { proofOf: (id: string) => { path: string; tour: Tour; problems: string[] } | null; show: (name: string, s: Screen, tour: Tour) => Promise<Result> }
  name: () => string
  screen: (name: string, tour: Tour) => Screen | null
  notHere: (j: Job, t: Tour) => Promise<NotYet | null>
  say: (text: string, o?: { ask?: boolean }) => Promise<unknown>
  choices: (job: Job, c: { say: string; buttons: string[]; hint?: string }) => Promise<boolean>
  clear: () => void
  open: (path: string) => Promise<unknown>
  play: (video: string, title: string, note: string) => Promise<boolean>
  has: (path: string) => boolean
  record: (id: string) => boolean
  urgency: () => Promise<"high" | "normal" | "off">
  showing: (on: { voice: boolean; displays?: unknown } | null) => void
  asked: () => Moment | undefined
  shown: (j: Job, by: "click" | "ask") => void
}

export function proofOps(plugin: Plugin, d: ProofDeps) {
  let pending: { job: string; until: number; asked: Asked; tell?: boolean } | null = null
  let reviewed: { job: string; until: number } | null = null
  let playing: { job: string; ctl: { stopped: boolean } } | null = null
  let mainRead: Promise<boolean> = Promise.resolve(false)

  const jobOf = (id: string) => {
    if (id) return d.jobs.find(id)
    const all = d.jobs.list(), fresh = all.filter((x) => (x.state === "ready for review" || x.state === "done") && !x.seen)
    const ready = fresh.length ? fresh : all.filter((x) => x.state === "ready for review")
    if (!ready.length) throw new OpError("no job is ready to show you", 404)
    if (ready.length > 1) throw new OpError(`which one: ${ready.slice(0, 4).map((x) => `${x.id} "${x.title}"`).join(", ")} (ask them in one short line if their words don't say)`, 409)
    return ready[0]
  }

  async function moved(j: Job, from: string) {
    if (!readyNow(j, from) || !j.terminal) return false
    if (j.where.watched && !j.land) return false
    const proof = d.tours.proofOf(j.id), merging = j.land?.at !== undefined
    const change = proof && !proof.problems.length && !merging ? proof.tour.title : undefined
    const urgency = await d.urgency()
    if (urgency === "off") return true
    try {
      d.knocks.knock({ from: terminalOf(j), who: j.title, line: readyLine(j, change), urgency, hold: READY_HOLD_MS, ...(change ? { open: `job:${j.id}` } : {}) })
    } catch (e) { log.error(`${j.id}'s ready knock: ${messageOf(e)}`) }
    return true
  }

  function whereOf(j: Job, t: Tour) {
    if (t.open) return t.open
    if (t.site.length) return j.result?.link ?? j.where.preview ?? ""
    const note = j.on?.startsWith("note:") ? j.on.slice(5) : ""
    return note && (j.result?.files ?? []).some((f) => f.endsWith(`/${note}`)) ? note : ""
  }

  async function show(j: Job, voice: boolean, live = false) {
    const name = d.name(), proof = d.tours.proofOf(j.id), mine = { stopped: false }, began = Date.now()
    mainRead = d.jobs.shipped(j.id).catch(() => false)
    playing = { job: j.id, ctl: mine }
    reviewed = null
    d.showing({ voice })
    try {
      if (!proof) return await plain(j, mine, `It didn't leave a demo to show you, so here's what it says it did. ${summaryOf(j)}`)
      if (proof.problems.length) return await plain(j, mine, `Its tour doesn't play (${proof.problems[0]}), so here's what it says it did. ${summaryOf(j, proof.tour.open)}`)
      const t = proof.tour
      if (!live && t.video && d.has(t.video)) {
        if (!(await d.play(t.video, t.title, proof.path))) return await plain(j, mine, `I can't play its video here. ${summaryOf(j, proof.tour.open)}`)
        for (const [at, said] of narration(t)) {
          await new Promise((r) => setTimeout(r, Math.max(0, at - (Date.now() - began))))
          if (mine.stopped) return
          if (said) await d.say(said).catch(() => {})
        }
        return await choose(j, mine)
      }
      await mainRead
      const away = await d.notHere(j, t)
      if (away) {
        if (!landable(j)) return await plain(j, mine, [`I can't show it on this Mac: ${away.why}.`, summaryOf(j, proof.tour.open), away.how].filter(Boolean).join(" "))
        await d.say([`It isn't in the app on this Mac yet: ${away.why}.`, away.how].filter(Boolean).join(" "))
        return await choose(j, mine, "offer")
      }
      const there = whereOf(j, t)
      if (there) { await d.open(there).catch(() => {}); await new Promise((r) => setTimeout(r, SETTLE_MS)) }
      if (mine.stopped) return
      const s = d.screen(name, t)
      if (!s) return await plain(j, mine, `I can't show it here: there's no window of yours to show it on. ${summaryOf(j, proof.tour.open)}`)
      const r = await d.tours.show(name, s, t)
      if (mine.stopped || r.ended === "stopped") return
      d.clear()
      if (r.ended === "lost") {
        const why = r.steps.at(-1)?.why?.replace(/^not found: /, "") ?? "what it changed"
        return await plain(j, mine, `I can't find ${why} on your screen now, so I can't show you that part. ${summaryOf(j, proof.tour.open)}`)
      }
      await choose(j, mine)
    } finally {
      if (playing?.ctl === mine) { playing = null; d.showing(null) }
    }
  }
  async function plain(j: Job, mine: { stopped: boolean }, text: string) {
    if (mine.stopped) return
    await d.say(text)
    await choose(j, mine)
  }
  async function choose(j: Job, mine: { stopped: boolean }, asked: Asked = "proof") {
    await mainRead
    if (mine.stopped) return
    pending = { job: j.id, until: Date.now() + CHOOSE_MS, asked }
    reviewed = { job: j.id, until: Date.now() + REVIEWED_MS }
    const c = choicesFor(j, asked)
    if (!(await d.choices(j, c).catch(() => false))) await d.say(c.say, { ask: true })
  }

  async function chose(ctx: OpCtx, what: Choice) {
    const p = pending
    if (!p) throw new OpError(`nothing was just shown to them, so there's no ${what === "keep" ? "Keep" : "choice"} to answer: ask them in one short line what they mean (see it first, merge it, or close it as it is), each a button; never close or merge a job on your own`, 409)
    pending = null
    d.clear()
    const j = d.jobs.list().find((x) => x.id === p.job)
    if (!j) throw new OpError("that job is gone", 404)
    if (what === "later") {
      reviewed = null
      await d.say("Okay, it waits in Jobs.")
      return { job: j.id, later: true }
    }
    if (what === "keep") {
      if (landable(j)) {
        await d.jobs.land(ctx, j.id)
        await d.say("Merging it now. I'll tell you once it's in.")
        return { job: j.id, landing: true }
      }
      if (j.state === "ready for review") await d.jobs.close(ctx, j.id).catch(() => {})
      await d.say("Kept.")
      return { job: j.id, kept: true }
    }
    if (d.record(j.id)) {
      await d.say("Show me what to change and tell me as you go. Say stop when you're done.")
      return { job: j.id, recording: true }
    }
    pending = { job: j.id, until: Date.now() + CHOOSE_MS, asked: "proof", tell: true }
    await d.say("Tell me what to change, and I'll send it to the job.", { ask: true })
    return { job: j.id, recording: false }
  }

  plugin.op({
    id: "companion.job-show",
    cli: "companion job-show",
    summary: "Show the user a job's change (Show me on its ready knock): the demo video its worker recorded, narrated, by the notch (else its tour, live on their screen), then their choice: Keep and merge, Needs changes, or Not yet.",
    help: `Only when they ask to see that job's change: from an agent, id the job they mean and said quoting their words
asking to see it ("show me the header"); never in answer to anything else. Its video plays wherever the change is (a
branch, another machine), each step's words said as it comes. --live plays its tour on their own screen instead, when
they ask to see it live: a change not in the app on this Mac yet is said so, with an offer to merge it first. No proof,
one that can't play or a thing it names gone: it says so plainly, with what the job says it changed. The choice is their click or word, the app's: Keep and
merge (its own worker lands it as its repo says; the job closes once merged; with no change of its own, or one
already on main, said so: Keep closes it, nothing merged), Needs changes (a clip of what they show and say, sent back to that job), Not yet (it waits in Jobs). Its worker
saves it: companion tour-save "<the change>" --job <its id> --record <its own server> (one landing itself, by default no
--record: its tour plays live once the change is in the app here).

  vau companion job-show j3k9x2a --said "show me the header"
  vau companion job-show j3k9x2a --live --said "show me it live"
  vau companion job-show                 (the one job that's ready, when there's only one)
  vau companion job-show --choose keep   (their answer, after it: keep, broken, later)`,
    kind: "write",
    lock: false,
    params: {
      id: { type: "string", description: "the job's id (default: the one ready to show, when there's only one)" },
      live: { type: "boolean", description: "play its tour on their own screen rather than its video (when they ask to see it live, and it's in the app here)" },
      choose: { type: "string", enum: ["keep", "broken", "later"], description: "their answer after it was shown: keep (and merge), needs changes (broken), or not yet (later)" },
      said: { type: "string", description: "from an agent: the user's words in their ask asking to see it, as they said them" },
      which: { type: "string", description: "their words naming that job, when their ask was over another job's terminal" },
      voice: { type: "boolean", description: "asked by voice (its words said aloud; default true)" },
      displays: { type: "array", description: "the helper's displays (screen points): where its marks can show" },
      as: { type: "string", description: "the agent asking (the proof plays as the companion all the same)" },
    },
    args: ["id"],
    run: async (p, ctx) => {
      const choice = str(p.choose)
      if (isChoice(choice)) return chose(ctx, choice)
      const theirs = !ctx.who.agent
      if (!theirs) {
        const m = d.asked(), said = str(p.said).trim().toLowerCase()
        if (!str(p.id)) throw new OpError("id: the job they mean (companion jobs lists them)")
        if (!m?.text || !said || !m.text.toLowerCase().includes(said) || !asksToSee(said))
          throw new OpError("only when their ask is to see that job's change: said quoting their words asking to see it (\"show me the header\"); else answer what they asked", 403)
        const why = d.jobs.unsure(str(p.id), m, str(p.which))
        if (why) throw new OpError(why, 409)
      }
      const j = jobOf(str(p.id))
      if (live(j.state)) throw new OpError(`"${j.title}" is still ${j.state}: nothing to show yet (companion job ${j.id} says how it goes)`, 409)
      if (playing) playing.ctl.stopped = true
      d.jobs.seen([j.id])
      d.knocks.settle(terminalOf(j))
      d.shown(j, theirs ? "click" : "ask")
      if (Array.isArray(p.displays)) d.showing({ voice: p.voice !== false, displays: p.displays })
      const proof = d.tours.proofOf(j.id)
      void show(j, p.voice !== false, p.live === true).catch((e) => log.error(`showing ${j.id}: ${messageOf(e)}`))
      const video = proof && !proof.problems.length && p.live !== true && proof.tour.video && d.has(proof.tour.video) ? proof.tour.video : null
      return { job: j.id, title: j.title, proof: proof && !proof.problems.length ? proof.path : null, ...(video ? { video } : {}) }
    },
    text: (r) => "landing" in r ? "Kept: its job is merging it, and closes once it says it merged." : "kept" in r ? "Kept: closed as done." : "later" in r ? "Not yet: it waits in Jobs."
      : "recording" in r ? (r.recording ? "Recording what they show: it goes to the job when they say stop." : "Waiting for their words on what to change.")
      : r.video ? `Playing "${r.title}"'s video (${r.video}), narrated; their choice follows.` : r.proof ? `Showing "${r.title}" (${r.proof}) live; their choice follows.` : `"${r.title}" left no proof: saying what it changed, then their choice.`,
  })

  return {
    moved,
    answer(ctx: OpCtx, text: string) {
      const p = pending
      if (!p || Date.now() > p.until) { pending = null; return false }
      if (p.tell) {
        pending = null
        reviewed = null
        void d.jobs.tell(ctx, p.job, `The user looked at what you made and it needs changes. They said: ${JSON.stringify(text.slice(0, 2000))}`, text)
          .then(() => d.say("Sent to the job."), (e) => d.say(`It didn't reach the job: ${messageOf(e)}`)).catch(() => {})
        return true
      }
      const c = choiceSaid(text, p.asked)
      if (!c) { pending = null; d.clear(); return false }
      void chose(ctx, c).catch((e) => d.say(messageOf(e))).catch(() => {})
      return true
    },
    reviewedBy(text: string) {
      const r = reviewed
      if (!r || !text.trim()) return undefined
      reviewed = null
      return Date.now() <= r.until && d.jobs.list().some((x) => x.id === r.job) ? r.job : undefined
    },
    stop: () => { if (playing) playing.ctl.stopped = true },
  }
}
