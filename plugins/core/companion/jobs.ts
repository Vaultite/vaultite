// Jobs: long work the companion hands to a worker in one of the app's terminals. One lifecycle (JOB_NEXT) everywhere:
// menu bar, `companion jobs`, the summoned session, ops; each move logged. Plain functions: workers.ts runs them.
import type { Moment } from "./plugin.ts"

export const JOB_STATES = ["starting", "working", "needs you", "ready for review", "done", "failed", "stopped"] as const
export type JobState = typeof JOB_STATES[number]
/** What moves a job: its worker as read (working, asks the user, error), its turn's end (changed: with changes to
 *  review; answered: none), its terminal's end, the user's steer (told) and stop. */
export type JobEvent = "working" | "asks" | "changed" | "answered" | "error" | "ended" | "told" | "stop"

/** The lifecycle: from each state, where each event goes; an event not listed changes nothing. */
export const JOB_NEXT: Record<JobState, Partial<Record<JobEvent, JobState>>> = {
  starting: { working: "working", asks: "needs you", changed: "ready for review", answered: "done", error: "failed", ended: "failed", stop: "stopped" },
  working: { asks: "needs you", changed: "ready for review", answered: "done", error: "failed", ended: "failed", stop: "stopped" },
  "needs you": { working: "working", told: "working", changed: "ready for review", answered: "done", error: "failed", ended: "failed", stop: "stopped" },
  // (reviewed: closing it, or its terminal ending, is done; a steer or the user typing in it goes on)
  "ready for review": { working: "working", told: "working", asks: "needs you", ended: "done", stop: "done" },
  done: { working: "working", told: "working", asks: "needs you" },
  failed: { working: "working", told: "working" },
  stopped: {},
}
/** States the user hears about, a badge until they open the job. */
const NEWS = new Set<JobState>(["needs you", "ready for review", "done", "failed"])
export const live = (s: JobState) => s === "starting" || s === "working" || s === "needs you"

/** Where a job runs: the machine ("" this one) and its label, the folder and its repo, the account, the harness
 *  (agent id, its name, model, effort), why it went there, the commit a review's diff counts from, the preview asked over. */
export type Where = { machine: string; label: string; cwd: string; repo: string; agent: string; account: string; harness: string; model: string; effort: string
  why: string; base?: string; preview?: string }
/** What a turn ended with: its last message, the files it changed, the diff since `base` (one line), a PR, a link to try. */
export type Result = { text?: string; files?: string[]; diff?: string; pr?: string; link?: string }
export type Transition = { t: number; ev: JobEvent; from: JobState; to: JobState }
export type Job = {
  id: string; title: string; state: JobState; where: Where
  /** Its worker's terminal id, on where.machine. */
  terminal: string
  /** What it's doing now, one line (its agent's status, its terminal's title, what it asks). */
  now: string
  /** When: the ask it came from, its card up (the handoff answered), its worker's first step, its turn began, its last change. */
  asked?: number; started: number; carded?: number; stepped?: number; turn: number; at: number
  result?: Result
  /** Opened since its last news. */
  seen: boolean
  log: Transition[]
}

/** Job `j` after event `ev` (at `t`): the move, logged with it, or null when it doesn't move. */
/** What its voice says when job `j` moves to news (needs you, ready for review, done, failed), else "". */
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

export const unseen = (j: Job) => NEWS.has(j.state) && !j.seen
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
/** Its results in one line: the diff, a PR, a link. */
export const resultLine = (r?: Result) => (r ? [r.diff, r.pr, r.link].filter(Boolean).join(" · ") : "")

/** A job as the menu bar and the app list it. */
export type JobCard = { id: string; title: string; state: JobState; link: string; unseen: boolean; at: number; started: number; ended?: number; where: string; now: string; took: string; result: string }
export const cardOf = (j: Job, now = Date.now()): JobCard => ({ id: j.id, title: j.title, state: j.state, link: linkOf(j), unseen: unseen(j), at: j.at, started: j.started,
  ...(live(j.state) ? {} : { ended: j.at }), where: whereLine(j.where), now: j.now, took: took(j, now),
  result: resultLine(j.result) || cut((j.result?.text ?? "").replace(/\s+/g, " ").trim(), 200) })

/** A PR and a link to try, from a worker's last message (else the preview it was asked over). */
export function linksIn(text: string, preview?: string): Pick<Result, "pr" | "link"> {
  const pr = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(text)?.[0]
  const link = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|[\w-]+(?:\.[\w-]+)*\.ts\.net)(?::\d+)?(?:\/[^\s)>"'`]*)?/.exec(text)?.[0] ?? preview
  return { ...(pr ? { pr } : {}), ...(link ? { link: link.replace(/[.,;:]+$/, "") } : {}) }
}

/** What a worker is told: the task, the ask it came from (its words, where, what was under the pointer, the screen's
 *  picture then), and how to end: changes are the user's to review, nothing outward without their word. */
export function jobTask(task: string, m: Moment | undefined, coding: boolean) {
  const where = !m ? "" : m.app ? `on their screen, in ${m.title ? `"${m.title}" (${m.app})` : m.app}` : m.path ? `in their note ${m.path}${m.line ? `, line ${m.line}` : ""}`
    : m.pane || m.ui ? `in Vaultite, ${m.title ? `"${m.title}"` : m.pane ?? m.ui}${m.url ? ` (${m.url})` : ""}` : ""
  const asked = m ? [
    m.text ? `They said: ${JSON.stringify(cut(m.text, 2000))}` : "",
    where ? `Where: ${where}` : "",
    m.url && !m.pane ? `The page: ${m.url}` : "",
    m.selection ? `Their selection: ${JSON.stringify(cut(m.selection, 2000))}` : "",
    m.under ? `Under their pointer: ${cut(m.under, 600)}` : "",
    m.shot ? `Their screen then (a picture): ${m.shot}` : "",
  ].filter(Boolean) : []
  return [task.trim(), asked.length ? `The user asked for this through their companion in Vaultite:\n${asked.join("\n")}` : "",
    `You're a job they handed off, in a terminal of Vaultite they can open and type in. ${coding ? "Change the code freely, but don't push, merge, deploy, publish, post or message anyone unless they say so: it ends in their review. End" : "End"} with a few lines: what you found or did, the files you changed, and how to try it (a preview's link if there is one).`]
    .filter(Boolean).join("\n\n")
}

/** One job as an agent reads it: its state, where, how long, what it does now, its results, its last message. */
export function jobText(j: Job, now = Date.now()) {
  const r = j.result
  return [`${j.id} · ${j.state}${unseen(j) ? " (new)" : ""} · "${j.title}" · ${whereLine(j.where)} · ${took(j, now)}`,
    j.now ? `now: ${j.now}` : "", resultLine(r) ? `results: ${resultLine(r)}` : "", r?.files?.length ? `files: ${r.files.slice(0, 12).join(", ")}` : "",
    r?.text && !live(j.state) ? `it said: ${cut(r.text.trim(), 1500)}` : "", `open it: vau open ${linkOf(j)}`].filter(Boolean).join("\n")
}

/** Jobs as an agent lists them (newest first). */
export function jobsText(jobs: Job[], now = Date.now()) {
  if (!jobs.length) return "No jobs: companion handoff starts one."
  return jobs.map((j) => `- ${j.id} · ${j.state}${unseen(j) ? " (new)" : ""} · ${j.title} · ${whereLine(j.where)} · ${took(j, now)}` +
    (j.now && live(j.state) ? `\n  now: ${cut(j.now, 120)}` : "") + (resultLine(j.result) ? `\n  ${resultLine(j.result)}` : "") +
    (j.result?.text && !live(j.state) ? `\n  ${cut(j.result.text.replace(/\s+/g, " "), 200)}` : "")).join("\n")
}

/** The recent jobs a summoned ask is told of, so it can steer one, stop it, or say how it's going. */
export function jobsLine(jobs: Job[], now = Date.now()) {
  const recent = jobs.filter((j) => live(j.state) || (now - j.at < 6 * 3600_000 && j.state !== "stopped")).slice(0, 4)
  return recent.length ? `Your jobs (to tell one more or correct it: handoff with its job; to stop one: job-stop; how one goes: job): ${recent.map((j) =>
    `${j.id} "${cut(j.title, 60)}" (${j.state}${j.now && live(j.state) ? `: ${cut(j.now, 60)}` : ""}; ${whereLine(j.where)}; ${took(j, now)})`).join(", ")}.` : ""
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
