// Talking with a job: the floor handed to its worker (companion talk), so Talk key asks go into its terminal and its
// answers come by its own cursor, in its own voice, till they say "back"; the companion stays quiet meanwhile. Op: talk.
import type { IncomingMessage } from "node:http"
import { type OpCtx, OpError, type Plugin } from "../../../core/plugins.ts"
import { followTask, type Job, live } from "./jobs.ts"
import type { Moment } from "./plugin.ts"
import { parseTags, type Tag } from "./tags.ts"

type Jobs = { list: () => Job[]; find: (id: string) => Job; tell: (ctx: OpCtx, id: string, text: string, shown?: string) => Promise<void> }
export type TalkDeps = {
  jobs: Jobs
  ctx: (from?: IncomingMessage) => OpCtx
  /** The companion's own name, and the ask it was given last. */
  main: () => string
  askOf: (name: string) => Moment | undefined
  /** `name`'s words by its cursor, answering `m` (said aloud when `m` was spoken). */
  say: (name: string, text: string, m?: Moment) => Promise<unknown>
  /** `name`'s cursor thinking by `m`'s place; none: done, there. */
  show: (name: string, m: Moment | null) => void
  /** `name` gone once its talk is over: its cursor and words (no session of its own brings it back). */
  gone: (name: string) => void
  /** `m`, their words to `name`, kept as its ask: it sees what they saw (their screen, the elements near their pointer),
   *  so its tags find things there. */
  sees: (name: string, m: Moment | undefined) => void
  /** `name`'s tags in `said`, in order: its cursor flies there, or a mark is drawn. */
  tags: (name: string, tags: Tag[], said: string) => Promise<unknown>
  /** `m` answered by the companion after all (the job couldn't be told). */
  fallback: (m: Moment) => void
}

/** A talk no ask went to for this long is over: the next ask is the companion's again. */
const IDLE_MS = 10 * 60_000
/** "Back" and its kin: the app's own, never a turn of the job's. */
const BACK = /^(?:(?:ok(?:ay)?|thanks|thank you|cool|great|alright|all right|got it)[,.!]?\s+)?(?:(?:go|come|take me|switch|bring me)\s+)?(?:back(?:\s+to\s+(?:the companion|you|\S+))?|that's all|that's it|done talking|stop talking|end (?:the )?talk)(?:\s+(?:now|please))?[.!]*$/i
export const isBack = (text: string | undefined) => !!text && BACK.test(text.trim().replace(/\s+/g, " "))

const STOP = /^(the|a|an|on|of|to|in|for|and|with|at|by|·|-|—)$/i
/** The name a job talks by: its title's first words, short enough for a cursor's label. */
export function talkName(title: string, max = 24) {
  const words = title.replace(/…$/, "").replace(/\s+/g, " ").trim().split(" ")
  const out: string[] = []
  for (const w of words) { if (out.length && [...out, w].join(" ").length > max) break; out.push(w) }
  while (out.length > 1 && STOP.test(out.at(-1)!)) out.pop()
  return out.join(" ").slice(0, max) || "Job"
}

/** What its worker is told with the talk's first words: it has the floor, and how to answer aloud. */
export function talkStart(name: string, main: string) {
  return [`Talk: the user wants to talk with you by voice now (Vaultite's Talk key), as ${name}; ${main}, their companion, stays quiet till they say "back".`,
    `Answer each thing they say in your last message: a few spoken sentences, the answer first, no lists, headings, code or links. It's said aloud in your own voice by your own cursor; never call companion say yourself.`,
    `Point and mark on their screen inline as you name a thing, by the words it shows there: "It's here [point "Jobs"], and you merge it from this [ring "Merge"]." ([frame "..."] round an area). You're the job: do what they ask per your task's rules (for a long step, say so in a sentence, then do it). Only asked to talk: say in a sentence or two what you did or are doing.`].join(" ")
}
/** What its worker is told with each of their words after. */
export const TALK_ON = "Talk: they said this to you by voice; answer in your last message, spoken, tags inline."
/** What its worker is told when they go back: one line of what the talk did, for its thread. */
export const TALK_END = `Talk over: they're back with their companion. End with one line for your inbox thread: what you did or changed in the talk ("Talked: merged handoff-say"), else "Talked: nothing changed".`

export function talkOps(plugin: Plugin, d: TalkDeps) {
  /** Who has the floor: the job, the name it talks by, when it last heard them, their last words to it. */
  let floor: { job: string; name: string; at: number; m?: Moment } | null = null
  /** Jobs told the talk is over: that turn's end is the talk's, never news. */
  const closing = new Set<string>()
  /** Each job's words in order: one typed in only after the last. */
  const chains = new Map<string, Promise<unknown>>()
  const chain = (id: string, f: () => Promise<unknown>) => {
    const next = (chains.get(id) ?? Promise.resolve()).then(f, f)
    chains.set(id, next.catch(() => {}))
    return next
  }
  const jobOf = (id: string) => d.jobs.list().find((j) => j.id === id)
  /** The floor as it stands: none once its job stopped or the talk went quiet. */
  const now = () => {
    const j = floor ? jobOf(floor.job) : undefined
    if (floor && (!j || j.state === "stopped" || j.state === "failed" || Date.now() - floor.at > IDLE_MS)) { d.gone(floor.name); floor = null }
    return floor
  }

  /** `m` (their words) typed into job `j`'s terminal; `start`: with how to talk. Its cursor shows it thinking. */
  function send(ctx: OpCtx, j: Job, name: string, m: Moment | undefined, start: boolean) {
    const told = start ? talkStart(name, d.main()) : TALK_ON
    // (the ask that asked for the talk was the companion's: the job's is a copy)
    const its = m && (start ? { ...m, for: name, live: j.id } : Object.assign(m, { for: name, live: j.id }))
    if (its) floor!.m = its
    d.sees(name, its)
    d.show(name, its ?? null)
    return chain(j.id, () => d.jobs.tell(ctx, j.id, followTask(told, its), its?.text ?? "Talk with you"))
  }

  /** The floor to job `j`, their ask `m` (that asked for it) its first words; another's talk ends first. */
  async function begin(ctx: OpCtx, j: Job, m: Moment | undefined) {
    if (j.state === "stopped") throw new OpError(`${j.id} was stopped: hand it off again`, 409)
    if (j.state === "needs you") throw new OpError(`${j.id} waits on ${j.waits ? `"${j.waits.question}"` : "a prompt"} first: tell them, and answer it on their word (job-answer)`, 409)
    const was = now()
    if (was && was.job !== j.id) await end(ctx)
    const name = talkName(j.title)
    if (name.toLowerCase() === d.main().toLowerCase()) throw new OpError(`${j.id} would talk by your own name: rename it first (handoff --job --title)`, 409)
    floor = { job: j.id, name, at: Date.now() }
    await send(ctx, j, name, m, true)
    return { job: j.id, title: j.title, name }
  }

  /** The floor back to the companion: its job told so (one line for its thread), its cursor gone; `m`: their "back". */
  async function end(ctx: OpCtx, m?: Moment) {
    const f = floor
    floor = null
    if (!f) return null
    d.gone(f.name)
    if (m) await d.say(d.main(), "Back.", m)
    const j = jobOf(f.job)
    if (j && j.state !== "stopped") {
      closing.add(j.id)
      await chain(j.id, () => d.jobs.tell(ctx, j.id, TALK_END, "Talk over")).catch(() => closing.delete(j.id))
    }
    return { job: f.job, name: f.name }
  }

  /** Whether `m`, a Talk key ask, is the talk's: their words to the job with the floor (or their "back"). */
  function take(m: Moment, from?: IncomingMessage): boolean {
    const f = now()
    if (!f || m.kind !== "ask" || !m.summoned || !m.text?.trim() || m.tour) return false
    if (isBack(m.text)) { m.live = f.job; void end(d.ctx(from), m).catch((e) => console.error(`companion: talk: ${(e as Error).message}`)); return true }
    const j = jobOf(f.job)!
    f.at = Date.now()
    void send(d.ctx(from), j, f.name, m, false).catch((e) => {
      console.error(`companion: talk to ${j.id}: ${(e as Error).message}`)
      if (floor?.job === j.id) { d.gone(f.name); floor = null }
      delete m.live
      m.for = d.main()
      d.fallback(m)
    })
    return true
  }

  /** Job `j` moved on from `from`: a turn of the talk over, its words said by its cursor with their tags. True when it
   *  was the talk's (never news, no ready knock: they're talking). */
  function moved(j: Job, from: string) {
    if (live(j.state) || !live(from as Job["state"])) return false
    if (closing.delete(j.id)) { j.seen = true; return true }
    const f = now()
    if (!f || f.job !== j.id) return false
    j.seen = true
    const text = (j.result?.text ?? j.last?.text ?? "").trim()
    if (!text) { d.show(f.name, null); return true }
    const { said, tags } = parseTags(text.replace(/\s+/g, " "))
    void d.tags(f.name, tags, said).then(() => (said.trim() ? d.say(f.name, said.trim(), f.m) : undefined))
      .catch((e) => console.error(`companion: talk ${j.id}: ${(e as Error).message}`))
    return true
  }

  plugin.op({
    id: "companion.talk",
    cli: "companion talk",
    summary: "Hand the floor to a job: the user talks with its worker by voice (their Talk key's asks go to it, its answers come by its own cursor, in its own voice) till they say back; off: back now.",
    help: `When they want to talk with a job themselves ("let me talk to it", "can I ask the brainstorm one what it did?", or
pointing at one in the island: "talk to this one"). Their ask goes to it as its first words; you stay quiet till they
say back (the app's, as are their words to it meanwhile), so end your turn with no words. Unsure which job: ask.

  vau companion talk jd3k2h1g
  vau companion talk --off`,
    kind: "write",
    lock: false,
    params: { job: { type: "string", description: "the job (its id, or the end of it)" }, off: { type: "boolean", description: "end the talk: the floor back to the companion" } },
    args: ["job"],
    run: async (p, ctx) => {
      if (p.off === true) {
        const r = await end(ctx)
        if (!r) throw new OpError("no talk is on", 409)
        return { ended: true, ...r }
      }
      const id = typeof p.job === "string" ? p.job.trim() : ""
      if (!id) throw new OpError("job: which one (companion jobs lists them)")
      const m = d.askOf(d.main())
      return await begin(ctx, d.jobs.find(id), m && Date.now() - m.t < 120_000 && m.summoned ? m : undefined)
    },
    // (its first sentence is what a turn ending with no words says: the handover, aloud)
    text: (r) => (r.ended ? `The talk with ${r.name} is over: the floor is yours again.` : `Handing you to ${r.name}. It (${r.job}) has the floor and answers them aloud: end your turn with no words.`),
    did: (p) => ({ action: "run", text: p.off ? "Ended a talk with a job" : `Handed the floor to the job ${p.job}`, by: "companion" }),
  })

  return {
    take, moved,
    /** The name job `j` talks by while it has the floor (its terminal stays up). */
    talking: (j: Job) => now()?.job === j.id,
    floor: () => now(),
  }
}
