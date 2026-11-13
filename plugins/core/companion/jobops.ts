import { OpError, type Plugin, quoted, userSurface } from "../../../core/plugins.ts"
import { cardOf, choiceIn, jobsText, jobText, linkOf, queuedLine, terminalOf, str } from "./jobs.ts"
import { BY_THEIR_WORD, NOT_THEIRS, plainWords, wordsOf } from "./jobword.ts"
import type { JobCore, JobDeps } from "./workers.ts"


export function jobsOps(plugin: Plugin, d: JobDeps, core: JobCore) {
  const { jobOf, refresh, links, changed, all, seen, wake, clockOf, close, unsure } = core
  const theirWord = wordsOf(plugin)
  plugin.op({
    id: "companion.job-answer",
    cli: "companion job-answer",
    summary: "Answer what a job's worker waits on (trust its folder, a permission, its question) with the user's choice, pressed in its terminal as its notification's buttons do: only on their own clear words.",
    help: `choice: one of the choices companion job lists for it (its words or number; yes or no for a permission). The
terminal's menu cursor is moved onto it and checked there before Enter (trust and imports default to No). From an agent
(you), only while answering the user's ask (their Talk key's, or their latest message in your session, read from
its transcript) that names it, made after it began waiting, with said quoting their words:
never on your own, nor guessed from a vague ask (unsure: ask them which). A question in several parts is answered in
its terminal (companion job-open).

  vau companion job-answer jd3k2h1g --choice "Yes, I trust this folder" --said "yes, trust it"`,
    kind: "write",
    lock: false,
    params: { id: { type: "string", required: true, description: "the job's id (or the end of it)" },
      choice: { type: "string", required: true, description: "the choice: its words or number, or yes / no for a permission" },
      said: { type: "string", description: "from an agent: the user's words that name the choice, as they said them (their ask, or their latest message to you)" }, as: d.as },
    args: ["id", "choice"],
    run: async (p, ctx) => {
      const j = jobOf(str(p.id))
      await refresh(j, true).catch(() => {})
      const w = j.waits
      if (j.state !== "needs you" || !w) throw new OpError(`${j.id} doesn't wait on anything now (${j.state})`, 409)
      if (!w.choices.length) throw new OpError(`what it asks is answered in its terminal: companion job-open ${j.id}`, 409)
      const n = choiceIn(w, str(p.choice))
      if (!n) throw new OpError(`choice: one of ${w.choices.map((c, i) => `${i + 1} "${c}"`).join(", ")}`)
      let by = ctx.who
      if (!userSurface(ctx.who)) {
        const m = d.own(d.who(p), ctx) ? d.askOf(d.who(p)) : undefined
        const word = await theirWord(ctx, m, plainWords(str(p.said)), { since: w.at })
        if ("why" in word) throw new OpError(`${NOT_THEIRS} (${word.why})`, 403)
        by = { ...BY_THEIR_WORD, label: word.by }
      }
      if (j.where.cloud) {
        if (w.kind === "permission") throw new OpError(`a cloud session's permission is answered in its session: companion job-open ${j.id}`, 409)
        await links.of(j.where).tell(ctx, j.terminal, w.choices[n - 1])
        delete j.waits
        j.now = `Answered: ${w.choices[n - 1]}`
        changed()
        d.did(d.who(p), "job-answer")
        return { ...cardOf(j), answered: w.choices[n - 1] }
      }
      type Row = { id: string; kind: string; state: string; terminal?: string }
      let e: Row | undefined
      for (let i = 0; i < 16 && !e; i++) {
        if (i) await new Promise((r) => setTimeout(r, 250))
        const { events } = await ctx.api("GET", "inbox/events?all=1") as { events: Row[] }
        e = events.find((x) => x.kind === "session" && x.state === "open" && x.terminal === terminalOf(j))
      }
      if (!e) throw new OpError(`its prompt isn't open in the inbox now: open it (companion job-open ${j.id})`, 409)
      await plugin.runOp("inbox.answer", w.kind === "permission" ? { id: e.id, answer: n === 1 ? "approve" : "deny" } : { id: e.id, answer: "pick", picks: [String(n)] }, by)
      delete j.waits
      j.now = `Answered: ${w.choices[n - 1]}`
      changed()
      d.did(d.who(p), "job-answer")
      return { ...cardOf(j), answered: w.choices[n - 1] }
    },
    text: (r) => `Answered "${r.answered}" in "${r.title}" (${r.id}).`,
    did: (p) => ({ action: "run", text: `Answered the job ${p.id}: ${quoted(p.choice, 60)}`, by: d.who(p) }),
  })

  plugin.op({
    id: "companion.jobs",
    cli: "companion jobs",
    summary: "The companion's jobs, newest first: each one's state (starting, working, needs you, ready for review, done, failed, stopped), where it runs, how long, what it does now and its results.",
    help: `seen: jobs the user opened, no longer counted new (the menu bar's badge).

  vau companion jobs`,
    kind: "read",
    params: { seen: { type: "array", items: { type: "string" }, description: "jobs the user saw: no longer counted new" } },
    run: async (p) => {
      if (Array.isArray(p.seen) && p.seen.length) seen(p.seen.map(String))
      return { jobs: all() }
    },
    text: (r) => jobsText(r.jobs),
  })

  plugin.op({
    id: "companion.job",
    cli: "companion job",
    summary: "How one job goes: its state, where it runs, how long, what it does now, its diff, PR and link, what it said last (how's it going? this).",
    help: `  vau companion job jd3k2h1g`,
    kind: "read",
    params: { id: { type: "string", required: true, description: "the job's id (or the end of it): companion jobs lists them" } },
    args: ["id"],
    run: async (p) => {
      const j = jobOf(str(p.id))
      await refresh(j, true).catch(() => {})
      return j
    },
    text: (r) => jobText(r),
  })

  plugin.op({
    id: "companion.job-open",
    cli: "companion job-open",
    summary: "Open a job's terminal in a tab (as its card does), or in a split beside or below when they say where: one closed once it was done resumes its conversation first.",
    help: `  vau companion job-open jd3k2h1g
  vau companion job-open jd3k2h1g --split right`,
    kind: "write",
    lock: false,
    params: { id: { type: "string", required: true, description: "the job's id (or the end of it)" },
      split: { type: "string", enum: ["right", "down"], description: "in a pane beside (right) or below (down), not a new tab" } },
    args: ["id"],
    run: async (p, ctx) => {
      const j = jobOf(str(p.id))
      if (j.state === "waiting") throw new OpError(`"${j.title}" ${queuedLine(j).toLowerCase()}: it has no terminal yet`, 409)
      if (j.state !== "stopped" && await wake(ctx, j)) changed()
      clockOf(j).opened = Date.now()
      seen([j.id])
      await ctx.op("ui.open", { path: linkOf(j), ...(p.split ? { split: p.split } : {}) })
      return cardOf(j)
    },
    text: (r, p) => `Opened "${r.title}" (${r.id})${p.split ? ` in a split ${p.split}` : ""}.`,
    did: (p) => ({ action: "ui", text: `Opened the job ${p.id}${p.split ? ` (split ${p.split})` : ""}` }),
  })

  plugin.op({
    id: "companion.job-stop",
    cli: "companion job-stop",
    summary: "Stop a job (its worker's terminal ends; its conversation stays, to resume); one ready for review is closed as done, only on the user's own word.",
    help: `A job ready for review (or merging what they kept) is closed by an agent only with said quoting the user's words
that close it ("close it", "drop it"): their ask to the companion, or their latest message in your own session (typed
by them, read from its transcript). Never as a fallback for "keep it", nor on your own. Unsure what they want: ask
in one short line, merge it or close it as it is (each a button).

  vau companion job-stop jd3k2h1g
  vau companion job-stop jd3k2h1g --said "just close it"`,
    kind: "write",
    lock: false,
    params: { id: { type: "string", required: true, description: "the job's id (or the end of it)" },
      said: { type: "string", description: "from an agent, for a job ready for review: the user's words that close it, as they said them (their ask, or their latest message to you)" },
      which: { type: "string", description: "their words naming that job, when their ask was over another job's terminal" }, as: d.as },
    args: ["id"],
    run: async (p, ctx) => {
      const j = jobOf(str(p.id))
      let byWord = ""
      if (ctx.who.agent) {
        const m = d.own(d.who(p), ctx) ? d.askOf(d.who(p)) : undefined, why = unsure(j, m, str(p.which))
        if (why) throw new OpError(why, 409)
        if (j.state === "ready for review" || (j.land && j.land.at === undefined)) {
          const word = await theirWord(ctx, m, plainWords(str(p.said)), { closes: true })
          if ("why" in word) throw new OpError(`"${j.title}" is ready for review: it's closed only on their own word (said quoting it: "close it"). Not this time: ${word.why}. Else ask them in one short line, merge it or close it as it is, each a button`, 403)
          byWord = word.by
        }
      }
      await close(ctx, j)
      return { ...cardOf(j), ...(byWord ? { word: byWord } : {}) }
    },
    text: (r) => `${r.state === "done" ? "Closed" : "Stopped"} "${r.title}" (${r.id}): ${r.state}${r.word ? `, on the word of ${r.word}` : ""}.`,
    did: (p) => ({ action: "run", text: `Stopped the job ${p.id}`, by: d.who(p) }),
  })
}
