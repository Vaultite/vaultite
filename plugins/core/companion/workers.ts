// Jobs' workers: coding agents in the app's terminals (any harness, here or on another machine), read from what's tracked
// already (their terminal's state, their transcript), moving jobs.ts' lifecycle. Ops: handoff, jobs, job, job-stop, where, worker.
import { execFile } from "node:child_process"
import os from "node:os"
import { agentName, parseTerminal } from "../../../core/agents.ts"
import { gitEnv, inDesktop, type Machine, MACHINE_CLIENT, type OpCtx, OpError, type Plugin, quoted, userSurface, whoOf } from "../../../core/plugins.ts"
import { cardOf, choiceIn, endEvent, followTask, gist, type Job, type JobCard, type JobEvent, jobsLine, jobsText, jobTask, jobText, jobTimings, lastOf, linkOf, linksIn, live, nowOf, type Result, resumeOf,
  step, type Waits, type Where } from "./jobs.ts"
import type { Moment } from "./plugin.ts"
import { branchOf, type Found, githubOf, headOf, machineOfUrl, onlyHere, type Over, preferredMachine, refusal, repoOf, resolveHere, tilde, urlsIn, watched } from "./where.ts"

/** What the plugin gives the jobs: the ask a handoff came from, its say, its action log, who an `as` names. */
export type JobDeps = {
  askOf: (name: string) => Moment | undefined
  say: (ctx: OpCtx, name: string, text: string) => Promise<unknown>
  did: (name: string, op: string) => void
  who: (p: Record<string, unknown>) => string
  cards: (cards: JobCard[]) => void
  /** Job `j` moved on from `from` (its news told aloud, where the user is). */
  moved?: (j: Job, from: string) => void
  /** Whether a window shows `link` in its shown tab. */
  onScreen?: (link: string) => boolean
  as: object
}
/** A worker's terminal as read where it runs (the op companion.worker): `typed` when the user last typed in one of its
 *  tabs, `asks` the questions it waits on, `waits` the prompt it's blocked on, its turn's `prompt` the last it was told. */
export type Seen = { running: boolean; state?: string; kind?: string; msg?: string; title?: string; typed?: number; asks?: string[]; waits?: Omit<Waits, "at">
  turn?: { text: string; files: string[]; at: number; final: boolean; session?: string; prompt?: string; background?: number } | null; diff?: string
  /** How its terminal ended, when it did and that's known. */
  exit?: { code: number; signal: number; lost?: boolean } }

const KEEP = 40, KEEP_DAYS = 7
/** How long a job done keeps its terminal: follow-ups mostly come within a minute or two, and still find it running. */
let grace = 120_000
/** Another grace (the tests'). */
export const tidyAfter = (ms: number) => { grace = ms }
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
const NOT_THEIRS = "only on the user's own words: answer it while answering their ask that names the choice (made after it began waiting), with said quoting them; else ask them which"
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
    d.moved?.(j, x.from)
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
  type Placed = Awaited<ReturnType<typeof placeHere>>
  /** Where a handoff runs: as asked (machine, cwd), else from the ask: an address another machine serves goes there; what
   *  nothing ties here (a note, research, a GitHub page or a pushed preview checked out there) goes to the machine jobs prefer. */
  async function route(m: Moment | undefined, p: Record<string, unknown>): Promise<Omit<Where, "agent" | "account" | "harness" | "model" | "effort">> {
    const o: Over = m ? { url: m.url, app: m.app, title: m.title, path: m.path, screen: m.screen, under: m.under } : {}
    let machine = str(p.machine).trim()
    if (machine && (await plugin.ask<Machine | null>("machines:machine", null, machine))?.self) machine = ""
    const asked = !!machine || !!str(p.cwd)
    if (!asked) {
      const hosts = Object.fromEntries((await machines()).filter((x) => !x.self && x.online).map((x) => [x.id, hostOf(x.url)]).filter(([, h]) => h))
      machine = machineOfUrl(o, hosts)?.machine ?? ""
    }
    let there = machine
      ? await atMachine(machine, "companion.where", { ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}), ...(o.url ? { url: o.url } : urlsIn(o)[0] ? { url: urlsIn(o)[0].href } : {}),
        ...(o.app ? { app: o.app } : {}), ...(o.title ? { title: o.title } : {}), ...(o.path ? { path: o.path } : {}) }) as unknown as Placed
      : await placeHere(o, str(p.cwd))
    let moved = ""
    if (!asked && !machine) ({ machine, there, moved } = await preferred(o, there))
    if (there.refused) throw new OpError(`it can't run there: ${there.refused}. Say so (where it would have run: ${tilde(there.cwd)})`, 403)
    return { machine, label: await labelOf(machine), cwd: there.cwd, repo: there.repo, why: there.why, ...(there.base ? { base: there.base } : {}), ...(there.preview ? { preview: there.preview } : {}),
      ...(moved ? { moved } : {}) }
  }
  /** An ask placed `here` moved to the machine jobs prefer: its checkout of the GitHub page's repo or of a pushed preview's
   *  (an editor project's), else its vault unless the repo is only here. `moved`: what the user watched here. */
  async function preferred(o: Over, here: Placed): Promise<{ machine: string; there: Placed; moved: string }> {
    const all = await machines(), self = all.find((x) => x.self), stay = (why: string) => ({ machine: "", there: { ...here, why: `${here.why} (${why}: here)` }, moved: "" })
    const pick = preferredMachine(all, setting("jobs_machine"), await plugin.ask<string>("machines:vault", ""), self ? !!self.standalone : !inDesktop())
    if (!pick.machine) return pick.why ? stay(pick.why) : { machine: "", there: here, moved: "" }
    const m = pick.machine, local = watched(here)
    let gh = urlsIn(o).find((u) => u.hostname === "github.com")?.href
    if (local) {
      // (a folder jobs never run in here isn't escaped by its copy elsewhere)
      if (here.refused) return { machine: "", there: here, moved: "" }
      const slug = await githubOf(here.cwd), left = slug ? await onlyHere(here.cwd) : ""
      if (!slug) return stay(`its repo isn't on GitHub, so ${m.label} can't have it`)
      if (left) return stay(`${left}, not yet pushed, would be lost on ${m.label}`)
      gh = `https://github.com/${slug}`
    }
    const far = await atMachine(m.id, "companion.where", { ...(gh ? { url: gh } : {}), ...(o.path ? { path: o.path } : {}) }, 6).catch(() => null) as Placed | null
    if (!far || (!far.repo && here.repo)) return stay(far ? `not checked out on ${m.label}` : `${m.label} doesn't answer`)
    if (!local) return { machine: m.id, there: { ...far, why: `${far.why}, on ${m.label} (${pick.why})` }, moved: "" }
    const branch = await branchOf(here.cwd), at = [branch, here.base.slice(0, 7)].filter(Boolean).join(" at ")
    return { machine: m.id, there: { ...far, why: `${here.why}, all pushed: ${far.why}, on ${m.label} (${pick.why}), previewed there` },
      moved: `${here.preview ? `the preview ${here.preview}` : `${tilde(here.cwd)}, open in their editor`} on ${await labelOf("")}${at ? ` (${at})` : ""}` }
  }
  /** The Claude Code a job runs as when the handoff names none: the setting, with its account (claude_personal). */
  const jobsAgent = () => { const own = setting("jobs_agent") || "claude"; return own.split("_")[0] === "claude" ? own : "claude" }
  /** Who works on it: the harness asked (Claude Code in the jobs' account by default), its model and effort. */
  function harnessOf(p: Record<string, unknown>) {
    const asked = str(p.agent) || "claude"
    const agent = asked === "claude" ? jobsAgent() : asked
    const claude = agent.split("_")[0] === "claude"
    const model = str(p.model) || (claude ? setting("jobs_model") : ""), effort = str(p.effort) || (claude ? setting("jobs_effort") : "")
    const profile = parseTerminal(`${agent}-x`)?.profile ?? ""
    return { agent, account: profile ? cap(profile) : "", model, effort, harness: [agentName(agent.split("_")[0]) ?? cap(agent), cap(model)].filter(Boolean).join(" ") }
  }

  // ---------- reading its worker

  /** Its terminal here as it is: running (else how it ended), its state, title, and with `turn` its last turn (its
   *  `session`'s, which outlives the terminal) and the diff since `base`. */
  async function seenHere(id: string, o: { turn?: boolean; session?: string; cwd?: string; base?: string } = {}): Promise<Seen> {
    const running = await plugin.ask<boolean>("terminal:runs", false, id)
    const st = await plugin.ask<{ state?: string; kind?: string; msg?: string } | null>("terminal:state", null, id)
    const info = running ? await plugin.ask<{ title?: string; typed?: number } | null>("terminal:info", null, id) : null
    const exit = running ? null : await plugin.ask<Seen["exit"] | null>("terminal:ended", null, id)
    const agent = parseTerminal(id)?.agent ?? ""
    type Turn = { text?: string; files?: string[]; at?: number; final?: boolean; session?: string; prompt?: string; background?: number }
    const turn = o.turn && agent ? await plugin.ask<Turn | null>(`agent-turn:${agent}`, null, id, o.session ?? "") : null
    type Q = { question?: string; multi?: boolean; options?: { label?: string }[] }
    const blocked = running && agent && st?.state === "blocked"
    const asking = blocked && st?.kind === "question" ? await plugin.ask<{ questions?: Q[] } | null>(`agent-asking:${agent}`, null, id, o.session ?? "").catch(() => null) : null
    const asks = o.turn ? (asking?.questions ?? []).map((q) => str(q.question)).filter(Boolean) : []
    const waits = blocked ? await waitsOf(id, st, asking?.questions) : null
    return { running, ...(st?.state ? { state: st.state } : {}), ...(st?.kind ? { kind: st.kind } : {}), ...(st?.msg ? { msg: st.msg } : {}), ...(info?.title ? { title: info.title } : {}),
      ...(info?.typed ? { typed: info.typed } : {}), ...(asks.length ? { asks } : {}), ...(waits ? { waits } : {}),
      ...(exit ? { exit: { code: exit.code, signal: exit.signal, ...(exit.lost ? { lost: true } : {}) } } : {}),
      ...(o.turn ? { turn: turn ? { text: str(turn.text), files: turn.files ?? [], at: turn.at ?? 0, final: turn.final !== false && !!turn.text, ...(turn.session ? { session: turn.session } : {}),
        ...(turn.prompt ? { prompt: turn.prompt } : {}), ...(turn.background ? { background: turn.background } : {}) } : null } : {}),
      ...(o.turn && o.cwd && o.base ? { diff: await diffSince(o.cwd, o.base) } : {}) }
  }
  /** The prompt terminal `id` is blocked on (`st`): a permission (one its screen shows: its words and choices), else its
   *  one question with its options; a question in several parts or picks has no choices (answered in its terminal). */
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
  /** Job `j`'s worker read where it runs; `turn`: its last turn too, `diff`: and its changes. */
  const seenOf = (j: Job, turn = false, diff = turn) => {
    const o = { ...(turn ? { turn, ...(j.session ? { session: j.session } : {}) } : {}), ...(diff ? { cwd: j.where.cwd, ...(j.where.base ? { base: j.where.base } : {}) } : {}) }
    return j.where.machine ? atMachine(j.where.machine, "companion.worker", { id: j.terminal, ...o }, 10) as Promise<Seen> : seenHere(j.terminal, o)
  }

  /** When each job's worker was first seen at rest (its turn may be over once that holds). */
  const resting = new Map<string, number>()
  const busy = new Set<string>()
  const HOLD = 1500
  /** When each live job's latest turn was read: what it says, read again at most every READ. */
  const read = new Map<string, number>()
  const READ = 15_000
  /** Job `j` read again: its worker's state moves it (a rest that holds is its turn's end: its results read then); a
   *  done one may have its terminal closed (tidy). */
  async function refresh(j: Job, now = false) {
    if (busy.has(j.id) || j.state === "stopped" || !j.terminal) return
    busy.add(j.id)
    try {
      const fresh = now || (live(j.state) && Date.now() - (read.get(j.id) ?? 0) >= READ)
      const s = await seenOf(j, fresh, false).catch(() => null)
      // (a machine away or slow: not an end)
      if (!s) return
      let moved = false, waited = false
      const was = j.now, said = j.last?.at
      if (fresh) { read.set(j.id, Date.now()); heard(j, s) }
      j.now = nowOf(j, s)
      const w = s.state === "blocked" ? s.waits : undefined
      if (JSON.stringify(w ?? null) !== JSON.stringify(j.waits ? { kind: j.waits.kind, question: j.waits.question, choices: j.waits.choices } : null)) {
        if (w) j.waits = { ...w, at: Date.now() }
        else delete j.waits
        waited = true
      }
      if (s.running && j.exited) { delete j.exited; delete j.closed; moved = true }
      if ((s.typed ?? 0) > j.started && !j.held) { j.held = true; moved = true }
      if (!s.running) { resting.delete(j.id); if (!j.exited) moved = await ended(j, s) }
      else if (s.state === "working") { j.stepped ??= Date.now(); moved = move(j, "working"); resting.delete(j.id); if (!j.session) moved = await learn(j) || moved }
      else if (s.state === "blocked") { moved = move(j, "asks"); resting.delete(j.id) }
      else if (s.state === "error") { moved = move(j, "error"); resting.delete(j.id) }
      else if ((s.state === "idle" || s.state === "done") && (j.state === "working" || j.state === "needs you" || j.state === "starting")) {
        const since = resting.get(j.id)
        if (since === undefined) { resting.set(j.id, Date.now()); setTimeout(() => void refresh(j), HOLD + 100).unref?.() }
        else if (Date.now() - since >= HOLD) moved = await finish(j)
      } else if (j.state === "done") moved = await tidy(j, s)
      if (moved || waited || j.now !== was || j.last?.at !== said) changed()
    } finally { busy.delete(j.id) }
  }
  /** What its worker's latest turn (`s`, read with it) says: what it said and was told last, what it asks. */
  function heard(j: Job, s: Seen) {
    if (!s.turn) return
    j.last = lastOf(s.turn, s.asks)
    if (s.turn.session) j.session ??= s.turn.session
  }
  /** What its turn ended with (`s`, read with its turn): its words since the job's turn began, files, diff, links. */
  function resultOf(j: Job, s: Seen) {
    const t = s.turn, text = t && t.at >= j.turn - 1000 ? t.text : ""
    if (t?.session) j.session = t.session
    const result: Result = { ...(text ? { text: text.slice(0, 4000) } : {}), ...(t?.files?.length ? { files: t.files.map((f) => tilde(f)).slice(0, 40) } : {}),
      ...(s.diff ? { diff: s.diff } : !s.diff && t?.files?.length && j.where.repo ? { diff: `${t.files.length} file${t.files.length > 1 ? "s" : ""} changed` } : {}),
      ...linksIn(text, j.where.preview) }
    return { result, text, changes: !!j.where.repo && !!(s.diff || t?.files?.length) }
  }
  /** Its turn over: what it ended with, and whether it changed anything to review. A job still starting counts only once
   *  its transcript has an answer since it began (Claude Code rests a moment before its first step). */
  async function finish(j: Job) {
    const s = await seenOf(j, true).catch(() => null)
    if (!s) return false
    const t = s.turn
    if (j.state === "starting" && !(t?.final && t.at >= j.turn - 1000)) return false
    resting.delete(j.id)
    const r = resultOf(j, s)
    j.result = r.result
    heard(j, s)
    return move(j, r.changes ? "changed" : "answered")
  }
  /** Its terminal ended (`s`): while it worked, by what it left in its session's transcript and how it ended (endEvent);
   *  else as the lifecycle says. Read once per end. */
  async function ended(j: Job, s: Seen) {
    if (!live(j.state)) { j.exited = Date.now(); move(j, "ended"); resumable(j); return true }
    const r = await seenOf(j, true).catch(() => null)
    if (!r) return false
    j.exited = Date.now()
    const x = s.exit, done = resultOf(j, r)
    if (done.text || done.result.files?.length) j.result = done.result
    heard(j, r)
    // (a terminal ended on purpose, End session or vau terminal end, reads as a SIGHUP)
    const crashed = !!x && (!!x.lost || x.code !== 0 || (x.signal !== 0 && x.signal !== 1))
    move(j, endEvent({ text: !!done.text.trim(), final: !!r.turn?.final && !!done.text, changes: done.changes, crashed }))
    resumable(j)
    return true
  }
  /** Job `j`'s terminal gone: from now on it's the one resuming its conversation (opening its card, a follow-up). */
  function resumable(j: Job) {
    const to = j.state === "stopped" ? "" : resumeOf(j)
    if (to) j.terminal = to
  }

  /** When the user last opened a job (its grace starts again). */
  const opened = new Map<string, number>()
  /** Job `j` done a while (`s`: its worker now): its terminal closed, unless its worker isn't at rest, still runs
   *  something in the background, was typed in by the user or is in front of them. Its conversation resumes. */
  async function tidy(j: Job, s: Seen) {
    if (!s.running || j.held || Date.now() - Math.max(j.at, opened.get(j.id) ?? 0) < grace || (s.state !== "idle" && s.state !== "done")) return false
    const t = await seenOf(j, true, false).catch(() => null)
    if (t?.turn?.session) j.session ??= t.turn.session
    if (!t?.running || t.turn?.background || !resumeOf(j) || d.onScreen?.(linkOf(j))) return false
    await plugin.runOp("terminal.end", { id: terminalOf(j) })
    j.exited = j.closed = Date.now()
    resumable(j)
    return true
  }
  /** Job `j`'s conversation running again in a terminal when its own was closed or ended (told `prompt` first). */
  async function wake(ctx: OpCtx, j: Job, prompt = "") {
    const s = await seenOf(j).catch(() => null)
    if (!s || s.running) return false
    if (!j.session) throw new OpError(`${j.id}'s terminal ended and its conversation isn't known: hand it off again`, 409)
    const w = j.where
    const r = await ctx.op("terminal.start", { agent: w.agent, session: j.session, ...(prompt ? { prompt } : {}), name: j.title, cwd: w.cwd, ...(w.model ? { model: w.model } : {}),
      ...(w.effort ? { effort: w.effort } : {}), ...(w.agent.split("_")[0] === "claude" && setting("jobs_mode") ? { mode: setting("jobs_mode") } : {}), ...(w.machine ? { machine: w.machine } : {}) }) as { id: string }
    j.terminal = r.id.split("@")[0]
    delete j.exited; delete j.closed
    opened.set(j.id, Date.now())
    return true
  }
  /** Its worker's session, once it says (its transcript is what's read after its terminal ends). */
  const tried = new Map<string, number>()
  async function learn(j: Job) {
    if (Date.now() - (tried.get(j.id) ?? 0) < 30_000) return false
    tried.set(j.id, Date.now())
    const s = await seenOf(j, true, false).catch(() => null)
    if (s?.turn?.session) { j.session = s.turn.session; tried.delete(j.id) }
    return !!j.session
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
      // (one done whose terminal runs: looked at for tidy)
      const later = (j.where.machine && j.state !== "stopped" && recent) || (j.state === "done" && !j.exited)
      if (live(j.state) ? (j.where.machine || ticks % 2 === 0) : later && ticks % 10 === 0) void refresh(j).catch(() => {})
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

  /** Job `j` named `title` (its card and its terminal), when a follow-up changed what it's about. */
  async function retitle(ctx: OpCtx, j: Job, title: string) {
    j.title = title.replace(/\s+/g, " ").trim().slice(0, 80)
    await ctx.op("terminal.rename", { id: terminalOf(j), name: j.title }).catch(() => {})
    changed()
  }
  /** A follow-up or correction to job `j`, typed into its worker's terminal (the user's own words, as if they typed);
   *  its terminal closed or ended, its conversation resumed with it. */
  async function steer(ctx: OpCtx, j: Job, text: string) {
    if (j.state === "stopped") throw new OpError(`${j.id} was stopped: hand it off again`, 409)
    const s = await seenOf(j).catch(() => null)
    if (s && !s.running) {
      if (!j.exited) await ended(j, s)
      changed()
      if (!await wake(ctx, j, text)) throw new OpError(`${j.id}'s terminal can't be reached now: try again (${linkOf(j)})`, 502)
    } else {
      if (s?.state === "blocked" && s.kind === "permission") throw new OpError(`${j.id} waits on a permission in its terminal (${s.msg ?? "open it"}): only the user answers it (its notification, or job-answer on their words; ${linkOf(j)})`, 409)
      const r = await ctx.op("terminal.send", { id: terminalOf(j), text }) as { submitted?: boolean | null; why?: string }
      if (r.submitted === false) throw new OpError(`it didn't take it: ${r.why ?? "its input kept the text"} (${linkOf(j)})`, 409)
    }
    move(j, "told")
    j.turn = Date.now()
    j.now = `Told: ${gist(text, 120)}`
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
ends ready for review (its diff, a preview's link): nothing ships, deploys or goes out unless they say so. A routine
handoff says nothing (its card in Jobs shows it); say only what they need to hear (a question, an unexpected place). End your turn. job: a follow-up or a correction to one of yours (companion
jobs), typed into its terminal. A folder the jobs may never run in (the setting jobs_never) is refused: say why.

  vau companion handoff "Make the header blue on this page"
  vau companion handoff "Use the darker blue instead" --job jd3k2h1g`,
    kind: "write",
    lock: false,
    params: { task: { type: "string", required: true, description: "what to do, standing alone: the goal, where, what to end with (the ask's words, place and picture go with it); with job, a short note of what it's for: their words, place and picture go with it too" },
      say: { type: "string", description: "only what they need to hear now, in a few words (a question, an unexpected place it runs); none for a routine handoff" },
      agent: { type: "string", enum: ["claude", "codex", "opencode"], default: "claude", description: "who does it: Claude Code (on Opus, high, unless model says), Codex or OpenCode" },
      model: { type: "string", description: "its model (default: the setting jobs_model for Claude Code, the agent's own else)" },
      effort: { type: "string", description: "how hard it thinks (default: the setting jobs_effort for Claude Code)" },
      title: { type: "string", description: "its name in the menu bar's Jobs (default: the task's first words); with job, its new name, when the follow-up changes what it's about" },
      cwd: { type: "string", description: "the folder it works in (~ for home), instead of the one the ask was over" },
      machine: { type: "string", description: "another of the Machines to run it on, by id (with cwd: that machine's folder)" },
      job: { type: "string", description: "a follow-up to this job of yours (its id): typed into its terminal" }, as: d.as },
    args: ["task"],
    run: async (p, ctx) => {
      const name = d.who(p), task = str(p.task).trim()
      if (!task) throw new OpError("task: what to do")
      if (str(p.job)) {
        const j = jobOf(str(p.job))
        // (their ask goes with it once: one the job was already given isn't told again)
        const m = d.askOf(name), fresh = m && m.t > (j.asked ?? 0) ? m : undefined
        await steer(ctx, j, followTask(task, fresh))
        if (fresh) j.asked = fresh.t
        if (str(p.title).trim()) await retitle(ctx, j, str(p.title))
        d.did(name, "handoff")
        if (str(p.say).trim()) await d.say(ctx, name, str(p.say))
        return cardOf(j)
      }
      const m = d.askOf(name)
      const where: Where = { ...await route(m, p), ...harnessOf(p) }
      const now = Date.now(), title = (str(p.title).trim() || task.replace(/\s+/g, " ")).slice(0, 80).replace(/^(.{60,}?)\s.*$/, "$1…")
      const j: Job = { id: newId(), title, state: "starting", where, terminal: "", now: `starting in ${tilde(where.cwd)}`, ...(m ? { asked: m.t } : {}), started: now, turn: now, at: now, seen: false, log: [] }
      all().unshift(j)
      try {
        const r = await ctx.op("terminal.start", { agent: where.agent, prompt: jobTask(task, m, !!where.repo, where.moved ? { from: where.moved, on: where.label } : undefined), name: title, cwd: where.cwd,
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
      if (str(p.say).trim()) await d.say(ctx, name, str(p.say))
      return { ...cardOf(j), why: where.why }
    },
    text: (r) => `Handed off (${r.id}): "${r.title}", ${r.state}, on ${r.where}${r.why ? ` (${r.why})` : ""}. The user sees it in Jobs: end your turn.`,
    did: (p) => ({ action: "run", text: p.job ? `Told the job ${p.job} ${quoted(p.task, 60)}` : `Handed off ${quoted(p.task, 60)}`, by: d.who(p) }),
  })

  /** How recent the user's ask must be for the companion to answer a job's prompt with it. */
  const ASKED_MS = 3 * 60_000
  const plainWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  /** The user answering through their companion: their own word, which only they may give (inbox.answer). */
  const BY_THEIR_WORD = { ...whoOf("app/companion", null), label: "the user, through their companion" }
  plugin.op({
    id: "companion.job-answer",
    cli: "companion job-answer",
    summary: "Answer what a job's worker waits on (trust its folder, a permission, its question) with the user's choice, pressed in its terminal as its notification's buttons do: only on their own clear words.",
    help: `choice: one of the choices companion job lists for it (its words or number; yes or no for a permission). The
terminal's menu cursor is moved onto it and checked there before Enter (trust and imports default to No). From an agent
(you), only while answering the user's ask that names it, made after it began waiting, with said quoting their words:
never on your own, nor guessed from a vague ask (unsure: ask them which). A question in several parts is answered in
its terminal (companion job-open).

  vau companion job-answer jd3k2h1g --choice "Yes, I trust this folder" --said "yes, trust it"`,
    kind: "write",
    lock: false,
    params: { id: { type: "string", required: true, description: "the job's id (or the end of it)" },
      choice: { type: "string", required: true, description: "the choice: its words or number, or yes / no for a permission" },
      said: { type: "string", description: "from an agent: the user's words in their ask that name the choice, as they said them" }, as: d.as },
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
        // (an agent answers only with the user's own words, said after it began waiting: never yes on its own)
        const m = d.askOf(d.who(p)), said = plainWords(str(p.said))
        if (!m?.text || m.t < w.at || Date.now() - m.t > ASKED_MS || !said || !` ${plainWords(m.text)} `.includes(` ${said} `)) throw new OpError(NOT_THEIRS, 403)
        by = BY_THEIR_WORD
      }
      // (its row in the inbox, the answer's way in: a prompt just changed may take its terminal's next word to reopen it)
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
    summary: "Open a job's terminal in a tab (as its card does): one closed once it was done resumes its conversation first.",
    help: `  vau companion job-open jd3k2h1g`,
    kind: "write",
    lock: false,
    params: { id: { type: "string", required: true, description: "the job's id (or the end of it)" } },
    args: ["id"],
    run: async (p, ctx) => {
      const j = jobOf(str(p.id))
      if (j.state !== "stopped" && await wake(ctx, j)) changed()
      opened.set(j.id, Date.now())
      seen([j.id])
      await ctx.op("ui.open", { path: linkOf(j) })
      return cardOf(j)
    },
    text: (r) => `Opened "${r.title}" (${r.id}).`,
    did: (p) => ({ action: "ui", text: `Opened the job ${p.id}` }),
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
      session: { type: "string", description: "its agent's session (its turn read from it, the terminal ended or not)" },
      cwd: { type: "string", description: "its folder (the diff's)" }, base: { type: "string", description: "the commit the diff counts from" } },
    args: ["id"],
    run: async (p) => seenHere(str(p.id), { turn: p.turn === true, session: str(p.session), cwd: str(p.cwd), base: str(p.base) }),
  })

  /** Jobs the user opened: no longer news. */
  function seen(ids: string[]) {
    let any = false
    for (const j of all()) if (ids.includes(j.id) && !j.seen) { j.seen = true; any = true }
    if (any) changed()
  }

  return {
    list: all, cards, seen, jobsAgent,
    line: () => jobsLine(all()),
    /** How fast the day's jobs got going, for companion timings. */
    timings: (day: string, dayOf: (t: number) => string) => jobTimings(all().filter((j) => dayOf(j.started) === day)),
  }
}
