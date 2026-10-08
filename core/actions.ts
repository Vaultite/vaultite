// An object's actions: the ops that act on a kind of file (a person's timeline, a book's progress), the file filling one
// of their params. One list for the app's menus, the palette, `vau actions` and MCP. Pure, no Node: both sides use it.

/** How an op acts on a file (Op.action). */
export type OpAction = {
  /** The types it acts on (a file's `type:`, its kind's), or "*" for any file. */
  on: string[]
  /** The param the file fills, with its path or its name (the file name without its extension). */
  param: string
  from?: "path" | "name"
  /** How it reads in a menu, in sentence case ("Add to timeline"). */
  label: string
  /** Params the app asks for besides the required ones (a book's page). */
  ask?: string[]
  /** A lucide icon's name. */
  icon?: string
  /** Only archived files (true); without it, only files that aren't. */
  archived?: boolean
  /** false: the app's menus have their own item for it (Archive), so they leave it out. */
  menu?: boolean
}

/** The file an action is asked about. */
export type ActionFile = { path: string; type: string | null; archived?: boolean }

/** What an op with `action` needs to say about it (an OpEntry is one). */
type Acting = { id: string; kind: string; action: OpAction | null; params: { properties?: Record<string, unknown>; required?: string[] } }

export const actsOn = (a: OpAction, f: ActionFile) =>
  (a.on.includes("*") || (!!f.type && a.on.includes(f.type))) && !!a.archived === !!f.archived

/** The value the file gives the action's param. */
export const actionValue = (a: OpAction, path: string) =>
  a.from === "name" ? (path.split("/").pop() ?? path).replace(/\.[^.]+$/, "") : path

/** A file's actions: each op's id, label, the params the file fills and the ones still to give. */
export function actionsFor<E extends Acting>(entries: E[], f: ActionFile) {
  // (its kind's own first, then those for any file)
  const own = (e: E) => (e.action?.on.includes("*") ? 1 : 0)
  return [...entries].sort((a, b) => own(a) - own(b)).flatMap((e) => {
    if (!e.action || !actsOn(e.action, f)) return []
    const params = { [e.action.param]: actionValue(e.action, f.path) }
    const needs = [...new Set([...(e.params.required ?? []), ...(e.action.ask ?? [])])].filter((k) => !(k in params))
    return [{ op: e.id, label: e.action.label, kind: e.kind, icon: e.action.icon ?? null, menu: e.action.menu !== false, params, needs, entry: e }]
  })
}

/** What's wrong with an op's `action`, given its params' names. */
export function actionProblems(id: string, a: OpAction, params: string[]): string[] {
  const out: string[] = []
  if (!Array.isArray(a.on) || !a.on.length || !a.on.every((t) => typeof t === "string" && t)) out.push(`${id}: action.on should list types ("person"), or "*"`)
  for (const k of [a.param, ...(a.ask ?? [])]) if (!params.includes(k)) out.push(`${id}: action's '${k}' isn't one of its params`)
  if (!a.label?.trim()) out.push(`${id}: action.label is missing`)
  if (a.from && a.from !== "path" && a.from !== "name") out.push(`${id}: action.from is path or name`)
  return out
}
