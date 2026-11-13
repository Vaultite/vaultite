import { z } from "zod"
import { PERMISSION_MODES, type PermissionMode, type Question } from "../../../core/agents.ts"

const Party = z.object({ agent: z.string(), terminal: z.string().optional(), session: z.string().optional() })
export type Party = z.infer<typeof Party>

export type TaskState = Task["state"]

export const Task = z.object({
  id: z.string(),
  parent: Party.nullable(),
  child: Party,
  task: z.string(), title: z.string(), cwd: z.string(),
  model: z.string().optional(), effort: z.string().optional(),
  mode: z.enum(PERMISSION_MODES).nullable(),
  state: z.enum(["working", "waiting", "done", "error", "cancelled"]),
  ask: z.string().optional(), questions: z.array(z.custom<Question>()).optional(),
  result: z.string().optional(), files: z.array(z.string()).optional(), error: z.string().optional(),
  started: z.number(), at: z.number(),
  turn: z.number(),
})
export type Task = z.infer<typeof Task>
export const TasksFile = z.object({ tasks: z.array(Task).default([]) })

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
