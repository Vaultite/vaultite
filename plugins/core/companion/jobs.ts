// Jobs: long work the companion hands to a worker in one of the app's terminals. One lifecycle (JOB_NEXT) everywhere:
// menu bar, `companion jobs`, the summoned session, ops; each move logged. Plain functions: workers.ts runs them.
import { parseTerminal, resumeTerminalId } from "../../../core/terminalids.ts"
import type { Moment } from "./plugin.ts"

export const JOB_STATES = ["starting", "working", "needs you", "ready for review", "done", "failed", "stopped"] as const
export type JobState = typeof JOB_STATES[number]
/** What moves a job: its worker as read (working, asks, error), its turn's end (changed: to review; answered: none;
 *  landed: what they kept, merged), its terminal's end with nothing to show (endEvent), their steer (told) and stop. */
export type JobEvent = "working" | "asks" | "changed" | "answered" | "landed" | "error" | "ended" | "told" | "stop"

/** The lifecycle: from each state, where each event goes; an event not listed changes nothing. */
export const JOB_NEXT: Record<JobState, Partial<Record<JobEvent, JobState>>> = {
  starting: { working: "working", asks: "needs you", changed: "ready for review", answered: "done", landed: "done", error: "failed", ended: "failed", stop: "stopped" },
  working: { asks: "needs you", changed: "ready for review", answered: "done", landed: "done", error: "failed", ended: "failed", stop: "stopped" },
  "needs you": { working: "working", told: "working", changed: "ready for review", answered: "done", landed: "done", error: "failed", ended: "failed", stop: "stopped" },
  // (reviewed: closing it, or its terminal ending, is done; a steer or the user typing in it goes on)
  "ready for review": { working: "working", told: "working", asks: "needs you", ended: "done", stop: "done" },
  done: { working: "working", told: "working", asks: "needs you" },
  failed: { working: "working", told: "working" },
  stopped: {},
}
/** States the user hears about, a badge until they open the job. */
const NEWS = new Set<JobState>(["needs you", "ready for review", "done", "failed"])
export const live = (s: JobState) => s === "starting" || s === "working" || s === "needs you"
/** Whether job `j` has a change of its own to merge (a repo's diff or files, not yet merged; one closed unmerged too):
 *  Keep then lands it. */
export const landable = (j: Pick<Job, "state" | "where" | "result" | "land">) =>
  (j.state === "ready for review" || j.state === "done") && !!j.where.repo && !!(j.result?.diff || j.result?.files?.length) && !j.land?.merged
/** What its worker is told when they keep its change: land it from its worktree as its repo says (never merging in the
 *  checkout it was asked over), clean that up, then say how it went in its first word. One line: it's typed in. */
export function landTask(w: Pick<Where, "cwd" | "tree" | "branch" | "live">) {
  const rules = "as this repo's own rules say (its CLAUDE.md, AGENTS.md or CONTRIBUTING: the checks to run first, how a branch lands, and whether to push or deploy; a step those rules keep for the user still waits for them)"
  const end = "Start your last message with \"Merged:\" and where it landed, in a line, or with \"Not merged:\" and why."
  if (!w.tree) return `They watched your change and kept it: merge it now, ${rules}. ${end}`
  return `They watched your change and kept it: merge it now, from your worktree ${w.tree} (branch ${w.branch}), ${rules}. Never switch or edit ${w.cwd}${w.live ? " (the running server's own checkout: nothing lands there)" : ""}: with a remote, rebase onto its main, squash it to one commit and git push origin HEAD:main (or its PR, when the rules land by one)${w.live ? " (the server takes main itself)" : ""}; with none, ${w.live ? "don't merge" : "squash-merge it into that checkout only if it's clean"}. Then git -C ${w.cwd} worktree remove ${w.tree}, and branch -D ${w.branch}. ${end}`
}
/** Whether a worker's last message says it merged what they kept (true), says it didn't (false), or neither (null). */
export function mergedSaid(text: string): boolean | null {
  const t = text.replace(/^[\s*_#>`]+/, "").toLowerCase()
  if (/^(?:not merged|couldn'?t merge|didn'?t merge|can'?t merge)\b/.test(t)) return false
  return /^merged\b/.test(t) ? true : null
}
/** A job's terminal as every machine's list names it (`<id>@<machine>` when it runs on another). */
export const terminalOf = (j: Pick<Job, "terminal" | "where">) => `${j.terminal}${j.where.machine ? `@${j.where.machine}` : ""}`

/** Where a job runs: the machine ("" this one) and its label, the folder and its repo, the account, the harness
 *  (agent id, its name, model, effort), why it went there, the commit a review's diff counts from, the preview asked over. */
export type Where = { machine: string; label: string; cwd: string; repo: string; agent: string; account: string; harness: string; model: string; effort: string
  why: string; base?: string; preview?: string
  /** What the user watched on the machine it left (a preview, an editor's project): it previews on its own machine. */
  moved?: string
  /** A coding job's own git worktree and branch (worktreeOf), beside its checkout `cwd`, which it never edits; `live`:
   *  that checkout is the running server's own. */
  tree?: string; branch?: string; live?: boolean }
/** What a turn ended with: its last message, the files it changed, the diff since `base` (one line), a PR, a link to try. */
export type Result = { text?: string; files?: string[]; diff?: string; pr?: string; link?: string }
export type Transition = { t: number; ev: JobEvent; from: JobState; to: JobState }
/** Its worker's latest turn as last read: what it said last and when, what it was told last (a follow-up, the user's
 *  or the companion's), the questions it asks, its background tasks still running. */
export type Last = { text: string; at: number; told?: string; asks?: string[]; background?: number }
/** What its worker waits on, answerable where the user is (its notification's buttons, their word to the companion): the
 *  prompt's question and its choices (a permission's: approve's, then deny's; none: it takes more, in its terminal), since when. */
export type Waits = { kind: "permission" | "question"; question: string; choices: string[]; at: number }
export type Job = {
  id: string; title: string; state: JobState; where: Where
  /** Its worker's terminal id, on where.machine. */
  terminal: string
  /** Its worker's session (its transcript, read after its terminal ends), when that end was read, and when its terminal
   *  was closed for being done (its conversation resumes from its card). */
  session?: string; exited?: number; closed?: number
  /** The user typed in its terminal: theirs now, never closed by itself. */
  held?: boolean
  /** What the ask it came from was over (surfaceOf): asks there later go straight to it (liveedit.ts). */
  on?: string
  last?: Last
  waits?: Waits
  /** What it's doing now, one line (its agent's status, its terminal's title, what it asks). */
  now: string
  /** When: the ask it came from, its card up (the handoff answered), its worker's first step, its turn began, its last change. */
  asked?: number; started: number; carded?: number; stepped?: number; turn: number; at: number
  result?: Result
  /** Kept, to be merged (Keep and merge, or their word to land it): when they said so, and once its turn ended, whether
   *  it said it merged (its last message starting "Merged:"). It closes as done only once merged. */
  land?: { asked: number; at?: number; merged?: boolean }
  /** Opened since its last news. */
  seen: boolean
  log: Transition[]
}

/** Whether a job now `state` is a notification (job_news): needing them or failed (one ready knocks: proofs.ts). */
export const jobTold = (state: string, news: unknown) => news !== "off" && (state === "needs you" || state === "failed")
/** What its voice says when job `j` moves to news (needs you, failed; ready and done knock instead), else "". */
export function jobSpoken(j: Pick<Job, "title" | "state">, from: string) {
  if (from === j.state) return ""
  // (its first words, not ending on "on the": said aloud, it reads as cut)
  const words = j.title.replace(/\s+/g, " ").trim().split(" ").slice(0, 6)
  while (words.length > 1 && /^(the|a|an|on|of|to|in|for|and|with|at|by)$/i.test(words.at(-1)!)) words.pop()
  const what = words.join(" ").replace(/[.:,;]+$/, "")
  const job = what ? `The job "${what}"` : "A job"
  return j.state === "needs you" ? `${job} needs you.` : j.state === "ready for review" ? `${job} is ready for review.`
    : j.state === "done" && from !== "ready for review" ? `${job} is done.` : j.state === "failed" ? `${job} failed.` : ""
}

/** Job `j` after event `ev` (at `t`): the move, logged with it, or null when it doesn't move. */
export function step(j: Job, ev: JobEvent, t = Date.now()): Transition | null {
  const to = JOB_NEXT[j.state][ev]
  if (!to || to === j.state) return null
  const x = { t, ev, from: j.state, to }
  j.log.push(x)
  if (j.log.length > 40) j.log.splice(0, j.log.length - 40)
  Object.assign(j, { state: to, at: t }, NEWS.has(to) ? { seen: false } : {})
  if (to === "working" && ev === "told") j.turn = t
  return x
}

/** How a worker's terminal ending moves its job, by what it left: an answer in its turn since the job's began (`final`:
 *  that turn over), changes to review, and whether it crashed (lost, killed, an error code) rather than was ended. */
export function endEvent(o: { text: boolean; final: boolean; changes: boolean; crashed: boolean }): JobEvent {
  // (a worker closing itself, as one that ships all the way does, ends mid-turn: on purpose, so what it left stands)
  return (o.text || o.changes) && (o.final || !o.crashed) ? (o.changes ? "changed" : "answered") : "ended"
}

export const unseen = (j: Job) => NEWS.has(j.state) && !j.seen
/** The terminal that resumes job `j`'s conversation (its session in its account), or "" without one. */
export function resumeOf(j: Pick<Job, "session" | "where">) {
  const [name, profile] = j.where.agent.split("_")
  return j.session && parseTerminal(`${j.where.agent}-x`) ? resumeTerminalId(name, j.session, profile) : ""
}
export const linkOf = (j: Pick<Job, "terminal" | "where">) => `view:terminal/${j.terminal}${j.where.machine ? `@${j.where.machine}` : ""}`
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p
/** Where, in a few words: "M4, personal-website, Personal, Claude Code". */
export const whereLine = (w: Where) => [w.label, w.repo || base(w.cwd), w.account, w.harness].filter(Boolean).join(", ")
/** How long it ran (or has run), short: "40 s", "12 min", "2.5 h". */
export function took(j: Job, now = Date.now()) {
  const s = Math.max(0, ((live(j.state) ? now : j.at) - j.started) / 1000)
  return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`
}
/** How long ago, short: "just now", "4 min ago", "2.5 h ago". */
const ago = (t: number, now = Date.now()) => { const s = (now - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago` }
const plain = (s: string) => s.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim()
/** A message's first words: its first sentence, else its first paragraph cut to `n`. */
export function gist(text: string, n = 140) {
  const para = plain(text.trim().split(/\n\s*\n/)[0] ?? "")
  const first = /^.{12,}?[.!?](?=\s|$)/.exec(para)?.[0] ?? para
  return cut(first, n)
}
/** The questions a message ends by asking (its last paragraphs' sentences ending in "?", quotes left out), the last three. */
export const questionsIn = (text: string) => text.trim().split(/\n\s*\n/).slice(-2).join("\n").replace(/"[^"\n]*"|“[^”\n]*”/g, "\"\"").split("\n")
  .flatMap((l) => plain(l).match(/[^.!?]*[A-Za-z][^.!?]*\?/g) ?? []).map((q) => cut(q.trim(), 200)).filter((q) => q.split(" ").length >= 3).slice(-3)
/** The marker of a worker's first message (jobTask's): what it's told after is a follow-up. */
const HANDED = "You're a job they handed off"
/** Its worker's latest turn as read (`asks`: the questions it waits on, else those its last answer ends with). */
export function lastOf(t: { text: string; at: number; final?: boolean; prompt?: string; background?: number }, asks?: string[]): Last {
  const told = t.prompt && !t.prompt.includes(HANDED) ? cut(plain(t.prompt), 300) : ""
  const q = asks?.length ? asks : t.final ? questionsIn(t.text) : []
  return { text: t.text.slice(0, 4000), at: t.at, ...(told ? { told } : {}), ...(q.length ? { asks: q } : {}), ...(t.background ? { background: t.background } : {}) }
}
/** What its worker does now, one line: what it waits on, else what it said last in this turn, else what it's told. */
export function nowOf(j: Pick<Job, "title" | "turn" | "last" | "now">, s: { kind?: string; msg?: string; title?: string }) {
  if (s.kind) return `waits on ${s.kind === "permission" ? "a permission" : s.kind === "question" ? "an answer" : s.kind}${s.msg ? `: ${s.msg}` : ""}`
  if (j.last?.text && j.last.at >= j.turn - 1000) return gist(j.last.text)
  const title = (s.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim()
  return s.msg || (title && title !== j.title ? title : "") || j.now
}

/** Its results in one line: the diff, a PR, a link. */
export const resultLine = (r?: Result) => (r ? [r.diff, r.pr, r.link].filter(Boolean).join(" · ") : "")
/** What it said last: its latest words read, else its result's. */
const saidOf = (j: Job) => (j.last?.text ? j.last : j.result?.text ? { text: j.result.text, at: j.at } : null)

/** A job as the menu bar and the app list it (`waits`: what it waits on, while it needs the user). */
export type JobCard = { id: string; title: string; state: JobState; link: string; unseen: boolean; at: number; started: number; ended?: number; where: string; now: string; took: string; result: string
  waits?: { question: string; choices: string[] } }
export const cardOf = (j: Job, now = Date.now()): JobCard => ({ id: j.id, title: j.title, state: j.state, link: linkOf(j), unseen: unseen(j), at: j.at, started: j.started,
  ...(live(j.state) ? {} : { ended: j.at }), ...(j.state === "needs you" && j.waits ? { waits: { question: j.waits.question, choices: j.waits.choices } } : {}),
  where: whereLine(j.where), now: j.now, took: took(j, now),
  result: resultLine(j.result) || cut((j.result?.text ?? "").replace(/\s+/g, " ").trim(), 200) })

const YES = /^(yes|y|yeah|yep|approve|allow|ok|okay|trust|accept|sure)$/i, NO = /^(no|n|nope|deny|reject|refuse|exit|disable|don't|cancel)$/i
/** Which of `w`'s choices `given` names (from 1): its number, its words (or the start of them, one only), or a
 *  permission's yes or no; 0 when none. */
export function choiceIn(w: Pick<Waits, "kind" | "choices">, given: string) {
  const said = given.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ").toLowerCase(), names = w.choices.map((c) => c.toLowerCase().replace(/\s*\(recommended\)$/, ""))
  if (/^\d+$/.test(said)) return Number(said) >= 1 && Number(said) <= w.choices.length ? Number(said) : 0
  const exact = names.indexOf(said), starts = names.flatMap((n, i) => (said && n.startsWith(said) ? [i] : []))
  if (exact >= 0) return exact + 1
  if (starts.length === 1) return starts[0] + 1
  return w.kind === "permission" && w.choices.length === 2 ? (YES.test(said) ? 1 : NO.test(said) ? 2 : 0) : 0
}
/** What job `j` waits on, a line: its question, then its choices numbered. */
export const waitsLine = (w: Waits) => `"${cut(w.question, 160)}"${w.choices.length ? ` (${w.choices.map((c, i) => `${i + 1}. ${cut(c, 60)}`).join(" | ")})` : " (in its terminal only)"}`

/** A PR and a link to try, from a worker's last message (else the preview it was asked over). */
export function linksIn(text: string, preview?: string): Pick<Result, "pr" | "link"> {
  const pr = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(text)?.[0]
  const link = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|[\w-]+(?:\.[\w-]+)*\.ts\.net)(?::\d+)?(?:\/[^\s)>"'`]*)?/.exec(text)?.[0] ?? preview
  return { ...(pr ? { pr } : {}), ...(link ? { link: link.replace(/[.,;:]+$/, "") } : {}) }
}

/** What the user asked over `m`, for a worker: their words (dictated or not), where, their selection and screen. */
function askLines(m: Moment | undefined) {
  const named = !!m?.appName && m.appName !== m.app
  const where = !m ? "" : m.app ? `on their screen, in ${m.title ? `"${m.title}" (${named ? `${m.appName}, ` : ""}${m.app})` : named ? `${m.appName} (${m.app})` : m.app}` : m.path ? `in their note ${m.path}${m.line ? `, line ${m.line}` : ""}`
    : m.pane || m.ui ? `in Vaultite, ${m.title ? `"${m.title}"` : m.pane ?? m.ui}${m.url ? ` (${m.url})` : ""}` : ""
  const asked = m ? [
    // (dictated: the task above is what they meant, when a slip reads otherwise)
    m.text ? `They ${m.voice ? "said (dictated, so it may hold slips: go by the task)" : "said"}: ${JSON.stringify(cut(m.text, 2000))}` : "",
    where ? `Where: ${where}` : "",
    m.url && !m.pane ? `The page: ${m.url}` : "",
    m.selection ? `Their selection: ${JSON.stringify(cut(m.selection, 2000))}` : "",
    m.under ? `Under their pointer: ${cut(m.under, 600)}` : "",
    m.shot ? `Their screen then (a picture): ${m.shot}` : "",
  ].filter(Boolean) : []
  return asked
}
/** The worktree and branch job `id` works in, beside checkout `cwd` of `repo`: "~/Projects/site" → "~/Projects/site-<id>". */
export function worktreeOf(cwd: string, repo: string, id: string) {
  const parent = cwd.replace(/\/+$/, "").replace(/\/[^/]+$/, "") || "/"
  return { tree: `${parent === "/" ? "" : parent}/${repo || "repo"}-${id}`, branch: `job-${id}` }
}
/** How a coding job keeps off its checkout: its own worktree, made from the commit it was asked at, its packages
 *  installed there before checks; `moved`: it runs on another machine than the one they asked over. */
function worktreeLine(w: Pick<Where, "cwd" | "base" | "tree" | "branch" | "live" | "label" | "moved">) {
  const at = w.base ? ` ${w.base.slice(0, 12)}` : ""
  return [`Work in your own git worktree, never in ${w.cwd} itself: leave its working tree and branch as they are (${w.live ? "it's the running server's own checkout" : "it may be a live server's, or theirs mid-work"}). Before your first edit, make it: git -C ${w.cwd} worktree add ${w.tree} -b ${w.branch}${at}${w.moved ? " (fetch that commit first if need be)" : ""}; then edit, build, test and commit only there (absolute paths, or cd ${w.tree} && … in each command). It has none of the checkout's installed packages: before checks, install them there (npm ci, or as the repo's rules say; a symlink to the checkout's node_modules is fine until you add or change a package, then a real install in the worktree, never into the checkout's). Changing nothing (research, an answer): no worktree.`,
    w.moved ? `They asked over ${w.moved}. You run on ${w.label} instead, from its checkout of that repo: try your change in ${w.label}'s own preview (its dev server or Tailscale Serve), not theirs. In your result, give its link and say it's on ${w.label}.` : ""].filter(Boolean).join(" ")
}
/** How a worker shows its change working (its proof), when the change shows on screen: what Show me plays. */
export function proofTask(id: string) {
  return `If your change shows on screen, show it working rather than say so: before you end, save a short tour of it (what Show me plays for them when you're ready): vau companion tour-save "<the change in a few words, as a noun: the blue save button>" --job ${id} --text '<steps>'. A step is a numbered line: one short sentence said aloud, with a tag on the thing as their screen shows it, by its words there ([ring "Save"], [point "Jobs"], [frame "Settings"]); two to four steps. Add (before: <a png>) to a step to flip a picture of that thing before your change over it as it is now: take it before you change anything (a headless screenshot of just that element, or vau screen shot cropped to it with sips), of the thing alone. It plays on Vaultite's own window (its UI, a note: --open the note or page it's on, when that's where it shows) and finds things by their words, so name what shows once your change is there; the Mac's own UI outside that window (the menu bar's menus, the notch, notifications) it can't find, so say in a step's words what to open to see it. Nothing to show on screen (research, a backend change): skip it.`
}
/** What a worker is told: the task, the ask it came from (its words, where, under the pointer, the screen), where to
 *  work (a coding job: its own worktree), how to end (theirs to review, nothing outward unasked), and its proof. */
export function jobTask(task: string, m: Moment | undefined, w?: Pick<Where, "cwd" | "repo" | "base" | "tree" | "branch" | "live" | "label" | "moved">, id?: string) {
  const asked = askLines(m), coding = !!w?.repo
  return [task.trim(), asked.length ? `The user asked for this through their companion in Vaultite:\n${asked.join("\n")}` : "",
    coding && w.tree ? worktreeLine(w) : "",
    `You're a job they handed off, in a terminal of Vaultite they can open and type in. ${coding ? "Change the code freely, but don't push, merge, deploy, publish, post or message anyone unless they say so: it ends in their review (their Keep and merge lands it). End" : "End"} with a few lines: what you found or did, the files you changed, and how to try it (a preview's link if there is one).`,
    id ? proofTask(id) : ""]
    .filter(Boolean).join("\n\n")
}

/** A follow-up typed into a job, one line: the companion's note, then the user's own words and screen (none lost retold). */
export function followTask(task: string, m: Moment | undefined) {
  const asked = askLines(m)
  return [task.trim(), asked.length ? `(The user, through their companion: ${asked.join(" · ")})` : ""].filter(Boolean).join(" ")
}

/** One job as an agent reads it: its state, where, how long, what it does now, what it was told and said last, the
 *  questions it asks, its results. */
export function jobText(j: Job, now = Date.now()) {
  const r = j.result, l = j.last, said = saidOf(j)
  return [`${j.id} · ${j.state}${unseen(j) ? " (new)" : ""} · "${j.title}" · ${whereLine(j.where)} · ${took(j, now)}`,
    live(j.state) && j.now && !(said && j.now === gist(said.text)) ? `now: ${j.now}` : "",
    j.state === "needs you" && j.waits ? `waits on: ${waitsLine(j.waits)}${j.waits.choices.length ? ": companion job-answer with the user's choice, only on their words" : ""}` : "",
    l?.background ? `in the background: ${l.background} task${l.background > 1 ? "s" : ""} of its still running (a command, a subagent)` : "",
    l?.told ? `told last: ${l.told}` : "",
    said ? `it said (${ago(said.at, now)}): ${cut(said.text.trim(), 1500)}` : "", l?.asks?.length ? `asks: ${l.asks.join(" | ")}` : "",
    j.where.tree ? `its worktree: ${j.where.tree} (branch ${j.where.branch}), beside ${j.where.cwd}` : "",
    resultLine(r) ? `results: ${resultLine(r)}` : "", r?.files?.length ? `files: ${r.files.slice(0, 12).join(", ")}` : "",
    j.land ? (j.land.at === undefined ? "kept: told to merge it, merging now" : j.land.merged ? "kept and merged" : "kept, but it didn't say it merged: see what it said") : "",
    j.closed ? "its terminal closed once it was done: a follow-up (handoff --job) or opening it resumes its conversation" : "",
    `open it: vau companion job-open ${j.id}`].filter(Boolean).join("\n")
}

/** Jobs as an agent lists them (newest first). */
export function jobsText(jobs: Job[], now = Date.now()) {
  if (!jobs.length) return "No jobs: companion handoff starts one."
  return jobs.map((j) => `- ${j.id} · ${j.state}${unseen(j) ? " (new)" : ""} · ${j.title} · ${whereLine(j.where)} · ${took(j, now)}` +
    (j.now && live(j.state) ? `\n  now: ${cut(j.now, 120)}` : "") + (j.state === "needs you" && j.waits ? `\n  waits on: ${waitsLine(j.waits)}` : "") + (j.last?.asks?.length ? `\n  asks: ${cut(j.last.asks.join(" | "), 200)}` : "") +
    (resultLine(j.result) ? `\n  ${resultLine(j.result)}` : "") +
    (j.result?.text && !live(j.state) ? `\n  ${cut(j.result.text.replace(/\s+/g, " "), 200)}` : "")).join("\n")
}

/** The recent jobs a summoned ask is told of, so it can steer one, stop it, or say how it's going. */
export function jobsLine(jobs: Job[], now = Date.now()) {
  const recent = jobs.filter((j) => live(j.state) || (now - j.at < 6 * 3600_000 && j.state !== "stopped")).slice(0, 4)
  return recent.length ? `Your jobs (to tell one more or correct it, and anything about one's result (merge it, try X too): handoff with its job, land for their word to merge it; to stop one: job-stop; how one goes: job; to show them one that's ready, on their screen: job-show; what one waits on, with the choice their words name: job-answer): ${recent.map((j) =>
    `${j.id} "${cut(j.title, 60)}" (${j.state}${j.state === "needs you" && j.waits ? `: waits on ${waitsLine(j.waits)}` : j.now && live(j.state) ? `: ${cut(j.now.replace(/\.$/, ""), 80)}` : ""}${j.last?.asks?.length && !j.waits ? `; asks: ${cut(j.last.asks[0], 80)}` : ""}; ${whereLine(j.where)}; ${took(j, now)})`).join(", ")}.` : ""
}

/** How fast jobs got going (ms): from the ask to their card, and to their worker's first step. */
export function jobTimings(jobs: Job[]) {
  const from = (j: Job) => j.asked ?? j.started
  return jobs.flatMap((j) => (j.carded ? [{ t: j.started, title: j.title, card: j.carded - from(j), ...(j.stepped ? { step: j.stepped - from(j) } : {}) }] : []))
}

/** Jobs' timings as a table, then the median and p90 of each (seconds). */
export function jobTimingsText(rows: ReturnType<typeof jobTimings>) {
  if (!rows.length) return ""
  const s = (ms?: number) => (ms === undefined ? "-" : (ms / 1000).toFixed(1)).padStart(7)
  const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(q * xs.length) - 1)]
  const sum = (k: "card" | "step") => { const xs = rows.flatMap((r) => r[k] ?? []); return `${k} ${xs.length ? `${s(pct(xs, 0.5)).trim()}/${s(pct(xs, 0.9)).trim()}` : "-"}` }
  return [`Jobs, in seconds from the ask: card (its job card up), step (its worker's first step).`, `${"time".padEnd(8)} ${"card".padStart(7)} ${"step".padStart(7)}  job`,
    ...rows.map((r) => `${new Date(r.t).toTimeString().slice(0, 8)} ${s(r.card)} ${s(r.step)}  ${cut(r.title, 60)}`), `jobs (${rows.length}): ${sum("card")}, ${sum("step")} (median/p90, s)`].join("\n")
}
