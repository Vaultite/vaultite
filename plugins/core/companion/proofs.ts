// A job's proof on the server: its ready knock, Show me (companion job-show) playing the tour its worker saved, then
// Keep (done) or Still broken (a clip of what they show and say, sent back to the same job). The rules are proof.ts'.
import type { OpCtx, Plugin } from "../../../core/plugins.ts"
import { OpError } from "../../../core/plugins.ts"
import { type Job, live } from "./jobs.ts"
import type { Knock } from "./knocks.ts"
import { choiceSaid, readyLine, readyNow, summaryOf } from "./proof.ts"
import type { Result, Tour } from "./tour.ts"
import type { Screen } from "./tours.ts"

const str = (v: unknown) => (typeof v === "string" ? v : "")
/** How long Keep or Still broken is waited for after a proof. */
const CHOOSE_MS = 5 * 60_000
/** A surface just opened: a moment for it to show before the tour looks for its things. */
const SETTLE_MS = 900

export type ProofDeps = {
  jobs: { list: () => Job[]; seen: (ids: string[]) => void; tell: (ctx: OpCtx, id: string, text: string, shown?: string) => Promise<void> }
  knocks: { knock: (p: { from: string; who: string; line: string; urgency?: string; open?: string }) => Knock; settle: (from: string) => void }
  tours: { proofOf: (id: string) => { path: string; tour: Tour; problems: string[] } | null; show: (name: string, s: Screen, tour: Tour) => Promise<Result> }
  /** The companion's name (the one that shows proofs). */
  name: () => string
  /** Where a proof plays: Vaultite's window unless the tour names another app or site (then the one asked over). */
  screen: (name: string, tour: Tour) => Screen | null
  /** Its words in a bubble (said aloud while a proof shows), at a place of Vaultite's when given. */
  say: (text: string, o?: { ask?: boolean }) => Promise<unknown>
  /** The choice's buttons on the screen (the helper's), or false when there's no screen to draw on. */
  choices: (job: Job) => Promise<boolean>
  /** Its proof's layers taken down (a step's before, the choices). */
  clear: () => void
  /** Open what a job worked on (a note, a page), so its tour finds its things. */
  open: (path: string) => Promise<unknown>
  /** Ask the helper to record a clip for job `id` (its region capture, sent to the job); false: no helper. */
  record: (id: string) => boolean
  /** How a ready knock comes now: said aloud (high: job_news spoken, not in a focus block), shown (normal), or not (off). */
  urgency: () => Promise<"high" | "normal" | "off">
  /** The displays the helper said it has (for drawing without an ask), and a proof's narration said aloud or not. */
  showing: (on: { voice: boolean; displays?: unknown } | null) => void
}

/** A job's terminal as the presences name it (its machine's after an @). */
export const fromOf = (j: Job) => `${j.terminal}${j.where.machine ? `@${j.where.machine}` : ""}`

export function proofOps(plugin: Plugin, d: ProofDeps) {
  /** What Keep or Still broken answers now: a job just shown; `tell`: its next words go to it (no helper to record). */
  let pending: { job: string; until: number; tell?: boolean } | null = null
  let playing: { job: string; ctl: { stopped: boolean } } | null = null

  const jobOf = (id: string) => {
    const all = d.jobs.list()
    const j = id ? all.find((x) => x.id === id || (id.length >= 4 && x.id.endsWith(id)))
      : all.find((x) => (x.state === "ready for review" || x.state === "done") && !x.seen) ?? all.find((x) => x.state === "ready for review")
    if (!j) throw new OpError(id ? `no job ${id} (companion jobs lists them)` : "no job is ready to show you", 404)
    return j
  }

  /** Job `j` moved from `from`: when it's just ready, its knock ("Ready to show you …"), one path for its news. */
  async function moved(j: Job, from: string) {
    if (!readyNow(j, from) || !j.terminal) return false
    const proof = d.tours.proofOf(j.id)
    const change = proof && !proof.problems.length ? proof.tour.title : undefined
    const urgency = await d.urgency()
    if (urgency === "off") return true
    try {
      d.knocks.knock({ from: fromOf(j), who: j.title, line: readyLine(j, change), urgency, open: `job:${j.id}` })
    } catch (e) { console.error(`companion: ${j.id}'s ready knock: ${(e as Error).message}`) }
    return true
  }

  /** Show job `j`: its proof played, else said plainly what it changed; then Keep or Still broken. */
  async function show(j: Job, voice: boolean) {
    const name = d.name(), proof = d.tours.proofOf(j.id), mine = { stopped: false }
    playing = { job: j.id, ctl: mine }
    d.showing({ voice })
    try {
      if (!proof) return await plain(j, mine, `It didn't leave a tour to show you, so here's what it says it did. ${summaryOf(j)}`)
      if (proof.problems.length) return await plain(j, mine, `Its tour doesn't play (${proof.problems[0]}), so here's what it says it did. ${summaryOf(j)}`)
      const t = proof.tour, there = j.on?.startsWith("note:") ? j.on.slice(5) : t.site.length ? j.result?.link ?? j.where.preview ?? "" : ""
      if (there) { await d.open(there).catch(() => {}); await new Promise((r) => setTimeout(r, SETTLE_MS)) }
      if (mine.stopped) return
      const s = d.screen(name, t)
      if (!s) return await plain(j, mine, `I can't show it here: there's no window of yours to show it on. ${summaryOf(j)}`)
      const r = await d.tours.show(name, s, t)
      // (stopped by another proof or a new ask: what's up now is theirs, not this one's to clear)
      if (mine.stopped || r.ended === "stopped") return
      d.clear()
      if (r.ended === "lost") {
        const why = r.steps.at(-1)?.why?.replace(/^not found: /, "") ?? "what it changed"
        return await plain(j, mine, `I can't find ${why} on your screen now, so I can't show you that part. ${summaryOf(j)}`)
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
  async function choose(j: Job, mine: { stopped: boolean }) {
    if (mine.stopped) return
    pending = { job: j.id, until: Date.now() + CHOOSE_MS }
    if (!(await d.choices(j).catch(() => false))) await d.say("Keep it, or is it still broken?", { ask: true })
  }

  /** Keep or Still broken, for the job just shown. */
  async function chose(ctx: OpCtx, what: "keep" | "broken") {
    const p = pending
    if (!p) throw new OpError("nothing was just shown to you to keep", 409)
    pending = null
    d.clear()
    const j = d.jobs.list().find((x) => x.id === p.job)
    if (!j) throw new OpError("that job is gone", 404)
    if (what === "keep") {
      // (kept: reviewed, so closed as done; its conversation stays to resume)
      if (j.state === "ready for review") await ctx.op("companion.job-stop", { id: j.id }).catch(() => {})
      await d.say("Kept.")
      return { job: j.id, kept: true }
    }
    if (d.record(j.id)) {
      await d.say("Show me what's still wrong and tell me as you go. Say stop when you're done.")
      return { job: j.id, recording: true }
    }
    pending = { job: j.id, until: Date.now() + CHOOSE_MS, tell: true }
    await d.say("Tell me what's still wrong, and I'll send it to the job.", { ask: true })
    return { job: j.id, recording: false }
  }

  plugin.op({
    id: "companion.job-show",
    cli: "companion job-show",
    summary: "Show the user a job's change on their screen (Show me on its ready knock): the tour its worker saved, each before flipped with how it is now, then Keep or Still broken.",
    help: `No tour, one that can't play or a thing it names gone: it says so plainly, with what the job says it changed.
Keep (the job closed as done) or Still broken (a clip of what they show and say, sent back to that job) is their click
or word, the app's. Its worker saves the tour: companion tour-save "<the change>" --job <its id>.

  vau companion job-show j3k9x2a
  vau companion job-show                 (the job that's ready)
  vau companion job-show --choose keep   (their answer, after it)`,
    kind: "write",
    lock: false,
    params: {
      id: { type: "string", description: "the job's id (default: the one ready to show)" },
      choose: { type: "string", enum: ["keep", "broken"], description: "their answer after it was shown: keep, or still broken" },
      voice: { type: "boolean", description: "asked by voice (its words said aloud; default true)" },
      displays: { type: "array", description: "the helper's displays (screen points): where its marks can show" },
      as: { type: "string", description: "the agent (only the companion shows proofs)" },
    },
    args: ["id"],
    run: async (p, ctx) => {
      if (str(p.choose)) return chose(ctx, str(p.choose) as "keep" | "broken")
      const j = jobOf(str(p.id))
      if (live(j.state)) throw new OpError(`"${j.title}" is still ${j.state}: nothing to show yet (companion job ${j.id} says how it goes)`, 409)
      if (playing) playing.ctl.stopped = true
      d.jobs.seen([j.id])
      d.knocks.settle(fromOf(j))
      if (Array.isArray(p.displays)) d.showing({ voice: p.voice !== false, displays: p.displays })
      const proof = d.tours.proofOf(j.id)
      void show(j, p.voice !== false).catch((e) => console.error(`companion: showing ${j.id}: ${(e as Error).message}`))
      return { job: j.id, title: j.title, proof: proof && !proof.problems.length ? proof.path : null }
    },
    text: (r) => r.kept ? "Kept: closed as done." : "recording" in r ? (r.recording ? "Recording what they show: it goes to the job when they say stop." : "Waiting for their words on what's still wrong.")
      : r.proof ? `Showing "${r.title}" (${r.proof}); Keep or Still broken follows.` : `"${r.title}" left no tour: saying what it changed, then Keep or Still broken.`,
  })

  return {
    moved,
    /** A Talk key ask (or a typed one) right after a proof: Keep or Still broken answered here, never the model's; with no
     *  helper to record, their next words after Still broken go to the job. */
    answer(ctx: OpCtx, text: string) {
      const p = pending
      if (!p || Date.now() > p.until) { pending = null; return false }
      if (p.tell) {
        pending = null
        void d.jobs.tell(ctx, p.job, `The user looked at what you made and it's still broken. They said: ${JSON.stringify(text.slice(0, 2000))}`, text)
          .then(() => d.say("Sent to the job."), (e) => d.say(`It didn't reach the job: ${(e as Error).message}`)).catch(() => {})
        return true
      }
      const c = choiceSaid(text)
      if (!c) { pending = null; d.clear(); return false }
      void chose(ctx, c).catch((e) => d.say((e as Error).message)).catch(() => {})
      return true
    },
    /** A proof playing now stops (a new ask: they moved on). */
    stop: () => { if (playing) playing.ctl.stopped = true },
  }
}
