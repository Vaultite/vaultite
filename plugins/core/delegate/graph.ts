// Delegated tasks as a graph: who started each (its parent, a session, or the user), the child session it runs in, and
// what a child may do (never more than its parent). Plain functions over the records, which plugin.ts keeps.
import type { PermissionMode, Question } from "../../../core/agents.ts"

/** A session as the graph names it: its agent (claude, codex, opencode) and its app terminal or its own session id. */
export type Party = { agent: string; terminal?: string; session?: string }

export type TaskState = "working" | "waiting" | "done" | "error" | "cancelled"

/** A task delegated to a child session. `parent` null: the user started it (`vau delegate` typed by hand, the app). */
export type Task = {
  id: string
  parent: Party | null
  child: Party
  task: string; title: string; cwd: string
  model?: string; effort?: string
  /** What it may do (null: its agent's own setting, for one the user started without saying). */
  mode: PermissionMode | null
  state: TaskState
  /** While waiting: on what (permission, question, plan, auth), and its questions. */
  ask?: string; questions?: Question[]
  /** Its last turn's final message and the files it changed; an error's words. */
  result?: string; files?: string[]; error?: string
  started: number; at: number
  /** When its current turn began (a follow-up's too). */
  turn: number
}

/** Whether two parties are the same session: its terminal, else its session id. */
export const same = (a: Party, b: Party) => (!!a.terminal && a.terminal === b.terminal) || (!!a.session && a.session === b.session)

/** A party that can be told apart (by its terminal or session); an agent naming neither is anyone. */
export const known = (p: Party | null): p is Party => !!p && !!(p.terminal || p.session)

/** The tasks `p` started, newest first. */
export const childrenOf = (tasks: Task[], p: Party) => tasks.filter((t) => known(t.parent) && same(t.parent, p)).sort((a, b) => b.started - a.started)

/** The task whose child is `p` (a session runs one task at a time: the newest). */
export const taskOf = (tasks: Task[], p: Party) => tasks.filter((t) => same(t.child, p)).sort((a, b) => b.started - a.started)[0] ?? null

export const ended = (t: Pick<Task, "state">) => t.state === "done" || t.state === "error" || t.state === "cancelled"

/** Task `id` and everything under it, deepest first (each child's subtree before it): the order a cancel stops them in,
 *  so none outlives the one it reports to. A loop (a session that's its own ancestor) is visited once. */
export function cascade(tasks: Task[], id: string): Task[] {
  const out: Task[] = [], seen = new Set<string>()
  const visit = (t: Task) => {
    if (seen.has(t.id)) return
    seen.add(t.id)
    for (const c of childrenOf(tasks, t.child)) visit(c)
    out.push(t)
  }
  const root = tasks.find((t) => t.id === id)
  if (root) visit(root)
  return out
}

/** How much each mode lets a session do without asking, least first (dontAsk never asks, but has only its rules). */
export const RANK: Record<PermissionMode, number> = { plan: 0, dontAsk: 1, default: 1, acceptEdits: 2, auto: 3, bypassPermissions: 4 }

/** The mode a child runs in: the one asked, never more than its parent's `ceiling` (unknown: default), else that;
 *  `clamped` when the one asked was more. One the user started (`byUser`) runs as asked, or as its agent's own. */
export function clampMode(ceiling: PermissionMode | null | undefined, asked?: PermissionMode | null, byUser = false): { mode: PermissionMode | null; clamped: boolean } {
  if (byUser) return { mode: asked ?? null, clamped: false }
  const top = ceiling ?? "default"
  if (!asked) return { mode: top, clamped: false }
  return RANK[asked] > RANK[top] ? { mode: top, clamped: true } : { mode: asked, clamped: false }
}

/** A task's first words as its title: one line, about 60 letters at most. */
export function titleOf(task: string) {
  const line = task.replace(/\s+/g, " ").trim()
  if (line.length <= 60) return line
  const cut = line.slice(0, 60), space = cut.lastIndexOf(" ")
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`
}
