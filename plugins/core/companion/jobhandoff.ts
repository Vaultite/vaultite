import { type OpCtx, OpError, type Plugin, quoted } from "../../../core/plugins.ts"
import { cardOf, followTask, type Handoff, type Queued, str } from "./jobs.ts"
import type { Machines } from "./jobmachines.ts"
import { tellerOf, type Told, toldTogether } from "./jobtold.ts"
import type { Moment } from "./types.ts"
import type { JobCore, JobDeps } from "./workers.ts"

const ANSWERING_MS = 10 * 60_000

export function handoffOps(plugin: Plugin, d: JobDeps, core: JobCore, machines: Machines) {
  const { jobOf, unsure, keep, land, steer, retitle, begin } = core, { away } = machines, { holding, heldTold, release } = toldTogether(d)
  plugin.op({
    id: "companion.handoff",
    cli: "companion handoff",
    summary: "Hand work they'd leave to run to a worker: a coding agent (Claude Code on Opus, or Codex) in a terminal of the app, where the ask was (its repo, here or on another machine); job: tell one more.",
    help: `For work they'd leave to run: code or a change to an app, site or repo, research across many sources, a document
they won't sit through, a mini-app, a slow errand. What they'd watch or join (being taught, an explanation, a plan, a
recipe, a note written with them, a quick tweak to the page or note in front of them) isn't a handoff, however long:
do it in front of them (a note: open with new, then edit; a page: your tool that changes it live), handing off only
the lasting fix (its code).
Their words win: "do it here" or "with me" is never a handoff; "in the background" or "make it a job" always is. It
runs where the ask was over, derived on the spot: a preview's address (localhost, a Tailscale name: the process
serving it, its repo, on its machine), a live site (the checkout whose deploy config names its address), a GitHub page (its checkout here), an editor's window (its project), a note (the
vault); an ask about Vaultite itself (how its panels, sidebars, menus, views, the web viewer's own bar or you look or
behave: about app, or their pointer on the app's own UI) runs in Vaultite's repo, whatever page or note the pane shows;
cwd and machine say it instead. A job is in the menu bar's Jobs (starting, working, needs you, ready for
review, done, failed, stopped) with where it runs; opening it opens its terminal, where the user can type. A coding job
works in its own git worktree and branch beside the checkout (repo-<job id>, branch job-<job id>), never in the
checkout itself (one over a preview they watch edits what serves it, live), and ends ready for review (its diff, a preview's link): nothing ships, deploys or goes out unless they
say so; Keep and merge (or land) lands it from that worktree and removes it. Every
handoff announces itself in one short line ("Handed that off to a background agent."; a follow-up, "Passed that on to its job.";
several in one turn, one line naming their jobs);
say replaces it, still one short line, only when they need more (a question, an unexpected place), or when their ask
also asked you something (about you, Vaultite, what you can do): then say answers that too, in two short sentences at
most. End your turn. account: a Claude Code account (vau limits lists them: personal, agent...), for a new job only.
A machine that's offline keeps what's handed to it (a new job waits, shown so in Jobs; a follow-up waits on its job)
and gets it once it's back, by itself: never ask them to retry. From
another agent or a script (not the companion), nothing is said and no ask of the user's goes with it: task is all it has
(nor from the companion, an ask long past: only the one it answers). job: a follow-up or a correction to one of yours (companion
jobs), typed into its terminal; anything about its result ("merge it", "try X too") goes to it too, done or closed (it
resumes), with land for their word to merge it, and ask false when their ask isn't about its work. A folder the jobs may never run in (the setting jobs_never) is refused: say why.

  vau companion handoff "Make the header blue on this page"
  vau companion handoff "Use the darker blue instead" --job jd3k2h1g
  vau companion handoff "They said merge it" --job jd3k2h1g --land
  vau companion handoff "Say hi" --account personal --machine m1`,
    kind: "write",
    lock: false,
    params: { task: { type: "string", required: true, description: "what to do, standing alone: the goal, where, what to end with (the ask's words, place and picture go with it); with job, a short note of what it's for: their words, place and picture go with it too" },
      say: { type: "string", description: "one short line instead of the default announcement (Handed that off to a background agent.), only when they need more (a question, an unexpected place it runs)" },
      agent: { type: "string", enum: ["claude", "codex", "opencode"], default: "claude", description: "who does it: Claude Code (on Opus, high, unless model says), Codex or OpenCode" },
      account: { type: "string", description: "the Claude Code account it runs in, by its id as vau limits lists them on that machine (personal, agent, default...); default: the setting jobs_agent's" },
      model: { type: "string", description: "its model, as they said it for Claude Code (Fable 5.2, opus, a full id; default: the setting jobs_model), the agent's own name else" },
      effort: { type: "string", description: "how hard it thinks (default: the setting jobs_effort for Claude Code)" },
      title: { type: "string", description: "its name in the menu bar's Jobs (default: the task's first words); with job, its new name, when the follow-up changes what it's about" },
      cwd: { type: "string", description: "the folder it works in (~ for home), instead of the one the ask was over; one not on that machine is its own checkout of that repo there" },
      repo: { type: "string", description: "the repo it works in, by GitHub's owner/name or its folder's name (vaultite): each machine's own checkout of it (with machine: that one's); only when their words name it: over a page, its own checkout (the one serving or deploying it) wins over a repo guessed from its title. Vaultite's own UI: about app instead" },
      about: { type: "string", enum: ["app", "work"], description: "what their ask is about: app, Vaultite itself (how its panels, sidebars, menus, views, the web viewer's own bar, the Talk list or you look or behave: a bug or a change in the app), which runs in Vaultite's repo whatever page or note is in the pane; work, their notes, errands or a page's own content, even asked over the app's panels. Left out, what was under their pointer decides (the app's own UI: app)" },
      machine: { type: "string", description: "another of the Machines to run it on, by id (with cwd: that machine's folder)" },
      job: { type: "string", description: "a follow-up to this job of yours (its id): typed into its terminal" },
      land: { type: "boolean", description: "with job: their word to merge what it made (merge it, ship it): it's told to land it as its repo's rules say, and closes once merged" },
      ask: { type: "boolean", default: true, description: "with job: false when their ask isn't about that job's work (questions to you, another errand, sending on what they asked before): only task goes, never their words" },
      which: { type: "string", description: "with job: their words naming that job, when their ask was over another job's terminal" }, as: d.as },
    args: ["task"],
    run: async (p, ctx) => {
      const name = d.who(p), task = str(p.task).trim()
      if (!task) throw new OpError("task: what to do")
      const own = d.own(name, ctx), latest = own ? d.askOf(name) : undefined, ask = latest && Date.now() - latest.t <= ANSWERING_MS ? latest : undefined
      const by = tellerOf(ctx, own ? name : "")
      if (!own) return await handoff(p, ctx, task, ask, by, async () => {})
      holding(name, ctx, ask?.t ?? Date.now())
      try { return await handoff(p, ctx, task, ask, by, async (t: Told) => { d.did(name, "handoff"); heldTold(name, { ...t, say: str(p.say).trim() }) }) }
      finally { release(name) }
    },
    text: (r) => "queued" in r ? `Kept for later (${r.id}): "${r.title}". ${r.now}: it's sent by itself then, shown waiting in Jobs; nothing for them to retry. End your turn.`
      : `Handed off (${r.id}): "${r.title}", ${r.state}, on ${r.where}${r.why ? ` (${r.why})` : ""}. The user sees it in Jobs: end your turn.`,
    did: (p) => ({ action: "run", text: p.job ? `Told the job ${p.job} ${quoted(p.task, 60)}` : `Handed off ${quoted(p.task, 60)}`, by: d.who(p) }),
  })

  async function handoff(p: Handoff, ctx: OpCtx, task: string, ask: Moment | undefined, by: string, told: (t: Told) => Promise<void>) {
      const sent = ask?.live
      if (sent) throw new OpError(`this ask already went straight to the job ${sent} working on that page (live editing), which does it: end your turn`, 409)
      if (str(p.job)) {
        const j = jobOf(str(p.job))
        const m = ask, fresh = m && p.ask !== false && m.t > (j.asked ?? 0) ? m : undefined
        const unsureWhy = ctx.who.agent ? unsure(j, m, str(p.which)) : ""
        if (unsureWhy) throw new OpError(unsureWhy, 409)
        if (str(p.account)) throw new OpError("account is a new job's: a job keeps the account it runs in")
        const text = followTask(task, fresh, j.id), title = str(p.title).trim()
        const q: Queued = { note: task, text, at: Date.now(), ...(p.land === true ? { land: true, shown: task } : {}), ...(title ? { title } : {}), by: ctx.who, teller: by }
        if (j.queued?.length) { const kept = keep(j, q); if (kept && fresh) j.asked = fresh.t; await told({ kind: "kept", title: j.title, line: kept ? `${j.where.label} is still offline: that goes to its job once it's back.` : `That's already waiting for ${j.where.label}.` }); return { ...cardOf(j), queued: true } }
        try {
          if (p.land === true) await land(ctx, j, text, task, by)
          else await steer(ctx, j, text, text, by)
        } catch (e) {
          if (!await away(j.where.machine, e)) throw e
          keep(j, q)
          if (fresh) j.asked = fresh.t
          await told({ kind: "kept", title: j.title, line: `${j.where.label} is offline: I'll pass that on to its job once it's back.` })
          return { ...cardOf(j), queued: true }
        }
        if (fresh) j.asked = fresh.t
        if (title) await retitle(ctx, j, title)
        await told(p.land === true ? { kind: "land", title: j.title, line: "Told its job to merge it." } : { kind: "follow", title: j.title, line: "Passed that on to its job." })
        return cardOf(j)
      }
      const j = await begin(ctx, task, ask, p, by)
      await told(j.state === "waiting" ? { kind: "kept", title: j.title, line: `${j.where.label} is offline: the job starts there once it's back.` } : { kind: "new", title: j.title, line: "Handed that off to a background agent." })
      return { ...cardOf(j), why: j.where.why, ...(j.state === "waiting" ? { queued: true } : {}) }
  }
}
