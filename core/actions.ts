import type { OpAction } from "./contracts/ops.ts"

export type ActionFile = { path: string; type: string | null; archived?: boolean }

type Acting = { id: string; kind: string; action: OpAction | null; params: { properties?: Record<string, unknown>; required?: readonly string[] } }

const actsOn = (a: OpAction, f: ActionFile) =>
  (a.on.includes("*") || (!!f.type && a.on.includes(f.type))) && !!a.archived === !!f.archived

const actionValue = (a: OpAction, path: string) =>
  a.from === "name" ? (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "") : path

export function actionsFor<E extends Acting>(entries: E[], f: ActionFile) {
  const own = (e: E) => (e.action?.on.includes("*") ? 1 : 0)
  return [...entries].sort((a, b) => own(a) - own(b)).flatMap((e) => {
    if (!e.action || !actsOn(e.action, f)) return []
    const params = { [e.action.param]: actionValue(e.action, f.path) }
    const needs = [...new Set([...(e.params.required ?? []), ...(e.action.ask ?? [])])].filter((k) => !(k in params))
    return [{ op: e.id, label: e.action.label, kind: e.kind, icon: e.action.icon ?? null, menu: e.action.menu !== false, params, needs, entry: e }]
  })
}

export function actionProblems(id: string, a: OpAction, params: string[]): string[] {
  const out: string[] = []
  if (!Array.isArray(a.on) || !a.on.length || !a.on.every((t) => typeof t === "string" && t)) out.push(`${id}: action.on should list types ("person"), or "*"`)
  for (const k of [a.param, ...(a.ask ?? [])]) if (!params.includes(k)) out.push(`${id}: action's '${k}' isn't one of its params`)
  if (!a.label?.trim()) out.push(`${id}: action.label is missing`)
  if (a.from && a.from !== "path" && a.from !== "name") out.push(`${id}: action.from is path or name`)
  return out
}
