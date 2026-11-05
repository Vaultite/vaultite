// Jobs: long work the companion hands off to a background agent (delegate's tasks, started for the user), listed in
// the menu bar with a badge and a notification when one ends. Plain functions; plugin.ts has the ops.
import type { Moment } from "./plugin.ts"

/** A job as the menu bar and `companion jobs` show it. */
export type Job = { id: string; title: string; agent: string; state: "running" | "needs you" | "done" | "failed" | "cancelled"; link: string | null
  /** Ended and not opened yet: the menu bar's badge counts these. */
  unseen: boolean; at: number; result?: string }

/** A delegate task's view as a job. */
export function jobOf(v: Record<string, unknown>): Job {
  const st = String(v.state), state = st === "working" ? "running" : st === "waiting" ? "needs you" : st === "done" ? "done" : st === "error" ? "failed" : "cancelled"
  const result = typeof v.result === "string" ? v.result : typeof v.error === "string" ? v.error : ""
  return { id: String(v.id), title: String(v.title ?? ""), agent: String(v.agent ?? ""), state, link: typeof v.link === "string" ? v.link : null,
    unseen: (state === "done" || state === "failed") && v.seen !== true, at: Number(v.at) || 0, ...(result ? { result: result.slice(0, 600) } : {}) }
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** What the background agent is told: the task, then the ask it came from (its words, where, what was under the pointer,
 *  the screen's picture then), and how to end. */
export function jobTask(task: string, m: Moment | undefined) {
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
    "You run in the background: they'll read your last message when they open this job, so end with what you found or did, in a few lines (and the files you changed)."]
    .filter(Boolean).join("\n\n")
}

/** Jobs as an agent reads them (newest first). */
export function jobsText(jobs: Job[]) {
  if (!jobs.length) return "No jobs: companion handoff starts one."
  return jobs.map((j) => `- ${j.id} · ${j.state}${j.unseen ? " (new)" : ""} · ${j.title}${j.result && j.state !== "running" ? `\n  ${cut(j.result.replace(/\s+/g, " "), 200)}` : ""}`).join("\n")
}

/** The recent jobs a summoned ask mentions, so a follow-up continues one (handoff job). */
export function jobsLine(jobs: Job[], now = Date.now()) {
  const recent = jobs.filter((j) => now - j.at < 6 * 3600_000 && j.state !== "cancelled").slice(0, 3)
  return recent.length ? `Your jobs (a follow-up to one: handoff with its job): ${recent.map((j) => `${j.id} "${cut(j.title, 60)}" (${j.state})`).join(", ")}.` : ""
}
