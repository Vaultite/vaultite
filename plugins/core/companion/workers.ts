// Jobs' workers: coding agents in the app's terminals (any harness, here or on another machine), read from what's tracked
// already (their terminal's state, their transcript), moving jobs.ts' lifecycle. Ops: handoff, jobs, job, job-stop, where, worker.
import { execFile } from "node:child_process"
import os from "node:os"
import { agentName, parseTerminal } from "../../../core/agents.ts"
import { gitEnv, type Machine, MACHINE_CLIENT, type OpCtx, OpError, type Plugin, quoted } from "../../../core/plugins.ts"
import { cardOf, type Job, type JobCard, type JobEvent, jobsLine, jobsText, jobTask, jobText, jobTimings, linkOf, linksIn, live, type Result, step, type Where } from "./jobs.ts"
import type { Moment } from "./plugin.ts"
import { type Found, headOf, machineOfUrl, type Over, refusal, repoOf, resolveHere, tilde, urlsIn } from "./where.ts"

/** What the plugin gives the jobs: the ask a handoff came from, its say, its action log, who an `as` names. */
export type JobDeps = {
  askOf: (name: string) => Moment | undefined
  say: (ctx: OpCtx, name: string, text: string) => Promise<unknown>
  did: (name: string, op: string) => void
  who: (p: Record<string, unknown>) => string
  cards: (cards: JobCard[]) => void
  as: object
}
/** A worker's terminal as read where it runs (the op companion.worker). */
export type Seen = { running: boolean; state?: string; kind?: string; msg?: string; title?: string
  turn?: { text: string; files: string[]; at: number; final: boolean } | null; diff?: string }

const KEEP = 40, KEEP_DAYS = 7
const str = (v: unknown) => (typeof v === "string" ? v : "")
const git = (cwd: string, args: string[]) => new Promise<string>((ok) => execFile("git", args, { cwd, timeout: 5000, maxBuffer: 4 << 20, env: gitEnv() }, (e, out) => ok(e ? "" : String(out))))
/** The changes since `base` in one line: files changed, lines in and out, new files, commits ("" when none). */
export async function diffSince(cwd: string, base: string) {
  if (!base) return ""
  const [stat, fresh, commits] = await Promise.all([git(cwd, ["diff", "--shortstat", base]), git(cwd, ["ls-files", "--others", "--exclude-standard"]), git(cwd, ["rev-list", "--count", `${base}..HEAD`])])
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(stat)
  const n = fresh.split("\n").filter(Boolean).length, c = Number(commits.trim()) || 0
  return [m ? `${m[1]} file${m[1] === "1" ? "" : "s"} changed, +${m[2] ?? 0} -${m[3] ?? 0}` : "", n ? `${n} new file${n > 1 ? "s" : ""}` : "", c ? `${c} commit${c > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ")
}
/** A terminal's title as a line of what it does: Claude Code's spinner and marks off. */
const titled = (t?: string) => (t ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim()
const newId = () => `j${Array.from({ length: 7 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")}`
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function jobOps(plugin: Plugin, d: JobDeps) {
  const setting = (k: string) => str(plugin.settings()[k]).trim() || str(plugin.manifest.settings?.[k]?.default)
  const lines = (k: string) => { const v = plugin.settings()[k] ?? plugin.manifest.settings?.[k]?.default; return Array.isArray(v) ? v.map(String).filter((x) => x.trim()) : [] }

  // ---------- the jobs, kept on this machine (runtime state: what's running), newest first
  let held: { vault: string; jobs: Job[] } | null = null
  const log = plugin.dayLog<{ t: number; job: string; ev: JobEvent; from: string; to: string }>("jobs")
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
  /** Event `ev` on job `j`: its move logged (the day's log too) and told; false when it doesn't move. */
  function move(j: Job, ev: JobEvent) {
    const x = step(j, ev)
    if (!x) return false
    log.append(x.t, [{ t: x.t, job: j.id, ev, from: x.from, to: x.to }])
    log.prune(30)
    return true
  }

  // ---------- another machine

  async function machines() { return await plugin.ask<Machine[]>("machines", []) }
  /** Op `id` run on machine `machine` with `body`, its server checking its owner again. */
  async function atMachine(machine: string, id: string, body: object, seconds = 15) {
    const m = await plugin.ask<Machine | null>("machines:machine", null, machine)
    if (!m || m.self) throw new OpError(`no machine '${machine}' (Machines lists them)`, 404)
    if (!m.online) throw new OpError(`${m.label} is offline`, 502)
    const r = await fetch(`${m.url}/api/ops/${id}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" }, body: JSON.stringify(body),
      signal: AbortSignal.timeout(seconds * 1000) }).catch(() => null)
    if (!r) throw new OpError(`${m.label} doesn't answer`, 502)
    const out = await r.json().catch(() => ({})) as Record<string, unknown>
    if (!r.ok) throw new OpError(`${m.label}: ${str(out.error) || `answered ${r.status}`}`, r.status)
    return out
  }
  const hostOf = (u: string) => { try { return new URL(u).hostname } catch { return "" } }
  async function labelOf(machine: string) {
    const id = machine || await plugin.ask<string>("machines:self", "")
    const m = id ? await plugin.ask<Machine | null>("machines:machine", null, id) : null
    return m?.label ?? (machine || os.hostname().replace(/\.local$/, ""))
  }

  // ---------- where it runs

  /** Where an ask over `o` (or `cwd`, as given) runs here: its folder, repo and base, or why it never runs here. */
  async function placeHere(o: Over, cwd: string): Promise<Found & { repo: string; base: string; refused: string }> {
    const self = (await machines()).filter((m) => m.self).map((m) => hostOf(m.url)).filter(Boolean)
    const found: Found = cwd ? { cwd: cwd.replace(/^~(?=$|\/)/, os.homedir()), why: "as asked" } : await resolveHere(o, plugin.vault.path, self)
    const top = found.cwd === plugin.vault.path ? "" : await repoOf(found.cwd)
    const at = top || found.cwd
    return { ...found, cwd: at, repo: top ? at.split("/").pop()! : "", base: top ? await headOf(top) : "", refused: refusal(at, lines("jobs_never")) || refusal(found.cwd, lines("jobs_never")) }
  }
  /** Where a handoff runs: as asked (machine, cwd), else from the ask: an address another machine serves goes there. */
  async function route(m: Moment | undefined, p: Record<string, unknown>): Promise<Omit<Where, "agent" | "account" | "harness" | "model" | "effort">> {
    const o: Over = m ? { url: m.url, app: m.app, title: m.title, path: m.path, screen: m.screen, under: m.under } : {}
    let machine = str(p.machine).trim()
    if (machine && (await plugin.ask<Machine | null>("machines:machine", null, machine))?.self) machine = ""
    if (!machine && !str(p.cwd)) {
      const hosts = Object.fromEntries((await machines()).filter((x) => !x.self && x.online).map((x) => [x.id, hostOf(x.url)]).filter(([, h]) => h))
      machine = machineOfUrl(o, hosts)?.machine ?? ""
    }
    const there = machine
      ? await atMachine(machine, "companion.where", { ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}), ...(o.url ? { url: o.url } : urlsIn(o)[0] ? { url: urlsIn(o)[0].href } : {}),
        ...(o.app ? { app: o.app } : {}), ...(o.title ? { title: o.title } : {}), ...(o.path ? { path: o.path } : {}) }) as unknown as Awaited<ReturnType<typeof placeHere>>
      : await placeHere(o, str(p.cwd))
    if (there.refused) throw new OpError(`it can't run there: ${there.refused}. Say so (where it would have run: ${tilde(there.cwd)})`, 403)
    return { machine, label: await labelOf(machine), cwd: there.cwd, repo: there.repo, why: there.why, ...(there.base ? { base: there.base } : {}), ...(there.preview ? { preview: there.preview } : {}) }
  }
  /** Who works on it: the harness asked (Claude Code in the jobs' account by default), its model and effort. */
  function harnessOf(p: Record<string, unknown>) {
    const asked = str(p.agent) || "claude", own = setting("jobs_agent") || "claude"
    const agent = asked === "claude" && own.split("_")[0] === "claude" ? own : asked
    const claude = agent.split("_")[0] === "claude"
    const model = str(p.model) || (claude ? setting("jobs_model") : ""), effort = str(p.effort) || (claude ? setting("jobs_effort") : "")
    const profile = parseTerminal(`${agent}-x`)?.profile ?? ""
    return { agent, account: profile ? cap(profile) : "", model, effort, harness: [agentName(agent.split("_")[0]) ?? cap(agent), cap(model)].filter(Boolean).join(" ") }
  }

  // ---------- reading its worker

  /** Its terminal here as it is: running, its state, title, and with `turn` its last turn and the diff since `base`. */
  async function seenHere(id: string, o: { turn?: boolean; cwd?: string; base?: string } = {}): Promise<Seen> {
    const running = await plugin.ask<boolean>("terminal:runs", false, id)
    const st = await plugin.ask<{ state?: string; kind?: string; msg?: string } | null>("terminal:state", null, id)
    const info = running ? await plugin.ask<{ title?: string } | null>("terminal:info", null, id) : null
    const agent = parseTerminal(id)?.agent ?? ""
    const turn = o.turn && agent ? await plugin.ask<{ text?: string; files?: string[]; at?: number; final?: boolean } | null>(`agent-turn:${agent}`, null, id, "") : null
    return { running, ...(st?.state ? { state: st.state } : {}), ...(st?.kind ? { kind: st.kind } : {}), ...(st?.msg ? { msg: st.msg } : {}), ...(info?.title ? { title: info.title } : {}),
      ...(o.turn ? { turn: turn ? { text: str(turn.text), files: turn.files ?? [], at: turn.at ?? 0, final: turn.final !== false && !!turn.text } : null } : {}),
      ...(o.turn && o.cwd && o.base ? { diff: await diffSince(o.cwd, o.base) } : {}) }
  }
  const seenOf = (j: Job, turn = false) => (j.where.machine
    ? atMachine(j.where.machine, "companion.worker", { id: j.terminal, ...(turn ? { turn, cwd: j.where.cwd, ...(j.where.base ? { base: j.where.base } : {}) } : {}) }, 10) as Promise<Seen>
    : seenHere(j.terminal, { turn, cwd: j.where.cwd, base: j.where.base }))

  /** When each job's worker was first seen at rest (its turn may be over once that holds). */
  const resting = new Map<string, number>()
  const busy = new Set<string>()
  const HOLD = 1500
  /** Job `j` read again: its worker's state moves it (a rest that holds is its turn's end: its results read then). */
  async function refresh(j: Job) {
    if (busy.has(j.id) || j.state === "stopped" || !j.terminal) return
    busy.add(j.id)
    try {
      const s = await seenOf(j).catch(() => null)
      // (a machine away or slow: not an end)
      if (!s) return
      let moved = false
      const was = j.now
      j.now = s.kind ? `waits on ${s.kind === "permission" ? "a permission" : s.kind === "question" ? "an answer" : s.kind}${s.msg ? `: ${s.msg}` : ""}` : s.msg || titled(s.title) || j.now
      if (!s.running) { moved = move(j, "ended"); resting.delete(j.id) }
      else if (s.state === "working") { j.stepped ??= Date.now(); moved = move(j, "working"); resting.delete(j.id) }
      else if (s.state === "blocked") { moved = move(j, "asks"); resting.delete(j.id) }
      else if (s.state === "error") { moved = move(j, "error"); resting.delete(j.id) }
      else if ((s.state === "idle" || s.state === "done") && (j.state === "working" || j.state === "needs you" || j.state === "starting")) {
        const since = resting.get(j.id)
        if (since === undefined) { resting.set(j.id, Date.now()); setTimeout(() => void refresh(j), HOLD + 100).unref?.() }
        else if (Date.now() - since >= HOLD) moved = await finish(j)
      }
      if (moved || j.now !== was) changed()
    } finally { busy.delete(j.id) }
  }
  /** Its turn over: what it ended with, and whether it changed anything to review. A job still starting counts only once
   *  its transcript has an answer since it began (Claude Code rests a moment before its first step). */
  async function finish(j: Job) {
    const s = await seenOf(j, true).catch(() => null)
    if (!s) return false
    const t = s.turn
    if (j.state === "starting" && !(t?.final && t.at >= j.turn - 1000)) return false
    resting.delete(j.id)
    const text = t && t.at >= j.turn - 1000 ? t.text : ""
    const result: Result = { ...(text ? { text: text.slice(0, 4000) } : {}), ...(t?.files?.length ? { files: t.files.map((f) => tilde(f)).slice(0, 40) } : {}),
      ...(s.diff ? { diff: s.diff } : !s.diff && t?.files?.length && j.where.repo ? { diff: `${t.files.length} file${t.files.length > 1 ? "s" : ""} changed` } : {}),
      ...linksIn(text, j.where.preview) }
    j.result = result
    return move(j, j.where.repo && (s.diff || t?.files?.length) ? "changed" : "answered")
  }

  // Its terminal here tells its changes (its hooks, OSC 7501, its end); one on another machine is asked now and then.
  plugin.onEvent({ types: ["terminal.state", "terminal.ended"] }, (ev) => {
    const j = all().find((x) => !x.where.machine && x.terminal === str(ev.id))
    if (j) void refresh(j).catch((e) => console.error("companion: jobs:", e))
  })
  let ticks = 0
  const timer = setInterval(() => {
    ticks++
    for (const j of all()) {
      const recent = Date.now() - j.at < 6 * 3600_000
      if (live(j.state) ? (j.where.machine || ticks % 2 === 0) : j.where.machine && j.state !== "stopped" && recent && ticks % 10 === 0) void refresh(j).catch(() => {})
    }
  }, 3000)
  timer.unref?.()
  plugin.onUnload(() => clearInterval(timer))

  const jobOf = (id: string) => {
    const want = id.trim(), j = all().find((x) => x.id === want) ?? all().find((x) => want.length >= 3 && x.id.endsWith(want))
    if (!j) throw new OpError(`no job ${want} (companion jobs lists them)`, 404)
    return j
  }
  const terminalOf = (j: Job) => `${j.terminal}${j.where.machine ? `@${j.where.machine}` : ""}`

  /** A follow-up or correction to job `j`, typed into its worker's terminal (the user's own words, as if they typed). */
  async function steer(ctx: OpCtx, j: Job, text: string) {
    if (j.state === "stopped") throw new OpError(`${j.id} was stopped: hand it off again`, 409)
    const s = await seenOf(j).catch(() => null)
    if (s && !s.running) { move(j, "ended"); changed(); throw new OpError(`${j.id}'s terminal ended: hand it off again`, 409) }
    if (s?.state === "blocked" && s.kind === "permission") throw new OpError(`${j.id} waits on a permission in its terminal (${s.msg ?? "open it"}): only the user answers it there (${linkOf(j)})`, 409)
    const r = await ctx.op("terminal.send", { id: terminalOf(j), text }) as { submitted?: boolean | null; why?: string }
    if (r.submitted === false) throw new OpError(`it didn't take it: ${r.why ?? "its input kept the text"} (${linkOf(j)})`, 409)
    move(j, "told")
    j.turn = Date.now()
    resting.delete(j.id)
    changed()
  }

  plugin.op({
    id: "companion.handoff",
    cli: "companion handoff",
    summary: "Hand long work to a worker: a coding agent (Claude Code on Opus, or Codex) in a terminal of the app, where the ask was (its repo, here or on another machine); job: tell one more.",
    help: `For what takes more than a minute or two: code, research, a document, a long errand, writing in their notes. It
runs where the ask was over, derived on the spot: a preview's address (localhost, a Tailscale name: the process
serving it, its repo, on its machine), a GitHub page (its checkout here), an editor's window (its project), a note (the
vault); cwd and machine say it instead. A job is in the menu bar's Jobs (starting, working, needs you, ready for
review, done, failed, stopped) with where it runs; opening it opens its terminal, where the user can type. A coding job
ends ready for review (its diff, a preview's link): nothing ships, deploys or goes out unless they say so. Your say
shows by your cursor as it starts; then end your turn. job: a follow-up or a correction to one of yours (companion
jobs), typed into its terminal. A folder the jobs may never run in (the setting jobs_never) is refused: say why.

  vau companion handoff "Make the header blue on this page" --say "On it: a session in personal-website."
  vau companion handoff "Use the darker blue instead" --job jd3k2h1g --say "Telling it."`,
    kind: "write",
    lock: false,
    params: { task: { type: "string", required: true, description: "what to do, standing alone: the goal, where, what to end with (the ask's words, place and picture go with it); with job, what to tell it" },
      say: { type: "string", required: true, description: "what you tell the user now, a few words, saying where it runs (On it: a session in personal-website)" },
      agent: { type: "string", enum: ["claude", "codex", "opencode"], default: "claude", description: "who does it: Claude Code (on Opus, high, unless model says), Codex or OpenCode" },
      model: { type: "string", description: "its model (default: the setting jobs_model for Claude Code, the agent's own else)" },
      effort: { type: "string", description: "how hard it thinks (default: the setting jobs_effort for Claude Code)" },
      title: { type: "string", description: "its name in the menu bar's Jobs (default: the task's first words)" },
      cwd: { type: "string", description: "the folder it works in (~ for home), instead of the one the ask was over" },
      machine: { type: "string", description: "another of the Machines to run it on, by id (with cwd: that machine's folder)" },
      job: { type: "string", description: "a follow-up to this job of yours (its id): typed into its terminal" }, as: d.as },
    args: ["task"],
    run: async (p, ctx) => {
      const name = d.who(p), task = str(p.task).trim()
      if (!task) throw new OpError("task: what to do")
      if (str(p.job)) {
        const j = jobOf(str(p.job))
        await steer(ctx, j, task)
        d.did(name, "handoff")
        await d.say(ctx, name, str(p.say))
        return cardOf(j)
      }
      const m = d.askOf(name)
      const where: Where = { ...await route(m, p), ...harnessOf(p) }
      const now = Date.now(), title = (str(p.title).trim() || task.replace(/\s+/g, " ")).slice(0, 80).replace(/^(.{60,}?)\s.*$/, "$1…")
      const j: Job = { id: newId(), title, state: "starting", where, terminal: "", now: `starting in ${tilde(where.cwd)}`, ...(m ? { asked: m.t } : {}), started: now, turn: now, at: now, seen: false, log: [] }
      all().unshift(j)
      try {
        const r = await ctx.op("terminal.start", { agent: where.agent, prompt: jobTask(task, m, !!where.repo), name: title, cwd: where.cwd,
          ...(where.model ? { model: where.model } : {}), ...(where.effort ? { effort: where.effort } : {}),
          ...(where.agent.split("_")[0] === "claude" && setting("jobs_mode") ? { mode: setting("jobs_mode") } : {}), ...(where.machine ? { machine: where.machine } : {}) }) as { id: string }
        j.terminal = r.id.split("@")[0]
      } catch (e) {
        j.now = (e as Error).message
        move(j, "error")
        changed()
        throw e
      }
      j.carded = Date.now()
      changed()
      d.did(name, "handoff")
      await d.say(ctx, name, str(p.say))
      return { ...cardOf(j), why: where.why }
    },
    text: (r) => `Handed off (${r.id}): "${r.title}", ${r.state}, on ${r.where}${r.why ? ` (${r.why})` : ""}. The user sees it in Jobs and hears when it's ready: end your turn.`,
    did: (p) => ({ action: "run", text: p.job ? `Told the job ${p.job} ${quoted(p.task, 60)}` : `Handed off ${quoted(p.task, 60)}`, by: d.who(p) }),
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
      await refresh(j).catch(() => {})
      return j
    },
    text: (r) => jobText(r),
  })

  plugin.op({
    id: "companion.job-stop",
    cli: "companion job-stop",
    summary: "Stop a job (its worker's terminal ends; its conversation stays, to resume); one ready for review is closed as done.",
    help: `  vau companion job-stop jd3k2h1g`,
    kind: "write",
    lock: false,
    params: { id: { type: "string", required: true, description: "the job's id (or the end of it)" }, as: d.as },
    args: ["id"],
    run: async (p, ctx) => {
      const j = jobOf(str(p.id))
      // (the user's own stop: nothing new to tell them)
      if (move(j, "stop")) { j.seen = true; changed() }
      await ctx.op("terminal.end", { id: terminalOf(j) }).catch((e: unknown) => { if (!(e instanceof OpError && (e.status === 404 || e.status === 502))) throw e })
      return cardOf(j)
    },
    text: (r) => `${r.state === "done" ? "Closed" : "Stopped"} "${r.title}" (${r.id}): ${r.state}.`,
    did: (p) => ({ action: "run", text: `Stopped the job ${p.id}`, by: d.who(p) }),
  })

  plugin.op({
    id: "companion.where",
    cli: "companion where",
    owner: "the companion's jobs",
    summary: "Where a job asked over a page, an app's window or a note would run on this machine: the folder, its repo, why (another machine's companion asks it too).",
    help: `  vau companion where --url http://localhost:5173
  vau companion where --url https://github.com/lighthouse/site`,
    kind: "read",
    params: { url: { type: "string", description: "the page's address" }, app: { type: "string", description: "the app (its bundle id)" }, title: { type: "string", description: "its window's title" },
      path: { type: "string", description: "a note's path" }, cwd: { type: "string", description: "a folder, as given" } },
    run: async (p) => placeHere({ url: str(p.url) || undefined, app: str(p.app) || undefined, title: str(p.title) || undefined, path: str(p.path) || undefined }, str(p.cwd)),
    text: (r) => `${tilde(r.cwd)}${r.repo ? ` (${r.repo})` : ""}: ${r.why}${r.refused ? `. Refused: ${r.refused}` : ""}`,
  })

  plugin.op({
    id: "companion.worker",
    cli: "companion worker",
    owner: "the companion's jobs",
    summary: "A job's worker terminal on this machine as Vaultite reads it: running, its state and title; turn: its last turn, and the diff since base in cwd.",
    kind: "read",
    params: { id: { type: "string", required: true, description: "its terminal's id" }, turn: { type: "boolean", description: "its last turn and the diff too" },
      cwd: { type: "string", description: "its folder (the diff's)" }, base: { type: "string", description: "the commit the diff counts from" } },
    args: ["id"],
    run: async (p) => seenHere(str(p.id), { turn: p.turn === true, cwd: str(p.cwd), base: str(p.base) }),
  })

  /** Jobs the user opened: no longer news. */
  function seen(ids: string[]) {
    let any = false
    for (const j of all()) if (ids.includes(j.id) && !j.seen) { j.seen = true; any = true }
    if (any) changed()
  }

  return {
    list: all, cards, seen,
    line: () => jobsLine(all()),
    /** How fast the day's jobs got going, for companion timings. */
    timings: (day: string, dayOf: (t: number) => string) => jobTimings(all().filter((j) => dayOf(j.started) === day)),
  }
}
