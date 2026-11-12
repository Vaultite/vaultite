// Jobs' workers: coding agents in the app's terminals (any harness, here or on another machine), read from what's tracked
// already (their terminal's state, their transcript), moving jobs.ts' lifecycle. Ops: handoff, jobs, job, job-stop, where, worker.
import { execFile, spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { agentModel, agentName, KNOWN_AGENTS, parseTerminal } from "../../../core/agents.ts"
import { gitEnv, inDesktop, type Machine, type OpCtx, OpError, type Plugin, quoted, ROOT, userSurface, type Who, whoOf } from "../../../core/plugins.ts"
import { cardOf, choiceIn, commitsIn, turnWord, endEvent, fixTask, HANDED, inPlace, landedSaid, landTask, liveStep, mergedCommit, mergedSaid, followTask, gist, type Job, type JobCard, type JobEvent, jobsLine, jobsText, jobTask, jobText, jobTimings, lastOf, linkOf, linksIn, live, type Marks, nowOf, restEvent, type Queued, queuedLine, toldBy, type Result, resumeOf,
  type ProofMode, prunedLine, step, terminalOf, type Waits, type Where, worktreeOf } from "./jobs.ts"
import { requestWriter } from "../../../core/vault.ts"
import type { Moment } from "./types.ts"
import { APP_REPO, appUiOf, branchOf, checkoutNamed, dropTree, checkoutNames, type Found, fileAt, githubOf, headOf, jobBase, machineOfUrl, onlyHere, type Over, refusal, repoOf, resolveHere, checkoutsLine, rootsLine, sitesIn, surfaceOf, tilde, unpushed, urlsIn, watched } from "./where.ts"
import { type Home, type Read, workerLinks } from "./links.ts"
import { capOf, CLOUD, cloudIn, lacks, type Needs, place, type Ranked, type RepoRule, rulesIn, rulesNeed, RULES_FILE, type Traits } from "./placement.ts"

/** What the plugin gives the jobs: the ask a handoff came from, whose a call is, its say, its action log, who an `as` names. */
export type JobDeps = {
  askOf: (name: string) => Moment | undefined
  /** Whether a call as agent `name` is its own (its tool's, its terminal's, the user's in the app): only that one speaks
   *  in its voice and carries its ask, never another agent's vau or a script's. */
  own: (name: string, ctx: OpCtx) => boolean
  say: (ctx: OpCtx, name: string, text: string) => Promise<unknown>
  saidSince?: (name: string, since: number) => string[]
  turnEnd?: (name: string) => Promise<void> | null
  did: (name: string, op: string) => void
  who: (p: Record<string, unknown>) => string
  cards: (cards: JobCard[]) => void
  /** Job `j` moved on from `from` (its news told aloud, where the user is). */
  moved?: (j: Job, from: string) => void
  /** Whether its terminal stays up when done: asks on its page go straight to it (live editing). */
  warm?: (j: Job) => boolean
  /** Whether a window shows `link` in its shown tab. */
  onScreen?: (link: string) => boolean
  /** What pane `id` shows (its link: a job's terminal, view:terminal/<id>), "" when unknown. */
  paneTo?: (id: string) => string
  as: object
}
/** A worker's terminal as read where it runs (the op companion.worker): `typed` when the user last typed in one of its
 *  tabs, `asks` the questions it waits on, `waits` the prompt it's blocked on, its turn's `prompt` the last it was told. */
export type Seen = { running: boolean; state?: string; kind?: string; msg?: string; title?: string; typed?: number; asks?: string[]; waits?: Omit<Waits, "at">
  turn?: { text: string; files: string[]; at: number; final: boolean; session?: string; prompt?: string; background?: number } | null; diff?: string
  /** How its terminal ended, when it did and that's known. */
  exit?: { code: number; signal: number; lost?: boolean }
  /** Why its terminal can't be reached (its terminal server not answering): not an end, nor working. */
  unreachable?: string
  /** How full its agent's context is (its last request's tokens, its window), when asked and its agent says. */
  context?: { tokens: number; window: number }
  /** Whether a commit its words name (or its branch, or its change by its marks) is on its repo's main since base. */
  onMain?: boolean
  /** Its branch's marks, read while it exists (kept with the job: its change found on main once the branch is gone). */
  marks?: Marks }

const KEEP = 40, KEEP_DAYS = 7
/** How often a job ready for review is looked for on main. */
let SHIP_READ = 5 * 60_000
/** Another interval (the tests'). */
export const shipEvery = (ms: number) => { SHIP_READ = ms }
/** How often a job's landed commit is looked for live where its server takes main; another (the tests'). */
let LIVE_READ = 20_000
export const liveEvery = (ms: number) => { LIVE_READ = ms }
/** A picture of the screen handed on by another machine (a Retina display's PNG is a few MB), at most; its first bytes. */
const PICTURE_MAX = 40 << 20, PROOF_MAX = 200 << 20, PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** How long after the user's ask the companion's handoff is still its answer (its words and place go with it). */
const ANSWERING_MS = 10 * 60_000
/** How long a job done keeps its terminal: follow-ups mostly come within a minute or two, and still find it running. */
let grace = 120_000
/** Another grace (the tests'). */
export const tidyAfter = (ms: number) => { grace = ms }
/** How often (in the jobs' 3 s ticks) what waits for a machine is looked at; another (the tests'). */
let flushTicks = 5
export const flushEvery = (ticks: number) => { flushTicks = ticks }
const str = (v: unknown) => (typeof v === "string" ? v : "")
/** Who tells a job what the app itself passes on (their talk, a capture, a live edit, their Needs changes). */
const COMPANION = "the companion"
const APP = whoOf("app/companion", null)
/** Who a call from the app's own surfaces is, the user themselves. */
const THEM = "you, in the app"
/** Who a call telling a job something is, as whoever reads the job says it: the user in the app, the companion
 *  `companion`'s own turn, else the caller (another agent's vau, from its terminal; a script), which isn't the companion. */
function tellerOf(ctx: OpCtx, companion: string) {
  if (userSurface(ctx.who)) return THEM
  if (companion) return `the companion (${companion})`
  const t = requestWriter.getStore()?.terminal
  return ctx.who.agent ? `another agent, not the companion: ${ctx.who.label}${t ? ` in terminal ${t}` : ""}` : `not the companion: ${ctx.who.label === "vau" ? "vau from a shell or script" : ctx.who.label}`
}
const git = (cwd: string, args: string[]) => new Promise<string>((ok) => execFile("git", args, { cwd, timeout: 5000, maxBuffer: 4 << 20, env: gitEnv() }, (e, out) => ok(e ? "" : String(out))))
const statLine = (stat: string) => {
  const m = /(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/.exec(stat)
  return m ? `${m[1]} file${m[1] === "1" ? "" : "s"} changed, +${m[2] ?? 0} -${m[3] ?? 0}` : ""
}
export async function diffSince(cwd: string, base: string, landed = "", gone = false) {
  if (landed && await gitOk(cwd, ["cat-file", "-e", `${landed}^{commit}`])) return statLine(await git(cwd, ["show", "--shortstat", "--format=", landed]))
  if (!base || gone || !(await gitOk(cwd, ["merge-base", "--is-ancestor", base, "HEAD"]))) return ""
  const from = await fromOf(cwd, base)
  const [stat, fresh, commits] = await Promise.all([git(cwd, ["diff", "--shortstat", from]), git(cwd, ["ls-files", "--others", "--exclude-standard"]), git(cwd, ["rev-list", "--count", `${from}..HEAD`])])
  const n = fresh.split("\n").filter(Boolean).length, c = Number(commits.trim()) || 0
  return [statLine(stat), n ? `${n} new file${n > 1 ? "s" : ""}` : "", c ? `${c} commit${c > 1 ? "s" : ""}` : ""].filter(Boolean).join(", ")
}
/** Once rebased, main's own progress since its base isn't the job's. */
async function fromOf(cwd: string, base: string) {
  const main = await mainOf(cwd), on = main ? (await git(cwd, ["merge-base", main, "HEAD"])).trim() : ""
  return on && on !== base && await gitOk(cwd, ["merge-base", "--is-ancestor", base, on]) ? on : base
}
/** Whether a commit `text` names (not one its branch was built on), or branch `branch`, came after `base` and is on
 *  `cwd`'s remote main: a job that landed its own change (pushing from a worktree moves the checkout's origin/main too). */
export async function onMainSince(cwd: string, base: string, text: string, branch = "", marks?: Marks | null) {
  const main = await mainOf(cwd)
  if (!main || !base) return false
  const from = branch && await gitOk(cwd, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]) ? (await git(cwd, ["merge-base", main, `refs/heads/${branch}`])).trim() : ""
  for (const h of commitsIn(text)) {
    if (from && await gitOk(cwd, ["merge-base", "--is-ancestor", h, from])) continue
    if (await gitOk(cwd, ["merge-base", "--is-ancestor", h, main]) && !(await gitOk(cwd, ["merge-base", "--is-ancestor", h, base]))) return true
  }
  if (branch && await gitOk(cwd, ["merge-base", "--is-ancestor", branch, main]) && !(await gitOk(cwd, ["merge-base", "--is-ancestor", branch, base]))) return true
  // (rebased or squashed by someone else, its branch maybe gone: its change itself on main, by patch-id)
  if (!marks?.whole && !marks?.each.length) return false
  const on = await mainPatches(cwd, base, main)
  return (!!marks.whole && on.has(marks.whole)) || (!!marks.each.length && marks.each.every((x) => on.has(x)))
}
const gitOk = (cwd: string, args: string[]) => new Promise<boolean>((r) => execFile("git", args, { cwd, timeout: 5000, env: gitEnv() }, (e) => r(!e)))
const mainOf = async (cwd: string) => (await gitOk(cwd, ["rev-parse", "--verify", "-q", "origin/main"])) ? "origin/main" : (await gitOk(cwd, ["rev-parse", "--verify", "-q", "origin/master"])) ? "origin/master" : ""
/** The patch-ids (`git patch-id --stable`) of what `args` prints: commit → patch-id ("-" for a diff not from `git log`). */
function patchIds(cwd: string, args: string[]) {
  return new Promise<Map<string, string>>((ok) => {
    const out = new Map<string, string>()
    const a = spawn("git", args, { cwd, env: gitEnv(), stdio: ["ignore", "pipe", "ignore"] }), b = spawn("git", ["patch-id", "--stable"], { cwd, env: gitEnv(), stdio: ["pipe", "pipe", "ignore"] })
    const kill = setTimeout(() => { a.kill(); b.kill() }, 20_000)
    a.stdout.pipe(b.stdin)
    b.stdin.on("error", () => {})
    let text = ""
    b.stdout.on("data", (d) => (text += d))
    b.on("close", () => {
      clearTimeout(kill)
      for (const l of text.split("\n")) { const [p, c] = l.trim().split(/\s+/); if (p && c) out.set(/^0+$/.test(c) ? "-" : c, p) }
      ok(out)
    })
    b.on("error", () => { clearTimeout(kill); ok(out) })
  })
}
/** Job branch `branch`'s marks: its own commits (not main's, though it was rebased onto it), null when it's gone or
 *  all on main already (its branch on main says it). */
export async function marksOf(cwd: string, branch: string): Promise<Marks | null> {
  const main = await mainOf(cwd)
  if (!main || !branch || !(await gitOk(cwd, ["rev-parse", "--verify", "-q", `refs/heads/${branch}`]))) return null
  const own = (await git(cwd, ["rev-list", "--no-merges", "-n", "40", `${main}..refs/heads/${branch}`])).split("\n").filter(Boolean)
  if (!own.length) return null
  const from = (await git(cwd, ["merge-base", main, `refs/heads/${branch}`])).trim()
  const [each, whole] = await Promise.all([patchIds(cwd, ["log", "-p", "--no-merges", "--no-color", "--no-ext-diff", "--no-walk=unsorted", ...own]),
    from ? patchIds(cwd, ["diff", "--no-color", "--no-ext-diff", from, `refs/heads/${branch}`]) : new Map<string, string>()])
  const m: Marks = { whole: whole.get("-") ?? "", each: own.map((c) => each.get(c) ?? "").filter(Boolean) }
  return m.whole || m.each.length ? m : null
}
/** Each commit's patch-id, read once (a commit never changes). */
const patchOf = new Map<string, string>()
/** The patch-ids of `cwd`'s main since `base`. */
async function mainPatches(cwd: string, base: string, main: string) {
  const since = (await git(cwd, ["rev-list", "--no-merges", "-n", "3000", `${base}..${main}`])).split("\n").filter(Boolean)
  const fresh = since.filter((c) => !patchOf.has(c))
  for (let i = 0; i < fresh.length; i += 200) {
    const got = await patchIds(cwd, ["log", "-p", "--no-merges", "--no-color", "--no-ext-diff", "--no-walk=unsorted", ...fresh.slice(i, i + 200)])
    if (patchOf.size > 50_000) patchOf.clear()
    // (one with no diff has no patch-id: kept as none)
    for (const c of fresh.slice(i, i + 200)) patchOf.set(c, got.get(c) ?? "")
  }
  return new Set(since.map((c) => patchOf.get(c)).filter(Boolean))
}
/** Marks as given (another machine's call): patch-ids only. */
const marksIn = (v: unknown): Marks | null => {
  const o = v && typeof v === "object" ? v as Record<string, unknown> : null, hex = (x: unknown) => typeof x === "string" && /^[0-9a-f]{40,64}$/.test(x)
  return o ? { whole: hex(o.whole) ? String(o.whole) : "", each: Array.isArray(o.each) ? o.each.filter(hex).map(String).slice(0, 40) : [] } : null
}
/** One handoff's announcement: its own line, what it did (a new job, a follow-up, their word to merge, kept for its
 *  machine) and to which job, and the companion's say instead, if it gave one. */
export type Told = { kind: "new" | "follow" | "land" | "kept"; title: string; line: string; say?: string }
/** How long a handoff's line waits for the turn's next handoff, said together. */
const TELL_MS = 400
const TURN_END_MAX_MS = 20_000
const NUMBER = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"]
/** A job's name said aloud: its title's first words, not ending on a small word. */
export function jobName(title: string) {
  const words = title.replace(/[.:,;…]+$/, "").replace(/\s+/g, " ").trim().split(" ").slice(0, 4)
  while (words.length > 1 && /^(the|a|an|on|of|to|in|for|and|with|at|by|from)$/i.test(words.at(-1)!)) words.pop()
  return words.join(" ").replace(/[.:,;]+$/, "")
}
const HANDOFF_WORDS = /\bhand(?:ed|ing|s)?\b[^.!?]{0,40}\boff\b|\bhand-?offs?\b|\bbackground (?:agent|job)s?\b|\bpass(?:ed|ing)?\b[^.!?]{0,40}\bon\b|\b(?:start(?:ed|ing)?|made|opened|spun up|sent|gave|put|told)\b[^.!?]{0,30}\b(?:a|an|its|their|new|one|two|three|four|\d+) (?:new )?(?:\w+ )?jobs?\b|\bjobs?(?:'s| is| are)? on (?:it|that|them)\b|\bkicked (?:it |that |this )?off\b|\bto merge\b/i
export const announces = (text: string) => HANDOFF_WORDS.test(text)
export function toldLine(items: Told[], turnWords = "") {
  if (!items.length) return ""
  let announced = announces(turnWords)
  const out: string[] = []
  for (const s of new Set(items.flatMap((x) => (x.say ? [x.say] : [])))) {
    if (!announces(s)) out.push(s)
    else if (!announced) { out.push(s); announced = true }
  }
  const rest = items.filter((x) => !x.say)
  const kept = [...new Set(rest.flatMap((x) => (x.kind === "kept" ? [x.line] : [])))]
  if (announced) return [...out, ...kept].join(" ")
  if (items.length === 1 && rest.length) return rest[0].line
  const names = (xs: Told[]) => { const n = [...new Set(xs.map((x) => jobName(x.title)))]; return n.length > 1 ? `${n.slice(0, -1).join(", ")} and ${n.at(-1)}` : n[0] ?? "" }
  const count = (n: number, one: string) => `${NUMBER[n] ?? n} ${one}${n === 1 ? "" : "s"}`
  const of = (k: Told["kind"]) => rest.filter((x) => x.kind === k)
  const lines = [
    of("new").length ? `Handed off ${count(of("new").length, "job")} to background agents: ${names(of("new"))}.` : "",
    of("follow").length ? `Passed that on to ${of("follow").length === 1 ? names(of("follow")) : `${count(of("follow").length, "job")}: ${names(of("follow"))}`}.` : "",
    of("land").length ? `Told ${of("land").length === 1 ? names(of("land")) : `${count(of("land").length, "job")}, ${names(of("land"))},`} to merge.` : "",
    // (kept for an offline machine: each one's own line says which machine)
    ...kept,
  ].filter(Boolean)
  return [...out, ...lines].join(" ")
}
const NOT_THEIRS = "only on the user's own words: answer it while answering their ask (Talk key) or their message to you that names the choice (made after it began waiting), with said quoting them; else ask them which"
const newId = () => `j${Array.from({ length: 7 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")}`
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const sameDir = (a: string, b: string) => { try { return fs.realpathSync(a) === fs.realpathSync(b) } catch { return false } }
/** Whether a place found is the repo `repo` names (GitHub's owner/name, a folder's name, a path): by its folder's name. */
export const sameRepo = (at: { cwd: string; repo: string }, repo: string) => {
  const name = repo.trim().replace(/\/+$/, "").replace(/\.git$/, "").split(/[/:]/).pop()!.toLowerCase()
  return !!name && (at.repo.toLowerCase() === name || path.basename(at.cwd).toLowerCase() === name)
}
/** Whether the user's words name `repo` as a repo ("the vaultite repo", "in lighthouse/site"), not only a word in it. */
export function namesRepo(text: string, repo: string) {
  const r = repo.trim().replace(/\/+$/, ""), name = r.split("/").pop()!, esc = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const word = "(?:repo|repository|checkout|codebase|project)"
  return (r.includes("/") && new RegExp(`(?<![\\w.-])${esc(r)}(?![\\w-])`, "i").test(text)) ||
    new RegExp(`(?<![\\w.-])${esc(name)}(?![\\w-])\\s+${word}\\b|\\b${word}\\s+(?:called\\s+|named\\s+)?${esc(name)}(?![\\w-])`, "i").test(text)
}
/** Why an ask is the app's own work ("" not): `about` as the handoff says (app, or work: their notes and errands), else
 *  Vaultite's own UI under their pointer (appUiOf), not a page's or a note's content. */
export function appAsk(o: Over, about: string) {
  if (about === "app") return "their ask is about Vaultite itself"
  const ui = about === "work" ? "" : appUiOf(o)
  return ui ? `asked over ${ui}` : ""
}
/** Whether the page's own place (`page`, routed with no repo) wins over the repo a handoff named: it maps to a checkout
 *  (not the vault), another than that repo, and the user's words don't name that repo. */
export const pageWins = (page: { cwd: string; repo: string; from?: Found["from"] }, repo: string, text: string) =>
  !!page.from && page.from !== "vault" && !sameRepo(page, repo) && !namesRepo(text, repo)

const unanswered = new Map<string, number>()
const AWAY = 30_000
function lasted(seen: Map<string, number>, id: string, ms: number, now = Date.now()) {
  if (!seen.has(id)) seen.set(id, now)
  return now - (seen.get(id) ?? now) >= ms
}

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
  const links = workerLinks(plugin, { seenHere: (id, r) => seenHere(id, r), landing: (cwd, base, text, branch, kept) => landing(cwd, base, text, branch, kept) }), atMachine = links.atMachine
  /** Whether `e`, from asking `machine`, was it being offline (it reads offline now): a handoff for it then waits. A
   *  machine that answered too slowly, maybe having done it, isn't. */
  async function away(machine: string, e: unknown) {
    if (!machine || !(e instanceof OpError) || e.status !== 502) return false
    const m = await plugin.ask<Machine | null>("machines:machine", null, machine).catch(() => null)
    return !!m && !m.self && !m.online
  }
  /** The account a job asked for, there on its machine (vau limits' ids), else a 404 saying which there are. */
  async function accountThere(ctx: OpCtx, machine: string, p: Record<string, unknown>) {
    const account = str(p.account).trim().toLowerCase()
    if (!account || account === "default") return
    await links.of({ machine }).there(ctx, "claude-code.limits", { account }, 10)
  }
  const hostOf = (u: string) => { try { return new URL(u).hostname } catch { return "" } }
  async function labelOf(machine: string) {
    const id = machine || await plugin.ask<string>("machines:self", "")
    const m = id ? await plugin.ask<Machine | null>("machines:machine", null, id) : null
    return m?.label ?? (machine || os.hostname().replace(/\.local$/, ""))
  }

  // ---------- where it runs

  /** Where an ask over `o` (or `cwd`, or `repo`, as given) runs here: its folder, repo and base, or why it never runs
   *  here. A folder or repo another machine names is this machine's own checkout of it (each keeps its repos in its place). */
  async function placeHere(o: Over, cwd: string, repo = "", fresh = true): Promise<Found & { repo: string; base: string; refused: string; missing?: boolean; looked?: string; have?: string; live?: boolean; carried?: boolean
    rules?: RepoRule[]; cloudOk?: boolean; cloud?: boolean }> {
    const self = (await machines()).filter((m) => m.self).map((m) => hostOf(m.url)).filter(Boolean)
    const isDir = (d: string) => !!fs.statSync(d, { throwIfNoEntry: false })?.isDirectory()
    const asked = cwd.replace(/^~(?=$|\/)/, os.homedir())
    let found: Found
    if (cwd && isDir(asked)) found = { cwd: asked, why: "as asked" }
    else if (cwd || repo) {
      const own = checkoutNamed(repo || asked), what = repo || path.basename(asked)
      // (a folder asked for that isn't here, nor a checkout of it: said, so it's looked for elsewhere, never a job that fails to start)
      if (!own) return { cwd: cwd ? asked : what, why: cwd ? `no folder ${tilde(asked)}, nor a checkout of ${what}` : `no checkout of ${what}`, repo: "", base: "", refused: "", missing: true,
        looked: rootsLine(), have: checkoutsLine() }
      found = { cwd: own, why: cwd ? `${tilde(asked)} is ${tilde(own)} here` : `${repo} is ${tilde(own)} here` }
    } else found = await resolveHere(o, plugin.vault.path, self)
    const top = found.cwd === plugin.vault.path ? "" : await repoOf(found.cwd)
    // (what they watch, a preview or an editor's project, is its HEAD; else the newest pushed commit of its branch)
    const base = !top ? "" : fresh && !watched(found) ? await jobBase(top) : await headOf(top), json = base ? await fileAt(top, base, RULES_FILE) ?? "" : ""
    const at = top || found.cwd, rules = rulesIn(json)
    return { ...found, cwd: at, repo: top ? at.split("/").pop()! : "", base, refused: refusal(at, lines("jobs_never")) || refusal(found.cwd, lines("jobs_never")),
      ...(top && sameDir(top, ROOT) ? { live: true } : {}), ...(rules.length ? { rules } : {}), ...(cloudIn(json) ? { cloudOk: true } : {}) }
  }
  /** A folder or repo asked for with no machine, not here: on the first machine (placement's order) that has it, else
   *  refused with where it was looked for. */
  async function elsewhere(cwd: string, repo: string, here: Placed, base: Base): Promise<{ machine: string; there: Placed }> {
    const r = await ranking({ has: [], ...base.agent }), asked: string[] = []
    for (const { t, why } of r.ranked.filter((x) => !x.t.self && !x.t.cloud)) {
      const far = await atMachine(t.id, "companion.where", { ...(cwd ? { cwd } : {}), ...(repo ? { repo } : {}) }, 6).catch(() => null) as Placed | null
      const no = !far ? "it doesn't answer" : far.missing ? "" : ruled(t, far, base)
      asked.push(`${t.label}${no ? ` (${no})` : ""}`)
      if (far && !far.missing && !no) return { machine: t.id, there: { ...far, why: `${far.why}, on ${t.label} (none on ${await labelOf("")}${why ? `; ${why}` : ""})` } }
    }
    throw new OpError(`${await missingLine(here, "")}${asked.length ? `, nor on ${asked.join(", ")}` : ""}. Leave cwd out (it runs where the ask was), or name the repo (repo: each machine finds its own checkout) with machine`, 404)
  }
  /** Why a folder or repo asked for isn't on `machine`, from what it looked at: never a guess. */
  const missingLine = async (there: Placed, machine: string) => `on ${await labelOf(machine)}, ${there.why}${there.looked ? ` (looked in ${there.looked}; its checkouts: ${there.have || "none"})` : ""}`
  type Placed = Awaited<ReturnType<typeof placeHere>>
  /** Where a handoff runs: as asked (machine, cwd), else from the ask: an address another machine serves goes there; what
   *  nothing ties here (a note, research, a GitHub page or a pushed preview checked out there) goes to the machine jobs prefer. */
  async function route(m: Moment | undefined, p: Record<string, unknown>): Promise<Omit<Where, "agent" | "account" | "harness" | "model" | "effort">> {
    const { from: _, ...r } = await routed(m, p)
    return r
  }
  async function routed(m: Moment | undefined, p: Record<string, unknown>): Promise<Omit<Where, "agent" | "account" | "harness" | "model" | "effort"> & { from?: Found["from"] }> {
    const o: Over = m ? { url: m.url, app: m.app, title: m.title, path: m.path, screen: m.screen, under: m.under, ui: m.ui, chrome: m.chrome } : {}
    const own = !str(p.repo).trim() && !str(p.cwd) ? appAsk(o, str(p.about)) : ""
    if (own) {
      // (Vaultite's own look or behaviour is its repo's work, whatever page or note the pane shows; with no checkout of
      //  it anywhere (not a developer's machines), where the ask was, as before)
      const r = await routed(m, { ...p, repo: APP_REPO, page: true }).catch((e) => e instanceof OpError && e.status === 404 ? (e as Error).message : Promise.reject(e))
      if (typeof r !== "string") return { ...r, why: `${own}: ${r.why}` }
      const at = await routed(m, { ...p, about: "work" })
      return { ...at, why: `${own}, but ${r.replace(/\. Leave cwd out.*$/, "")}: ${at.why}` }
    }
    let machine = str(p.machine).trim()
    if (machine && (await plugin.ask<Machine | null>("machines:machine", null, machine))?.self) machine = ""
    const repo = str(p.repo).trim(), asked = !!machine || !!str(p.cwd) || !!repo
    if (repo && !p.page && str(p.about) !== "app" && !machine && !str(p.cwd) && !o.path && (urlsIn(o).length || sitesIn(o).length)) {
      // (over a page, its own checkout (a site's deploy, a preview's server, a GitHub page) wins over a repo the handoff
      //  named, unless their words name that repo: one guessed from a page's title sent the site's work to the app)
      const page = await routed(m, { ...p, repo: "" }).catch(() => null)
      if (page && pageWins(page, repo, m?.text ?? ""))
        return { ...page, why: `${page.why} (not ${repo}, which the handoff named: their words don't)` }
      if (page?.from === "vault") {
        const r = await routed(m, { ...p, page: true })
        return { ...r, why: `${r.why}, as the handoff named (${page.why.replace(/: the vault.*$/, "")})` }
      }
    }
    if (!asked) {
      const hosts = Object.fromEntries((await machines()).filter((x) => !x.self && x.online).map((x) => [x.id, hostOf(x.url)]).filter(([, h]) => h))
      machine = machineOfUrl(o, hosts)?.machine ?? ""
    }
    // (the cloud asked for: a session started from this machine's checkout, if it can be)
    if (machine === CLOUD && !(await plugin.ask<Machine | null>("machines:machine", null, CLOUD))) {
      const here = await placeHere(o, str(p.cwd), repo)
      if (here.missing) throw new OpError(await missingLine(here, ""), 404)
      const cloud = (await traitsOf()).find((t) => t.cloud)
      const no = !cloud ? "jobs_cloud names no Claude Code account to start it" : lacks(cloud, { has: rulesNeed(here.rules ?? [], baseOf(m, p).words), repo: await githubOf(here.cwd) || here.repo, ...(here.cloudOk ? { cloud: true } : {}) })
      const got = no ? `the cloud ${no}` : await inCloud(here, "as asked")
      if (typeof got === "string") throw new OpError(`it can't run in the cloud: ${got}`, 409)
      if (got.there.refused) throw new OpError(`it can't run there: ${got.there.refused}`, 403)
      return { machine: "", label: "Cloud", cwd: got.there.cwd, repo: got.there.repo, why: got.there.why, cloud: true, ...(got.there.base ? { base: got.there.base } : {}), ...(got.there.live ? { live: true } : {}) }
    }
    let there = machine
      ? await atMachine(machine, "companion.where", { ...(str(p.cwd) ? { cwd: str(p.cwd) } : {}), ...(repo ? { repo } : {}), ...(o.url ? { url: o.url } : urlsIn(o)[0] ? { url: urlsIn(o)[0].href } : {}),
        ...(o.app ? { app: o.app } : {}), ...(o.title ? { title: o.title } : {}), ...(o.path ? { path: o.path } : {}) }) as unknown as Placed
      : await placeHere(o, str(p.cwd), repo)
    if (there.missing && machine) throw new OpError(await missingLine(there, machine), 404)
    const base = baseOf(m, p)
    if (there.missing) ({ machine, there } = await elsewhere(str(p.cwd), repo, there, base))
    let moved = ""
    if (!asked && !machine) ({ machine, there, moved } = await preferred(o, there, base))
    else if (repo && !machine && !str(p.cwd)) ({ machine, there } = await named(there, base))
    if (there.refused) throw new OpError(`it can't run there: ${there.refused}. Say so (where it would have run: ${tilde(there.cwd)})`, 403)
    return { machine, label: there.cloud ? "Cloud" : await labelOf(machine), cwd: there.cwd, repo: there.repo, why: there.why, ...(there.base ? { base: there.base } : {}), ...(there.preview ? { preview: there.preview } : {}),
      ...(there.cloud ? { cloud: true } : {}),
      ...(moved ? { moved } : {}), ...(there.live ? { live: true } : {}), ...(there.carried ? { carried: true } : {}), ...(there.from ? { from: there.from } : {}) }
  }
  /** What a handoff brings to placement besides where it's asked over: its words (a repo's rules match them), its agent
   *  and account. */
  type Base = { words: string; agent: Pick<Needs, "agent" | "account"> }
  const baseOf = (m: Moment | undefined, p: Record<string, unknown>): Base => {
    const account = str(p.account).trim().toLowerCase()
    return { words: [str(p.task), m?.text ?? ""].join("\n"), agent: { agent: str(p.agent) || "claude", ...(account && account !== "default" ? { account } : {}) } }
  }
  /** Why machine `t` can't take the job after all, now its place there is known (`far`): what its repo's rules say the
   *  work needs, or this vault when it works in a vault there; "" when it can. */
  const ruled = (t: Traits, far: Placed, base: Base) => lacks(t, { has: [...(far.repo ? [] : ["vault" as const]), ...rulesNeed(far.rules ?? [], base.words)] })
  /** Job place `here` (a checkout of this machine's) as a cloud session starts from it: its GitHub repo at the commit it
   *  starts from, which must be pushed (`left`: what isn't, null when nothing need be); else why not. */
  async function inCloud(here: Placed, why: string, left: string | null = null): Promise<{ there: Placed; moved?: string } | string> {
    if (!(await githubOf(here.cwd))) return "its repo isn't on GitHub, so the cloud can't have it"
    const missing = left ?? await unpushed(here.cwd)
    if (missing) return `${missing} it starts from would be missing in the cloud`
    return { there: { ...here, cloud: true, why: `${here.why}, all pushed: in the cloud (${why || "a cloud session of its own"})` } }
  }
  /** Where job needs `n` place it among the machines (placement.ts): each other one tried in turn while `fits` says why
   *  not, till this one comes; here with why the others didn't take it, unless there's nothing else to say. */
  async function placed(here: Placed, n: Needs, fits: (c: Ranked) => Promise<{ there: Placed; moved?: string } | string>, o: { cloud?: boolean } = {}): Promise<{ machine: string; there: Placed; moved: string }> {
    const r = await ranking(n), tried: string[] = []
    for (const c of r.ranked) {
      // (what they watch here, a preview or an editor's project, has no preview of theirs in the cloud)
      if (c.t.cloud && o.cloud === false) continue
      if (c.t.self) {
        const why = tried.length ? tried.join("; ") : r.ranked.length > 1 ? `${c.t.label}: ${c.why || "first in jobs_machine"}` : r.left.join("; ")
        return { machine: "", there: why ? { ...here, why: `${here.why} (${why}: here)` } : here, moved: "" }
      }
      const got = c.t.cloud ? await inCloud(here, c.why) : await fits(c)
      if (typeof got !== "string") return { machine: c.t.cloud ? "" : c.t.id, there: got.there, moved: got.moved ?? "" }
      tried.push(c.t.cloud ? `the cloud: ${got}` : got)
    }
    // (this one lacks what it needs too: it runs here all the same, as nowhere else can)
    const why = [...tried, ...r.left].join("; ")
    return { machine: "", there: why ? { ...here, why: `${here.why} (${why}: here)` } : here, moved: "" }
  }
  /** A repo named (no machine, no folder) and checked out here: to the machine placement picks when it has the repo too
   *  and the commit a job starts from is pushed (its worktree never takes uncommitted changes), else here, saying why. */
  async function named(here: Placed, base: Base): Promise<{ machine: string; there: Placed }> {
    if (here.refused) return { machine: "", there: here }
    const slug = await githubOf(here.cwd), left = slug ? await unpushed(here.cwd) : ""
    return placed(here, { has: rulesNeed(here.rules ?? [], base.words), repo: slug || here.repo, ...base.agent, ...(here.cloudOk ? { cloud: true } : {}) }, async ({ t, why }) => {
      if (!slug) return `its repo isn't on GitHub, so ${t.label} can't have it`
      if (left) return `${left} it starts from would be missing on ${t.label}`
      const far = await atMachine(t.id, "companion.where", { url: `https://github.com/${slug}` }, 6).catch(() => null) as Placed | null
      if (!far || far.missing || !far.repo) return far ? `not checked out on ${t.label}` : `${t.label} doesn't answer`
      const no = ruled(t, far, base)
      if (no) return `${t.label} ${no}`
      // (its worktree there starts at the commit it would have here, pushed)
      return { there: { ...far, ...(here.base ? { base: here.base, carried: true } : {}), why: `${here.why}, all pushed: ${far.why}, on ${t.label}${why ? ` (${why})` : ""}` } }
    })
  }
  /** An ask placed `here` moved to the machine placement picks: its checkout of the GitHub page's or a pushed preview's
   *  repo, else its vault (the vault's work needs this vault there), unless only here. `moved`: what they watched here. */
  async function preferred(o: Over, here: Placed, base: Base): Promise<{ machine: string; there: Placed; moved: string }> {
    const local = watched(here)
    // (a folder jobs never run in here isn't escaped by its copy elsewhere)
    if (local && here.refused) return { machine: "", there: here, moved: "" }
    // (a live site's address too: the machine there finds its own checkout that deploys it)
    let gh = urlsIn(o).find((u) => u.hostname === "github.com")?.href ?? (here.from === "site" || here.from === "vault" ? sitesIn(o)[0]?.href : undefined)
    const slug = here.repo ? await githubOf(here.cwd) : "", left = local && slug ? await onlyHere(here.cwd) : ""
    if (local && slug) gh = `https://github.com/${slug}`
    const n: Needs = { has: [...(here.repo || gh ? [] : ["vault" as const]), ...rulesNeed(here.rules ?? [], base.words)], ...(here.repo ? { repo: slug || here.repo } : {}), ...base.agent,
      ...(here.repo && here.cloudOk ? { cloud: true } : {}) }
    return placed(here, n, async ({ t, why }) => {
      if (local && !slug) return `its repo isn't on GitHub, so ${t.label} can't have it`
      if (left) return `${left}, not yet pushed, would be lost on ${t.label}`
      const far = await atMachine(t.id, "companion.where", { ...(gh ? { url: gh } : {}), ...(o.path ? { path: o.path } : {}) }, 6).catch(() => null) as Placed | null
      if (!far || (!far.repo && here.repo)) return far ? `not checked out on ${t.label}` : `${t.label} doesn't answer`
      const no = ruled(t, far, base)
      if (no) return `${t.label} ${no}`
      const on = `on ${t.label}${why ? ` (${why})` : ""}`
      if (!local) return { there: { ...far, why: `${far.why}, ${on}` } }
      const branch = await branchOf(here.cwd), at = [branch, here.base.slice(0, 7)].filter(Boolean).join(" at ")
      // (its worktree there starts at the commit they watched here, which its diff counts from)
      return { there: { ...far, ...(here.base ? { base: here.base } : {}), why: `${here.why}, all pushed: ${far.why}, ${on}, previewed there` },
        moved: `${here.preview ? `the preview ${here.preview}` : `${tilde(here.cwd)}, open in their editor`} on ${await labelOf("")}${at ? ` (${at})` : ""}` }
    }, { cloud: !local })
  }

  // ---------- the machines a job may go to

  /** What this machine says of its jobs (companion.capacity): the workers it runs now and how many it takes, the repos
   *  it has checked out, the agents it runs and their accounts. */
  async function capacity() {
    const set = Number(plugin.settings().jobs_cap) || 0
    const agents = [...new Set(KNOWN_AGENTS.map((a) => a.terminal ?? a.id))].filter((a) => typeof plugin.service(`agent:${a}`) === "function")
    const accounts = await plugin.ask<string[] | null>("agent-accounts:claude", null).catch(() => null)
    return { jobs: await links.running(), cap: set > 0 ? Math.round(set) : capOf(os.cpus().length, os.totalmem() / 1048576), repos: checkoutNames(), agents, ...(accounts ? { accounts } : {}) }
  }
  type Capacity = Awaited<ReturnType<typeof capacity>>
  /** Each machine as placement sees it: Machines' list with what each one's companion says of its jobs (this one's read
   *  here). One that doesn't say (no companion, an older Vaultite) takes no jobs placed for it. */
  async function traitsOf(): Promise<Traits[]> {
    const vault = await plugin.ask<string>("machines:vault", ""), all = (await machines()).filter((m) => m.self || m.plugins?.includes("companion"))
    const out = await Promise.all(all.map(async (m): Promise<Traits> => {
      const c = m.self ? await capacity() : m.online ? await atMachine(m.id, "companion.capacity", {}, 4).catch(() => null) as Capacity | null : null
      return { id: m.id, label: m.label, self: m.self, online: m.online, standalone: !!m.standalone, platform: m.self ? process.platform : m.platform, vault: m.self || (!!vault && m.vault === vault),
        app: !!m.desktop, ...(m.display !== undefined ? { display: m.display } : {}), ...(m.cores ? { cores: m.cores } : {}), ...(m.load !== undefined ? { load: m.load } : {}),
        // (this one's place is found already, its repo with it)
        ...(m.memory ? { memory: m.memory } : {}), ...(c ? { jobs: c.jobs, cap: c.cap, ...(m.self ? {} : { repos: c.repos }), agents: c.agents, ...(c.accounts ? { accounts: c.accounts } : {}) } : {}),
        ...(!m.self && m.online && !c ? { away: "doesn't say what jobs it takes (an older Vaultite, or its companion is off)" } : {}) }
    }))
    if (!out.some((t) => t.self)) {
      const c = await capacity()
      out.unshift({ id: "here", label: await labelOf(""), self: true, online: true, standalone: !inDesktop(), platform: process.platform, vault: true, app: inDesktop(), ...c, repos: undefined })
    }
    const account = cloudAccount()
    if (account && !out.some((t) => t.id === CLOUD)) {
      const why = await plugin.ask<string>("cloud-ready:claude", "Claude Code's plugin is off", account)
      out.push({ id: CLOUD, label: "Cloud", self: false, online: true, standalone: false, cloud: true, platform: "linux", vault: false, display: false, app: false,
        agents: ["claude"], accounts: [account], ...(why ? { away: `can't start sessions: ${why}` } : {}) })
    }
    return out
  }
  /** The machines a job needing `n` may go to, best first (this one among them), and why each other one can't. */
  const ranking = async (n: Needs) => place(await traitsOf(), n, plugin.settings().jobs_machine ?? plugin.manifest.settings?.jobs_machine?.default ?? "auto")
  /** The Claude Code account here that starts cloud jobs (the setting jobs_cloud), "" for none. */
  const cloudAccount = () => setting("jobs_cloud").toLowerCase()
  /** Whether coding jobs land their own change once its checks pass (the setting jobs_land), not waiting for Keep and merge. */
  const lands = () => plugin.settings().jobs_land === true
  /** When a job records its proof's video (the setting jobs_proof). */
  const proofMode = (): ProofMode => { const v = plugin.settings().jobs_proof; return v === "always" || v === "never" ? v : "auto" }
  /** The Claude Code a job runs as when the handoff names none: the setting, with its account (claude_personal). */
  const jobsAgent = () => { const own = setting("jobs_agent") || "claude"; return own.split("_")[0] === "claude" ? own : "claude" }
  /** Who works on it: the harness asked (Claude Code in the jobs' account by default, else the account asked), its model
   *  as it takes it ("Fable 5.2": claude-fable-5-2; one it can't run is refused here, before a job starts) and effort. */
  async function harnessOf(p: Record<string, unknown>) {
    const asked = str(p.agent) || "claude", account = str(p.account).trim().toLowerCase()
    if (account && asked !== "claude") throw new OpError("account is Claude Code's: leave agent out (or claude) to pick one of its accounts")
    if (account && !/^[a-z0-9][\w.-]{0,40}$/.test(account)) throw new OpError(`'${account}' isn't an account's id: vau limits lists them (personal, agent...)`)
    const agent = account ? (account === "default" ? "claude" : `claude_${account}`) : asked === "claude" ? jobsAgent() : asked
    const claude = agent.split("_")[0] === "claude"
    const { id: model, label } = await agentModel(plugin, agent.split("_")[0], str(p.model) || (claude ? setting("jobs_model") : ""))
    const effort = str(p.effort) || (claude ? setting("jobs_effort") : ""), profile = parseTerminal(`${agent}-x`)?.profile ?? ""
    return { agent, account: profile ? cap(profile) : "", model, effort, harness: [agentName(agent.split("_")[0]) ?? cap(agent), cap(label)].filter(Boolean).join(" ") }
  }

  /** Where a job runs with who works on it: in the cloud, Claude Code in the cloud's account (its model and effort the
   *  session's own); else harnessOf's. */
  async function placedWith(w: Awaited<ReturnType<typeof route>>, p: Record<string, unknown>): Promise<Where> {
    if (!w.cloud) return { ...w, ...await harnessOf(p) }
    const account = cloudAccount() || "default", agent = account === "default" ? "claude" : `claude_${account}`
    return { ...w, agent, account: account === "default" ? "" : cap(account), model: "", effort: "", harness: "Claude Code on the web" }
  }

  // ---------- reading its worker

  /** Its terminal here as it is: running (else how it ended), its state, title, and with `turn` its last turn (its
   *  `session`'s, which outlives the terminal) and the diff since `base`. */
  async function seenHere(id: string, o: Read = {}): Promise<Seen> {
    const running = await plugin.ask<boolean>("terminal:runs", false, id)
    const st = await plugin.ask<{ state?: string; kind?: string; msg?: string } | null>("terminal:state", null, id)
    const info = running ? await plugin.ask<{ title?: string; typed?: number } | null>("terminal:info", null, id) : null
    const exit = running ? null : await plugin.ask<Seen["exit"] | null>("terminal:ended", null, id)
    // (not listed because its terminal server doesn't answer: it may run on, frozen)
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
      // (a coding job's changes are in its worktree once it made one, else wherever it worked)
      ...(o.turn && o.cwd && o.base ? { diff: await changesOf(o.cwd, o.base, o.tree ?? "", [turn?.text, o.said].filter(Boolean).join("\n")) } : {}),
      ...(o.cwd && o.base && (o.turn || o.said || o.branch) ? await landing(o.cwd, o.base, [turn?.text, o.said].filter(Boolean).join("\n"), o.branch ?? "", o.marks) : {}) }
  }
  async function changesOf(cwd: string, base: string, tree: string, text: string) {
    const commit = landedSaid(text) ? mergedCommit(text) : ""
    const there = tree && fs.existsSync(tree)
    return diffSince(there ? tree : cwd, base, commit, !!tree && !there && !sameDir(tree, cwd))
  }
  /** Whether its change is on main (onMainSince), and its branch's marks while it exists (else the ones it was given). */
  async function landing(cwd: string, base: string, text: string, branch: string, kept?: Marks) {
    const marks = branch ? await marksOf(cwd, branch) : null
    return { onMain: await onMainSince(cwd, base, text, branch, marks ?? kept), ...(marks ? { marks } : {}) }
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
  /** Job `j`'s worker read where it runs; `turn`: its last turn too, `diff`: and its changes, and whether it's on main. */
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
  /** Jobs whose marks changed since they were last kept. */
  const marked = new Set<string>()

  /** When each job's worker was first seen at rest (its turn may be over once that holds). */
  const resting = new Map<string, number>()
  const busy = new Set<string>()
  /** Jobs being typed into (steer): their worker at rest meanwhile hasn't begun yet. */
  const sending = new Set<string>()
  /** Jobs whose terminal moved (or whose rest ended) while they were being read: read once more after. */
  const again = new Map<string, boolean>()
  const HOLD = 1500
  /** When each live job's latest turn was read: what it says, read again at most every READ. */
  const read = new Map<string, number>()
  const READ = 15_000
  /** Job `j` read again: its worker's state moves it (a rest that holds is its turn's end: its results read then); a
   *  done one may have its terminal closed (tidy). */
  async function refresh(j: Job, now = false) {
    if (j.state === "stopped" || !j.terminal) return
    // (dropped, its turn's end would wait for the next poll: seconds more before its news or its ring)
    if (busy.has(j.id)) return void again.set(j.id, now || !!again.get(j.id))
    busy.add(j.id)
    try {
      const fresh = now || (live(j.state) && Date.now() - (read.get(j.id) ?? 0) >= READ)
      const s = await seenOf(j, fresh, false).catch(() => null)
      // (a machine away or slow: not an end)
      if (!s) return
      // (nor a terminal its server can't reach now: said on its card once that lasts AWAY, till it's read again)
      if (s.unreachable) { if (lasted(unanswered, j.id, AWAY) && j.unreachable !== s.unreachable) { j.unreachable = s.unreachable; changed() } return }
      unanswered.delete(j.id); if (j.unreachable) { delete j.unreachable; marked.add(j.id) }
      let moved = false, waited = false
      const was = j.now, said = j.last?.at
      if (fresh) { read.set(j.id, Date.now()); heard(j, s) }
      // (a turn after its change went live, or after it was told it isn't, is about something else)
      if (s.state === "working" && j.going?.state === "live") delete j.going
      else if (s.state === "working" && j.going?.state === "stuck") j.going.state = "fixing"
      j.now = j.going && j.going.state !== "fixing" ? j.going.why : nowOf(j, s)
      const w = s.state === "blocked" ? s.waits : undefined
      if (JSON.stringify(w ?? null) !== JSON.stringify(j.waits ? { kind: j.waits.kind, question: j.waits.question, choices: j.waits.choices } : null)) {
        if (w) j.waits = { ...w, at: Date.now() }
        else delete j.waits
        waited = true
      }
      if (s.running && j.exited) { delete j.exited; delete j.closed; moved = true }
      if ((s.typed ?? 0) > j.started && !j.held) { j.held = true; moved = true }
      if (!s.running) { resting.delete(j.id); if (!j.exited) moved = await ended(j, s) }
      else if (s.state === "working") { j.stepped ??= Date.now(); moved = move(j, "working"); resting.delete(j.id); goingOn.delete(j.id); if (!j.session) moved = await learn(j) || moved }
      else if (s.state === "blocked") { moved = move(j, "asks"); resting.delete(j.id) }
      else if (s.state === "error") { moved = move(j, "error"); resting.delete(j.id) }
      else if ((s.state === "idle" || s.state === "done") && (j.state === "working" || j.state === "needs you" || j.state === "starting")) {
        const since = resting.get(j.id)
        if (sending.has(j.id)) resting.delete(j.id)
        else if (since === undefined) { resting.set(j.id, Date.now()); setTimeout(() => void refresh(j), HOLD + 100).unref?.() }
        // (its change landed, waited on by golive: its turn's words read already)
        else if (Date.now() - since >= HOLD && Date.now() - (goingOn.get(j.id) ?? 0) >= READ && !waitsLive(j)) moved = await finish(j)
      } else if (j.state === "done") moved = await tidy(j, s)
      if (j.state === "ready for review" && Date.now() - (shipRead.get(j.id) ?? 0) >= SHIP_READ) moved = await shippedSince(j) || moved
      if (moved || waited || j.now !== was || j.last?.at !== said || marked.delete(j.id)) changed()
    } finally {
      busy.delete(j.id)
      const next = again.get(j.id)
      if (next !== undefined) { again.delete(j.id); void refresh(j, next).catch((e) => console.error("companion: jobs:", e)) }
    }
  }
  /** What its worker's latest turn (`s`, read with it) says: what it said and was told last, what it asks. */
  function heard(j: Job, s: Seen) {
    if (!s.turn) return
    j.last = lastOf(s.turn, s.asks)
    const by = j.last.told ? toldBy(j, s.turn.prompt ?? "", s.typed) : ""
    if (by) j.last.by = by
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
    const r = resultOf(j, s)
    heard(j, s)
    const ev = restEvent({ background: t?.background, landed: landed(j, r.text) || shipped(j, s, r.text), changes: r.changes, lands: j.where.lands, text: r.text, at: t?.at || j.turn })
    // (it goes on: read again at its next rest, its now-line saying what it waits on)
    if (ev === "working") { goingOn.set(j.id, Date.now()); j.now = nowOf(j, s); return move(j, ev) }
    resting.delete(j.id); goingOn.delete(j.id)
    j.result = r.result
    if (ev === "landed") return arrived(j, r.text)
    if (j.going?.state === "fixing") delete j.going
    return move(j, ev)
  }
  /** Its change landed (`text`: its words): done, or where its own server takes main (Where.live), its commit waited on
   *  there by golive (still working meanwhile), never by its worker. */
  function arrived(j: Job, text: string) {
    const commit = j.where.live ? mergedCommit(text) : ""
    if (!commit) { delete j.going; return move(j, "landed") }
    j.going = { commit, since: Date.now(), fixes: j.going?.fixes ?? 0, state: "waiting", why: `Merged ${commit.slice(0, 7)}: waiting for it to go live` }
    j.now = j.going.why
    move(j, "working")
    return true
  }
  const waitsLive = (j: Job) => j.going?.state === "waiting" || j.going?.state === "stuck"
  /** When each job's landed commit was last looked for live, and those being looked for now. */
  const liveRead = new Map<string, number>(), looking = new Set<string>()
  /** Job `j`'s landed commit looked for where it goes live (app.version on its machine): live, it's done; CI red on it,
   *  its worker sent back to fix it forward (then the user); one that won't be live by itself, said on it; else waited on. */
  async function golive(j: Job) {
    const g = j.going
    if (g?.state !== "waiting" || looking.has(j.id)) return
    looking.add(j.id)
    liveRead.set(j.id, Date.now())
    try {
      type V = { live: boolean; final: boolean; why: string; red?: string }
      const out = await links.of(j.where).there(appCtx(), "app.version", { commit: g.commit }, 30)
        .catch(() => null) as { live?: V } | null
      // (told something meanwhile: its own turn decides)
      if (j.going !== g || g.state !== "waiting") return
      const v = out?.live ?? null, c = g.commit.slice(0, 7), next = liveStep(v, g), was = g.why
      if (next === "wait") g.why = `Merged ${c}: waiting for it to go live${v ? ` (${v.why.replace(/^\S+ isn't live here yet: /, "")})` : ""}`
      else if (next === "live") { g.state = "live"; g.why = `Live: ${c} runs on ${j.where.label || "its server"}`; move(j, "landed") }
      else if (next === "stuck") { g.state = "stuck"; g.why = v ? `Merged ${c}, not live: ${v.why.replace(/^\S+ won't be live here: /, "")}` : `Merged ${c}, not live: ${j.where.label || "its server"} didn't say it is after ${Math.round((Date.now() - g.since) / 60_000)} min`; move(j, "landed") }
      else if (next === "red") { g.state = "stuck"; g.why = `CI failed on ${c} after ${g.fixes} fix${g.fixes === 1 ? "" : "es"} forward: it needs you`; move(j, "asks") }
      else {
        g.state = "fixing"; g.fixes++
        g.why = `CI failed on ${c}: sent back to fix it forward`
        try { await steer(appCtx(), j, fixTask(j.where, g.commit, v!.why), g.why) } catch (e) { g.state = "stuck"; g.why = `CI failed on ${c}, and it couldn't be sent back: ${(e as Error).message}`; move(j, "asks") }
      }
      j.now = g.why
      if (g.why !== was) changed()
    } finally { looking.delete(j.id) }
  }
  /** Jobs at rest whose turn ended with work still going (finish's restEvent): when that was last read. */
  const goingOn = new Map<string, number>()
  /** Whether job `j` landed its own change (`s` read with its diff, `text` its words): a commit it names, or its branch,
   *  on main since it began, else its words saying so when they name none. Never one merging what they kept (landed). */
  const shipped = (j: Job, s: Seen, text: string) => !!j.where.repo && !(j.land && j.land.at === undefined) && (s.onMain === true || (!commitsIn(text).length && landedSaid(text)))
  /** When each job ready for review was last looked for on main (its change landed by itself, or by anyone later). */
  const shipRead = new Map<string, number>()
  async function shippedSince(j: Job) {
    shipRead.set(j.id, Date.now())
    const s = await seenOf(j, false, true).catch(() => null)
    return !!s && shipped(j, s, [j.result?.text, j.last?.text].filter(Boolean).join("\n")) && move(j, "landed")
  }
  /** Job `j` ready for review looked for on main on its own, its terminal read or not (gone, on a machine away). */
  async function ship(j: Job) {
    if (busy.has(j.id)) return
    if (await shippedSince(j) || marked.delete(j.id)) changed()
  }
  /** Its turn over while it merged what they kept (`text`: its words): whether it says it merged, read once. */
  function landed(j: Job, text: string) {
    if (!j.land || j.land.at !== undefined) return false
    j.land = { ...j.land, at: Date.now(), merged: mergedSaid(text) === true }
    return j.land.merged === true
  }
  /** Its terminal ended (`s`): while it worked, by what it left in its session's transcript and how it ended (endEvent);
   *  else as the lifecycle says. Read once per end. */
  async function ended(j: Job, s: Seen) {
    if (!live(j.state)) { j.exited = Date.now(); move(j, "ended"); resumable(j); return true }
    // (its turn read already, its landed commit waited on: a worker ending itself once it merged)
    if (waitsLive(j)) { j.exited = Date.now(); resumable(j); return true }
    const r = await seenOf(j, true).catch(() => null)
    if (!r) return false
    j.exited = Date.now()
    const x = s.exit, done = resultOf(j, r)
    if (done.text || done.result.files?.length) j.result = done.result
    heard(j, r)
    // (a terminal ended on purpose, End session or vau terminal end, reads as a SIGHUP)
    const crashed = !!x && (!!x.lost || x.code !== 0 || (x.signal !== 0 && x.signal !== 1))
    if (landed(j, done.text) || shipped(j, r, done.text)) arrived(j, done.text)
    else move(j, endEvent({ text: !!done.text.trim(), final: !!r.turn?.final && !!done.text, changes: done.changes, crashed }))
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
    if (!s.running || j.held || d.warm?.(j) || Date.now() - Math.max(j.at, opened.get(j.id) ?? 0) < grace || (s.state !== "idle" && s.state !== "done")) return false
    // (a cloud session at rest pauses by itself: no longer followed, a follow-up still reaches it)
    if (j.where.cloud) { j.exited = Date.now(); return true }
    const t = await seenOf(j, true, false).catch(() => null)
    if (t?.turn?.session) j.session ??= t.turn.session
    if (!t?.running || t.turn?.background || !resumeOf(j) || d.onScreen?.(linkOf(j))) return false
    await links.of(j.where).end(appCtx(), j.terminal)
    j.exited = j.closed = Date.now()
    resumable(j)
    return true
  }
  /** When each closed job's worktree was last looked at to remove. */
  const pruneRead = new Map<string, number>()
  /** Closed job `j`'s worktree removed on its machine, its terminal gone, when nothing in it exists only there. */
  async function prune(j: Job) {
    const w = j.where
    if (!w.tree || w.cloud || w.watched || j.pruned || Date.now() - (pruneRead.get(j.id) ?? 0) < 3600_000) return
    if (j.state !== "stopped" && !(j.state === "done" && j.exited)) return
    pruneRead.set(j.id, Date.now())
    const r = await links.of(w).there(appCtx(), "companion.worktree-drop", { cwd: w.cwd, tree: w.tree, branch: w.branch ?? "" }, 150) as { why?: string }
    if (!r.why) { j.pruned = Date.now(); changed() }
  }
  /** Job `j`'s conversation running again in a terminal when its own was closed or ended (told `prompt` first). */
  async function wake(ctx: OpCtx, j: Job, prompt = "") {
    const s = await seenOf(j).catch(() => null)
    if (!s || s.running) return false
    if (!j.session) throw new OpError(`${j.id}'s terminal ended and its conversation isn't known: hand it off again`, 409)
    await startIn(ctx, j, prompt, j.session)
    return true
  }
  /** Job `j`'s worker in a new terminal, told `prompt` first: its conversation `session` resumed, else a new one. */
  async function startIn(ctx: OpCtx, j: Job, prompt: string, session?: string) {
    await trust(ctx, j)
    j.terminal = await links.of(j.where).start(ctx, startOf(j, { ...(prompt ? { prompt } : {}), ...(session ? { session } : {}) }))
    delete j.exited; delete j.closed
    opened.set(j.id, Date.now())
  }
  /** How job `j`'s worker starts: its agent, folder, name and how it runs, with its first words or the session it resumes. */
  const startOf = (j: Job, o: { prompt?: string; session?: string }) => {
    const w = j.where, mode = w.agent.split("_")[0] === "claude" ? setting("jobs_mode") : ""
    return { agent: w.agent, cwd: w.cwd, name: j.title, ...o, ...(w.model ? { model: w.model } : {}), ...(w.effort ? { effort: w.effort } : {}), ...(mode ? { mode } : {}), ...(w.cloud && w.base ? { base: w.base } : {}) }
  }
  /** Job `j`'s worker started over in a new conversation, told `text` first (its old one's context grown large: live
   *  editing's summary and next ask), then its old terminal ended. Its card shows `shown`. */
  async function fresh(ctx: OpCtx, j: Job, text: string, shown = text, by = COMPANION) {
    if (j.state === "stopped") throw new OpError(`${j.id} was stopped: hand it off again`, 409)
    const link = links.of(j.where), old = j.terminal, was = await seenOf(j).catch(() => null)
    text = await link.carry(text)
    // (the new one's first: the old one's end then finds no job of its, so it can't move this one or claim its terminal)
    await startIn(ctx, j, text)
    delete j.session
    if (was?.running) await link.end(ctx, old).catch(() => {})
    toldFrom(j, by, text)
    move(j, "told")
    j.turn = Date.now()
    j.now = `Started fresh: ${gist(shown, 120)}`
    resting.delete(j.id)
    changed()
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
      // (one done whose terminal runs: looked at for tidy; one ready for review: its terminal gone is its end, its change on main)
      const later = (j.where.machine && j.state !== "stopped" && recent) || (j.state === "done" && !j.exited) || (j.state === "ready for review" && recent)
      if (live(j.state) ? (j.where.machine || ticks % 2 === 0) : later && ticks % 10 === 0) void refresh(j).catch(() => {})
      // (its change landed by anyone, however long ago it went ready: never only through its terminal's read)
      if (j.state === "ready for review" && j.where.repo && Date.now() - (shipRead.get(j.id) ?? 0) >= SHIP_READ) void ship(j).catch(() => {})
      if (j.going?.state === "waiting" && Date.now() - (liveRead.get(j.id) ?? 0) >= LIVE_READ) void golive(j).catch((e) => console.error("companion: jobs:", e))
      if (ticks % 20 === 0) void prune(j).catch(() => {})
    }
    // (what waits for a machine: looked at every 15 s, sent once it's back)
    if (ticks % flushTicks === 0) void flush().catch((e) => console.error("companion: jobs:", e))
  }, 3000)
  timer.unref?.()
  plugin.onUnload(() => clearInterval(timer))

  /** Follow-up `q` kept for job `j`'s machine (or added to its start, while it waits to start); false when that one
   *  waits already. */
  function keep(j: Job, q: Queued) {
    const same = (a: string) => a.replace(/\s+/g, " ").trim().toLowerCase()
    if (j.queued?.some((x) => x.note.split("\n").some((n) => same(n) === same(q.note)))) return false
    const start = j.queued?.find((x) => x.start)
    // (a job not started yet is told it with its task: typed into an agent still starting, it could be lost)
    if (start && !q.land) start.text = `${start.text}\n\nAlso: ${q.text}`
    if (start && !q.land) start.note = `${start.note}\n${q.note}`
    else (j.queued ??= []).push(q)
    if (q.title && start) j.title = q.title.replace(/\s+/g, " ").trim().slice(0, 80)
    changed()
    return true
  }
  /** What waits for a machine, sent once it's back, in order (as whoever handed it): a waiting job started, follow-ups
   *  typed in. One that fails for another reason is dropped, said on its card. */
  let flushing = false
  async function flush() {
    const waiting = all().filter((j) => j.queued?.length && j.state !== "stopped")
    if (flushing || !waiting.length) return
    flushing = true
    try {
      for (const j of waiting) {
        const m = await plugin.ask<Machine | null>("machines:machine", null, j.where.machine).catch(() => null)
        if (!m?.online) continue
        while (j.queued?.length) {
          const q = j.queued[0], ctx = appCtx(q.by)
          try {
            if (q.start) await startWaiting(ctx, j, q)
            else if (q.land) await land(ctx, j, q.text, q.shown, q.teller)
            else await steer(ctx, j, q.text, q.shown, q.teller)
            if (q.title && !q.start) await retitle(ctx, j, q.title)
            j.queued.shift()
          } catch (e) {
            if (await away(j.where.machine, e)) break
            j.queued.shift()
            const why = (e as Error).message
            if (q.start) { j.now = why; move(j, "error") } else j.now = `Couldn't pass on "${cut(q.note, 60)}": ${why}`
          }
          changed()
        }
        if (!j.queued?.length) { delete j.queued; changed() }
      }
    } finally { flushing = false }
  }
  /** Job `j`, waiting for its machine, placed there and started now that it's back (its ask `q.ask`, its handoff `q.start`). */
  async function startWaiting(ctx: OpCtx, j: Job, q: Queued) {
    const p = q.start ?? {}
    j.where = await placedWith(await route(q.ask, p), p)
    await accountThere(ctx, j.where.machine, p)
    await launch(ctx, j, q.text, q.ask, p)
  }

  /** A call as the app's own companion (or `by`), outside any request: what's sent by itself later. */
  function appCtx(by: Who = APP) {
    return { who: by, op: async (id: string, ps?: Record<string, unknown>) => (await plugin.runOp(id, ps ?? {}, by)).result } as unknown as OpCtx
  }
  const jobOf = (id: string) => {
    const want = id.trim(), j = all().find((x) => x.id === want) ?? all().find((x) => want.length >= 3 && x.id.endsWith(want))
    if (!j) throw new OpError(`no job ${want} (companion jobs lists them)`, 404)
    return j
  }

  /** Job `j` named `title` (its card and its terminal), when a follow-up changed what it's about. */
  async function retitle(ctx: OpCtx, j: Job, title: string) {
    j.title = title.replace(/\s+/g, " ").trim().slice(0, 80)
    await ctx.op("terminal.rename", { id: terminalOf(j), name: j.title }).catch(() => {})
    changed()
  }
  /** A follow-up or correction to job `j`, typed into its worker's terminal (the user's own words, as if they typed);
   *  its terminal closed or ended, its conversation resumed with it. */
  async function steer(ctx: OpCtx, j: Job, text: string, shown = text, by = COMPANION, how: "tell" | "land" = "tell") {
    if (j.state === "stopped") throw new OpError(`${j.id} was stopped: hand it off again`, 409)
    const link = links.of(j.where)
    text = await link.carry(j.pruned ? `${prunedLine(j.where)} ${text}` : text)
    delete j.pruned
    const s = await seenOf(j).catch(() => null)
    if (s && !s.running) {
      if (!j.exited) await ended(j, s)
      changed()
      if (!await wake(ctx, j, text)) throw new OpError(`${j.id}'s terminal can't be reached now: try again (${linkOf(j)})`, 502)
      toldFrom(j, by, text)
    } else {
      if (s?.state === "blocked" && s.kind === "permission") throw new OpError(`${j.id} waits on a permission in its terminal (${s.msg ?? "open it"}): only the user answers it (its notification, or job-answer on their words; ${linkOf(j)})`, 409)
      // (told before it's typed, its rest not its turn's end till the terminal took the words, which takes a while: a
      // quick turn ending meanwhile is this one's, never followed by a told that comes after it)
      const was = { state: j.state, turn: j.turn, now: j.now }
      toldNow(j, shown)
      sending.add(j.id)
      const back = () => { Object.assign(j, was); changed() }
      const r = await link[how](ctx, j.terminal, text).catch((e) => { back(); throw e }).finally(() => sending.delete(j.id))
      if (r.submitted === false) { back(); throw new OpError(`it didn't take it: ${r.why ?? "its input kept the text"} (${linkOf(j)})`, 409) }
      toldFrom(j, by, text)
      void refresh(j).catch((e) => console.error("companion: jobs:", e))
      return
    }
    toldNow(j, shown)
  }
  /** Job `j` told `text` by `by` (tellerOf), kept with it: the last 8. */
  function toldFrom(j: Job, by: string, text: string) {
    (j.tells ??= []).push({ at: Date.now(), by, text: text.replace(/\s+/g, " ").trim().slice(0, 300) })
    if (j.tells.length > 8) j.tells.splice(0, j.tells.length - 8)
  }
  /** A job of theirs (the user's or the companion's, never one a script or another agent handed off) in one of their
   *  checkouts there: Claude Code's "Trust this folder?" answered for it in the job's account, so it never waits on that. */
  async function trust(ctx: OpCtx, j: Job) {
    const w = j.where, by = j.by ?? ""
    if (!w.repo || w.cloud || w.agent.split("_")[0] !== "claude" || !(by === COMPANION || by === THEM || by.startsWith(`${COMPANION} (`))) return
    const body = { cwd: w.cwd, account: parseTerminal(`${w.agent}-x`)?.profile || "default" }
    // (it can't: the job starts anyway, Claude Code asking as before)
    try { await links.of(w).there(ctx, "claude-code.trust", body, 10) } catch (e) { console.error(`companion: jobs: ${j.id}: trust:`, (e as Error).message) }
  }
  /** Job `j` told `shown`: working on it, its turn from now. */
  function toldNow(j: Job, shown: string) {
    move(j, "told")
    j.turn = Date.now()
    j.now = `Told: ${gist(shown, 120)}`
    resting.delete(j.id)
    changed()
  }

  /** They kept job `j`'s change: its own worker, warm with its context, told to land it (closed once it says merged). */
  async function land(ctx: OpCtx, j: Job, note = "", shown?: string, by = COMPANION) {
    const was = j.land
    j.land = { asked: Date.now() }
    try { await steer(ctx, j, [landTask(j.where), note].filter(Boolean).join(" "), shown ?? "Kept: merge it", by, "land") } catch (e) { j.land = was; throw e }
  }
  /** Closed by the user (their stop, their Keep): one ready for review is done, else stopped; its terminal ends. */
  async function close(ctx: OpCtx, j: Job) {
    // (the user's own stop: nothing new to tell them)
    if (move(j, "stop")) { j.seen = true; changed() }
    // (one still waiting for its machine has no terminal yet)
    if (!j.terminal) return
    await links.of(j.where).end(ctx, j.terminal).catch((e: unknown) => { if (!(e instanceof OpError && (e.status === 404 || e.status === 502))) throw e })
  }
  /** The job whose terminal ask `m` was over (the pane they held the Talk key on), if any. */
  const jobOver = (m: Moment | undefined) => { const to = m?.pane ? d.paneTo?.(m.pane) ?? "" : ""; return to ? all().find((x) => linkOf(x) === to) : undefined }
  /** Why an agent can't take job `j` as the one their ask `m` means: it was over another job's terminal and their words
   *  (`which`, quoted from it) don't name this one; "" when it can. */
  function unsure(j: Job, m: Moment | undefined, which: string) {
    const over = jobOver(m)
    if (!over || over.id === j.id) return ""
    const w = plainWords(which)
    if (w && m?.text && ` ${plainWords(m.text)} `.includes(` ${w} `)) return ""
    const short = (x: Job) => x.title.split(/\s+/).slice(0, 4).join(" ")
    return `their ask was over the job "${over.title}" (${over.id}), not "${j.title}" (${j.id}): unless their words name the one they mean (then which: those words), ask them which in one short line ("${short(j)}, or ${short(over)}?"), each a button (draw: a button each, its ask the job's name, the question in its say)`
  }

  /** A new job doing `task` (told where it runs: what it's given may depend on it), placed by the ask it came from (`m`)
 *  unless `p` says where; started in its terminal. */
  async function begin(ctx: OpCtx, task: string | ((w: Where) => Promise<string>), m: Moment | undefined, p: Record<string, unknown>, by = COMPANION) {
    const titleOf = (told: string) => (str(p.title).trim() || told.replace(/\s+/g, " ")).slice(0, 80).replace(/^(.{60,}?)\s.*$/, "$1…")
    // (a machine asked for that's offline: the job waits for it, shown so in Jobs, never a retry left to them)
    const asked = str(p.machine).trim()
    let where: Where
    try {
      where = await placedWith(await route(m, p), p)
      await accountThere(ctx, where.machine, p)
    } catch (e) {
      if (typeof task === "string" && await away(asked, e)) return await waitFor(ctx, task, titleOf(task), m, p, asked, by)
      throw e
    }
    const told = typeof task === "string" ? task : await task(where)
    const now = Date.now()
    const j: Job = { id: newId(), title: titleOf(told), state: "starting", where, terminal: "", now: "", ...(m ? { asked: m.t } : {}), started: now, turn: now, at: now, seen: false, log: [], by }
    all().unshift(j)
    try { await launch(ctx, j, told, m, p) } catch (e) {
      if (typeof task !== "string" || !await away(where.machine, e)) throw e
      all().splice(all().indexOf(j), 1)
      return await waitFor(ctx, task, j.title, m, p, where.machine, by)
    }
    return j
  }
  /** A job handed to `machine` while it's offline: kept, waiting (Jobs shows it), started once it's back (flush). */
  async function waitFor(ctx: OpCtx, task: string, title: string, m: Moment | undefined, p: Record<string, unknown>, machine: string, by: string) {
    const now = Date.now(), label = await labelOf(machine), { say: _, ...start } = p
    const where: Where = { machine, label, cwd: str(p.cwd), repo: "", why: `${label} is offline: it starts once it's back`, ...await harnessOf(p) }
    const j: Job = { id: newId(), title, state: "waiting", where, terminal: "", now: `Waiting for ${label} to come back`, ...(m ? { asked: m.t } : {}), started: now, turn: now, at: now,
      seen: false, log: [], by, queued: [{ note: task, text: task, at: now, start: { ...start, machine }, ...(m ? { ask: m } : {}), by: ctx.who, teller: by }] }
    all().unshift(j)
    j.carded = now
    changed()
    return j
  }
  /** Job `j`, placed (`j.where`), started in its terminal doing `told`, for ask `m`. */
  async function launch(ctx: OpCtx, j: Job, told: string, m: Moment | undefined, p: Record<string, unknown>) {
    const where = j.where
    // (`p.on` "": a job no page's asks go to live, as a QA walk's: it works through a list)
    const on = typeof p.on === "string" ? p.on : surfaceOf(m)
    if (on) j.on = on
    // (a coding job's own worktree, beside the checkout it was asked over: it lands only by their Keep and merge)
    // (one over a preview they watch edits what serves it, so the page reloads as it goes)
    if (inPlace(where) && !where.cloud) where.watched = true
    // (a cloud session works on a branch of its own there)
    else if (where.repo) Object.assign(where, where.cloud ? {} : worktreeOf(where.cwd, where.repo, j.id), lands() ? { lands: true } : {})
    j.now = `starting in ${tilde(where.cwd)}`
    await trust(ctx, j)
    const task = jobTask(told, m, where, j.id, { land: lands(), proof: proofMode() })
    try {
      const link = links.of(where)
      j.terminal = await link.start(ctx, startOf(j, { prompt: await link.carry(task) }))
    } catch (e) {
      // (its machine gone offline: it waits for it, so no failure)
      if (!await away(where.machine, e)) { j.now = (e as Error).message; move(j, "error"); changed() }
      throw e
    }
    move(j, "start")
    j.carded = Date.now()
    changed()
    return j
  }

  plugin.op({
    id: "companion.handoff",
    cli: "companion handoff",
    summary: "Hand long work to a worker: a coding agent (Claude Code on Opus, or Codex) in a terminal of the app, where the ask was (its repo, here or on another machine); job: tell one more.",
    help: `For what takes more than a minute or two: code, research, a document, a long errand, writing in their notes. It
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
      // (another agent's vau or a script, as the companion by its `who`: not its words, nor its user's ask)
      // (and only the ask its turn answers: one long past isn't what it hands off now)
      const own = d.own(name, ctx), latest = own ? d.askOf(name) : undefined, ask = latest && Date.now() - latest.t <= ANSWERING_MS ? latest : undefined
      const by = tellerOf(ctx, own ? name : "")
      if (!own) return await handoff(p, ctx, task, ask, by, async () => {})
      holding(name, ctx, ask?.t ?? Date.now())
      try { return await handoff(p, ctx, task, ask, by, async (t: Told) => { d.did(name, "handoff"); heldTold(name, { ...t, say: str(p.say).trim() }) }) }
      finally { release(name) }
    },
    text: (r) => r.queued ? `Kept for later (${r.id}): "${r.title}". ${r.now}: it's sent by itself then, shown waiting in Jobs; nothing for them to retry. End your turn.`
      : `Handed off (${r.id}): "${r.title}", ${r.state}, on ${r.where}${r.why ? ` (${r.why})` : ""}. The user sees it in Jobs: end your turn.`,
    did: (p) => ({ action: "run", text: p.job ? `Told the job ${p.job} ${quoted(p.task, 60)}` : `Handed off ${quoted(p.task, 60)}`, by: d.who(p) }),
  })

  // (held till its turn ends: the turn's own words may announce it after the call)
  type Held = { ctx: OpCtx; calls: number; items: Told[]; since: number; ends: Promise<void> | null; timer?: ReturnType<typeof setTimeout>; waiting?: boolean }
  const told = new Map<string, Held>(), mine = new Set<string>()
  function holding(name: string, ctx: OpCtx, since: number) {
    const t = told.get(name) ?? { ctx, calls: 0, items: [], since, ends: d.turnEnd?.(name) ?? null }
    clearTimeout(t.timer)
    t.calls++
    t.ctx = ctx
    told.set(name, t)
  }
  const heldTold = (name: string, item: Told) => told.get(name)?.items.push(item)
  const after = (ms: number) => new Promise<void>((r) => setTimeout(r, ms).unref?.())
  function release(name: string) {
    const t = told.get(name)
    if (!t || --t.calls > 0) return
    const tell = () => {
      if (told.get(name) !== t) return
      told.delete(name)
      const line = toldLine(t.items, (d.saidSince?.(name, t.since) ?? []).filter((x) => !mine.has(x)).join(" "))
      if (line) { mine.add(line); if (mine.size > 50) mine.delete(mine.values().next().value!) }
      if (line) void d.say(t.ctx, name, line).catch((e) => console.error("companion: jobs:", e))
    }
    if (t.ends) { if (!t.waiting) { t.waiting = true; void Promise.race([t.ends.then(() => after(TELL_MS)), after(TURN_END_MAX_MS)]).then(tell) } return }
    t.timer = setTimeout(tell, TELL_MS)
    t.timer.unref?.()
  }

  async function handoff(p: Record<string, unknown>, ctx: OpCtx, task: string, ask: Moment | undefined, by: string, told: (t: Told) => Promise<void>) {
      // (an ask live editing sent straight to the job on its page: it has it already)
      const sent = ask?.live
      if (sent) throw new OpError(`this ask already went straight to the job ${sent} working on that page (live editing), which does it: end your turn`, 409)
      if (str(p.job)) {
        const j = jobOf(str(p.job))
        // (their ask goes with it once: one the job was already given isn't told again; none when it isn't about its work)
        const m = ask, fresh = m && p.ask !== false && m.t > (j.asked ?? 0) ? m : undefined
        const unsureWhy = ctx.who.agent ? unsure(j, m, str(p.which)) : ""
        if (unsureWhy) throw new OpError(unsureWhy, 409)
        if (str(p.account)) throw new OpError("account is a new job's: a job keeps the account it runs in")
        const text = followTask(task, fresh, j.id), title = str(p.title).trim()
        const q: Queued = { note: task, text, at: Date.now(), ...(p.land === true ? { land: true, shown: task } : {}), ...(title ? { title } : {}), by: ctx.who, teller: by }
        // (its machine offline, or one it waits for already: kept and passed on once it's back)
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
      // (every handoff of its own says so in a line, a routine one too: else it looked like nothing happened)
      await told(j.state === "waiting" ? { kind: "kept", title: j.title, line: `${j.where.label} is offline: the job starts there once it's back.` } : { kind: "new", title: j.title, line: "Handed that off to a background agent." })
      return { ...cardOf(j), why: j.where.why, ...(j.state === "waiting" ? { queued: true } : {}) }
  }

  /** Words that close a job, said by them. */
  const CLOSES = /\b(close|stop|drop|cancel|discard|scrap|abandon|kill|end|forget|done with|don'?t need|throw)\b/
  /** How recent the user's ask must be for the companion to answer a job's prompt with it. */
  const ASKED_MS = 3 * 60_000
  /** How recent their own message to an agent (typed in its session) must be: its turn may read and check a while first. */
  const TYPED_MS = 15 * 60_000
  const plainWords = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()
  const holds = (text: string, said: string) => !!said && ` ${plainWords(text)} `.includes(` ${said} `)
  const cut = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t }
  /** The user answering through their companion: their own word, which only they may give (inbox.answer). */
  const BY_THEIR_WORD = { ...whoOf("app/companion", null), label: "the user, through their companion" }
  /** Who may have typed a terminal's input as the user: the app's surfaces (their tab, the inbox's reply), never an agent's vau. */
  const theirs = (by: string) => by === "the user" || by.startsWith("app/") || by.startsWith("machine/") || by === "iphone" || by === "watch"

  /** The user's own latest message in the calling agent's conversation (its terminal's or chat's session, from its
   *  transcript), and who typed it into its terminal when it wasn't them; null when the call has no session it can read. */
  async function typedTo(ctx: OpCtx): Promise<{ text: string; at: number; sentBy: string } | null> {
    const w = requestWriter.getStore(), terminal = w?.terminal ?? "", session = w?.session ?? ""
    if (!terminal && !session) return null
    const agent = parseTerminal(terminal)?.agent ?? KNOWN_AGENTS.find((k) => k.id === ctx.who.agent)?.terminal ?? ""
    const said = agent ? await plugin.ask<{ text: string; at: number } | null>(`agent-said:${agent}`, null, terminal, session).catch(() => null) : null
    if (!said?.text) return null
    // (typed into its terminal by an op, another agent's vau: it reads as typed, but isn't theirs)
    const sq = (s: string) => s.replace(/…$/, "").replace(/\s+/g, " ").trim().slice(0, 120)
    const r = terminal ? await ctx.api("GET", `terminals/${encodeURIComponent(terminal)}/inputs`).catch(() => null) as { inputs?: { by: string; text?: string }[] } | null : null
    const sent = (r?.inputs ?? []).findLast((x) => !!x.text && sq(x.text) === sq(said.text))
    // (a job's worker: its task is the companion's handoff, not their message)
    return { text: said.text, at: said.at, sentBy: said.text.includes(HANDED) ? "the companion, as your job's task" : sent && !theirs(sent.by) ? sent.by : "" }
  }
  /** Whether `said` quotes the user's own word given after `since`: their Talk key ask `m`, else their latest message to
   *  the calling agent (`closes`: words that close a job). Who said it, or why it isn't theirs. */
  async function theirWord(ctx: OpCtx, m: Moment | undefined, said: string, o: { since?: number; closes?: boolean } = {}): Promise<{ by: string } | { why: string }> {
    const since = o.since ?? 0
    if (!said) return { why: "said is missing: quote their words, as they said them" }
    if (o.closes && !CLOSES.test(said)) return { why: `"${said}" doesn't close it: quote their words that do ("close it", "drop it")` }
    if (m?.text && m.t >= since && Date.now() - m.t <= ASKED_MS && holds(m.text, said)) return { by: "the user, through their companion" }
    const t = await typedTo(ctx)
    if (!t) return { why: m?.text ? `"${said}" isn't in their latest ask to the companion, and your session's messages can't be read (only a Claude Code session's)` : "no message of theirs to quote: their ask to the companion, or their latest message in your session (a Claude Code session's, read from its transcript)" }
    if (t.sentBy) return { why: `their latest message in your session was typed into its terminal by ${t.sentBy}, not by them` }
    if (!holds(t.text, said)) return { why: `"${said}" isn't in their latest message to you ("${cut(t.text, 80)}")` }
    if (t.at && t.at < since) return { why: "their latest message to you came before it began waiting: ask them" }
    if (Date.now() - t.at > TYPED_MS) return { why: `their latest message to you is ${Math.round((Date.now() - t.at) / 60_000)} min old: ask them again` }
    return { by: "the user, in their message to you" }
  }
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
        // (an agent answers only with the user's own words, said after it began waiting: never yes on its own)
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
      opened.set(j.id, Date.now())
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
      // (an agent's: the user's own stop, from the app or their shell, is theirs)
      if (ctx.who.agent) {
        const m = d.own(d.who(p), ctx) ? d.askOf(d.who(p)) : undefined, why = unsure(j, m, str(p.which))
        if (why) throw new OpError(why, 409)
        // (closing what they haven't decided on is theirs: "keep it" with nothing shown once closed an unmerged job)
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

  plugin.op({
    id: "companion.where",
    cli: "companion where",
    owner: "the companion's jobs",
    summary: "Where a job asked over a page, an app's window or a note would run on this machine: the folder, its repo, why (another machine's companion asks it too).",
    help: `Where a repo is on each machine, read there (each keeps its repos in its own folders): say what it answers, never
a guess from a look at one machine's folders.

  vau companion where --url http://localhost:5173
  vau companion where --url https://github.com/lighthouse/site
  vau companion where --repo site --machine studio`,
    kind: "read",
    params: { url: { type: "string", description: "the page's address" }, app: { type: "string", description: "the app (its bundle id)" }, title: { type: "string", description: "its window's title" },
      path: { type: "string", description: "a note's path" }, cwd: { type: "string", description: "a folder, as given (another machine's path to a repo finds this one's own checkout of it)" },
      repo: { type: "string", description: "a repo, by GitHub's owner/name or its folder's name (vaultite): this machine's own checkout of it" },
      machine: { type: "string", description: "ask that machine instead (its id, as Machines lists them)" } },
    run: async (p) => {
      const machine = str(p.machine).trim(), self = machine ? (await plugin.ask<Machine | null>("machines:machine", null, machine))?.self : true
      const { machine: _, ...rest } = p
      const r = self ? await placeHere({ url: str(p.url) || undefined, app: str(p.app) || undefined, title: str(p.title) || undefined, path: str(p.path) || undefined }, str(p.cwd), str(p.repo))
        : await atMachine(machine, "companion.where", rest, 8) as unknown as Placed
      return { ...r, label: await labelOf(self ? "" : machine) }
    },
    text: (r) => r.missing ? `On ${r.label}: ${r.why} (looked in ${r.looked ?? "its project folders"}). Its checkouts: ${r.have || "none"}.`
      : `On ${r.label}: ${tilde(r.cwd)}${r.repo ? ` (${r.repo})` : ""}: ${r.why}${r.refused ? `. Refused: ${r.refused}` : ""}`,
  })

  plugin.op({
    id: "companion.worker",
    cli: "companion worker",
    owner: "the companion's jobs",
    summary: "A job's worker terminal on this machine as Vaultite reads it: running, its state and title; turn: its last turn, and the diff since base in cwd.",
    kind: "read",
    params: { id: { type: "string", required: true, description: "its terminal's id" }, turn: { type: "boolean", description: "its last turn and the diff too" },
      session: { type: "string", description: "its agent's session (its turn read from it, the terminal ended or not)" },
      cwd: { type: "string", description: "its folder (the diff's)" }, base: { type: "string", description: "the commit the diff counts from" },
      tree: { type: "string", description: "its own worktree: the diff's once it exists" }, branch: { type: "string", description: "its own branch (whether it's on main)" },
      said: { type: "string", description: "its words (whether a commit they name is on main)" }, context: { type: "boolean", description: "how full its agent's context is too" },
      marks: { type: "object", description: "its change's marks read before ({whole, each}: patch-ids), for once its branch is gone" } },
    args: ["id"],
    run: async (p) => seenHere(str(p.id), { turn: p.turn === true, session: str(p.session), cwd: str(p.cwd), base: str(p.base), tree: str(p.tree), branch: str(p.branch), said: str(p.said), context: p.context === true,
      ...(marksIn(p.marks) ? { marks: marksIn(p.marks)! } : {}) }),
  })

  plugin.op({
    id: "companion.worktree-drop",
    owner: "the companion's jobs",
    summary: "Remove a closed job's worktree on this machine (another machine's companion, its home, asks), and its branch once on the checkout's upstream; kept, saying why, while it has changes or commits no remote has.",
    kind: "write",
    lock: false,
    params: { cwd: { type: "string", required: true, description: "the checkout it's beside" }, tree: { type: "string", required: true, description: "the job's worktree" },
      branch: { type: "string", description: "its branch" } },
    run: async (p) => ({ why: await dropTree(str(p.cwd), str(p.tree), str(p.branch)) }),
  })

  plugin.op({
    id: "companion.worker-start",
    owner: "the companion's jobs",
    summary: "Start a job's worker in a terminal on this machine for another machine's companion, its home: its vau tells the user through home (VAULTITE_HOME), and this machine counts it among its jobs.",
    kind: "write",
    lock: false,
    params: { agent: { type: "string", required: true, description: "its agent (claude, codex; claude_personal: in that account)" },
      cwd: { type: "string", required: true, description: "its folder here" }, name: { type: "string", required: true, description: "its name (the job's title)" },
      prompt: { type: "string", description: "its first words: the task" }, session: { type: "string", description: "its conversation to resume instead" },
      model: { type: "string", description: "its model" }, effort: { type: "string", description: "its effort" }, mode: { type: "string", description: "its permission mode" },
      home: { type: "object", description: "its home ({url, as}: the server that handed it, and this machine's id there)" } },
    run: async (p, ctx) => {
      const h = p.home as Partial<Home> | undefined
      const home = h && typeof h.url === "string" && typeof h.as === "string" ? { url: h.url, as: h.as } : undefined
      return { id: await links.startHere(ctx, { agent: str(p.agent), cwd: str(p.cwd), name: str(p.name), ...(str(p.prompt) ? { prompt: str(p.prompt) } : {}), ...(str(p.session) ? { session: str(p.session) } : {}),
        ...(str(p.model) ? { model: str(p.model) } : {}), ...(str(p.effort) ? { effort: str(p.effort) } : {}), ...(str(p.mode) ? { mode: str(p.mode) } : {}) }, home) }
    },
  })

  plugin.op({
    id: "companion.capacity",
    cli: "companion capacity",
    owner: "the companion's jobs",
    summary: "What this machine says of its jobs, where they're placed: the workers it runs now and how many it takes (the setting jobs_cap), the repos it has checked out, the agents it runs and their accounts.",
    kind: "read",
    run: () => capacity(),
    text: (r) => `${r.jobs} of ${r.cap} jobs running. Agents: ${r.agents.join(", ") || "none"}${r.accounts ? ` (accounts: ${r.accounts.join(", ")})` : ""}. Repos: ${r.repos.join(", ") || "none"}.`,
  })

  /** A file a job's worker on another machine hands home for its proof (its video, its pictures): kept a day, out of the
   *  vault, till its tour-save here copies it beside the proof. */
  plugin.op({
    id: "companion.job-file",
    owner: "the companion's jobs",
    summary: "Keep a file a job's worker on another machine sends for its proof (a video, a picture) on this machine, its home: answers its path here.",
    kind: "write",
    lock: false,
    input: "the file",
    params: { job: { type: "string", required: true, description: "the job's id" }, name: { type: "string", required: true, description: "its file name (demo.mp4, before 1.png)" } },
    run: async (p, ctx) => {
      const job = str(p.job), name = path.basename(str(p.name))
      if (!/^[\w-]{1,40}$/.test(job)) throw new OpError(`job: a job's id, not ${job}`)
      if (!/\.(mp4|m4v|mov|webm|png|jpe?g|gif|webp|heic)$/i.test(name)) throw new OpError(`'${name}' isn't a video or a picture`)
      if (!ctx.input) throw new OpError("send the file's bytes as the request's body")
      const root = path.join(plugin.localDir(), "job-files"), dir = path.join(root, job)
      fs.mkdirSync(dir, { recursive: true })
      for (const d of fs.readdirSync(root)) { try { if (Date.now() - fs.statSync(path.join(root, d)).mtimeMs > 86_400_000) fs.rmSync(path.join(root, d), { recursive: true }) } catch { /* gone */ } }
      const to = path.join(dir, name), chunks: Buffer[] = []
      let n = 0
      for await (const c of ctx.input) { n += c.length; if (n > PROOF_MAX) throw new OpError("the file is too large", 413); chunks.push(c) }
      fs.writeFileSync(to, Buffer.concat(chunks))
      return { path: to }
    },
  })

  /** A picture of the user's screen another machine's companion hands on with an ask, for a job here: kept a day, out of
   *  the vault (its worker reads it by the path answered). */
  plugin.op({
    id: "companion.picture-take",
    owner: "the companion's jobs",
    summary: "Keep a picture of the user's screen on this machine for a job here (another machine's companion hands an ask's pictures on this way): answers its path.",
    kind: "write",
    lock: false,
    input: "the picture (PNG)",
    params: { name: { type: "string", required: true, description: "its file name, as the helper named it (display-746-1794124886020.png)" } },
    run: async (p, ctx) => {
      const name = str(p.name)
      if (!/^(?:window|display|close)-\d+-\d+\.png$/.test(name)) throw new OpError(`'${name}' isn't a picture of the screen's name (display-<n>-<n>.png)`)
      if (!ctx.input) throw new OpError("send the picture's bytes as the request's body")
      const chunks: Buffer[] = []
      let n = 0
      for await (const c of ctx.input) { n += c.length; if (n > PICTURE_MAX) throw new OpError("the picture is too large", 413); chunks.push(c) }
      const bytes = Buffer.concat(chunks)
      if (!bytes.subarray(0, 8).equals(PNG)) throw new OpError("that isn't a PNG")
      const dir = path.join(plugin.localDir(), "screens")
      fs.mkdirSync(dir, { recursive: true })
      for (const f of fs.readdirSync(dir)) { try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 86_400_000) fs.rmSync(path.join(dir, f)) } catch { /* gone */ } }
      fs.writeFileSync(path.join(dir, name), bytes)
      return { path: path.join(dir, name) }
    },
  })

  /** Jobs the user opened: no longer news. */
  function seen(ids: string[]) {
    let any = false
    for (const j of all()) if (ids.includes(j.id) && !j.seen) { j.seen = true; any = true }
    if (any) changed()
  }

  return {
    list: all, cards, seen, jobsAgent, begin,
    /** Job `id`, or the one its id ends with (3 letters or more); 404 when none. */
    find: jobOf,
    /** Job `id` told `text`, typed into its terminal (its conversation resumed if it closed); its card shows `shown`. */
    tell: (ctx: OpCtx, id: string, text: string, shown?: string, by?: string) => steer(ctx, jobOf(id), text, shown, by),
    /** Job `id`'s worker in a new conversation, told `text` first; its old terminal ended. */
    fresh: (ctx: OpCtx, id: string, text: string, shown?: string, by?: string) => fresh(ctx, jobOf(id), text, shown, by),
    /** How full job `j`'s worker's context is now, null when its agent doesn't say or its terminal is gone. */
    context: async (j: Job) => (await links.of(j.where).seen(j.terminal, { context: true, ...(j.session ? { session: j.session } : {}) }).catch(() => null))?.context ?? null,
    /** They kept job `id`'s change: its worker told to merge it, the job closed once it says it merged. */
    land: (ctx: OpCtx, id: string) => land(ctx, jobOf(id), "", undefined, "you, by Keep and merge"),
    /** Job `id` ready for review looked for on main now (its proof's choice is about to ask): done when it landed. */
    shipped: async (id: string) => {
      const j = jobOf(id)
      if (j.state !== "ready for review" || !j.where.repo || !(await shippedSince(j))) return false
      changed()
      return true
    },
    /** Job `id` closed by the user (done when ready for review). */
    close: (ctx: OpCtx, id: string) => close(ctx, jobOf(id)),
    /** Why ask `m` may mean another job than `id` (its pane another job's terminal), "" when it can't. */
    unsure: (id: string, m: Moment | undefined, which = "") => unsure(jobOf(id), m, which),
    /** Where an ask over `o` would run here (its folder, repo, the preview it's on). */
    placeHere: (o: Over) => placeHere(o, "", "", false),
    line: () => jobsLine(all()),
    /** Op `id` run on another machine (a job's: where its worker's files are). */
    atMachine,
    /** Its card and its news told again (live editing moved it). */
    changed,
    /** How fast the day's jobs got going, for companion timings. */
    timings: (day: string, dayOf: (t: number) => string) => jobTimings(all().filter((j) => dayOf(j.started) === day)),
  }
}
