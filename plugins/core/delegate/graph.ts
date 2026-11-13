import type { PermissionMode, Question } from "../../../core/agents.ts"

export type Party = { agent: string; terminal?: string; session?: string }

export type TaskState = "working" | "waiting" | "done" | "error" | "cancelled"

export type Task = {
  id: string
  parent: Party | null
  child: Party
  task: string; title: string; cwd: string
  model?: string; effort?: string
  mode: PermissionMode | null
  state: TaskState
  ask?: string; questions?: Question[]
  result?: string; files?: string[]; error?: string
  started: number; at: number
  turn: number
}

export const same = (a: Party, b: Party) => (!!a.terminal && a.terminal === b.terminal) || (!!a.session && a.session === b.session)

export const known = (p: Party | null): p is Party => !!p && !!(p.terminal || p.session)

export const childrenOf = (tasks: Task[], p: Party) => tasks.filter((t) => known(t.parent) && same(t.parent, p)).sort((a, b) => b.started - a.started)

export const taskOf = (tasks: Task[], p: Party) => tasks.filter((t) => same(t.child, p)).sort((a, b) => b.started - a.started)[0] ?? null

export const ended = (t: Pick<Task, "state">) => t.state === "done" || t.state === "error" || t.state === "cancelled"

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

/** How much each mode lets a session do unasked, least first (dontAsk never asks, but has only its rules). */
export const RANK: Record<PermissionMode, number> = { plan: 0, dontAsk: 1, default: 1, acceptEdits: 2, auto: 3, bypassPermissions: 4 }

export function clampMode(ceiling: PermissionMode | null | undefined, asked?: PermissionMode | null, byUser = false): { mode: PermissionMode | null; clamped: boolean } {
  if (byUser) return { mode: asked ?? null, clamped: false }
  const top = ceiling ?? "default"
  if (!asked) return { mode: top, clamped: false }
  return RANK[asked] > RANK[top] ? { mode: top, clamped: true } : { mode: asked, clamped: false }
}

export function titleOf(task: string) {
  const line = task.replace(/\s+/g, " ").trim()
  if (line.length <= 60) return line
  const cut = line.slice(0, 60), space = cut.lastIndexOf(" ")
  return `${(space > 30 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")}…`
}
