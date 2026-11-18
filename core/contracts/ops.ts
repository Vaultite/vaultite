// GET /api/ops: vau may run another build than the server, so it parses the catalog here.
import { isObj } from "../values.ts"

/* oxlint-disable anti-slop/no-runtime-typeof, anti-slop/no-unknown-parameters, anti-slop/no-unsafe-dictionary-type -- the catalog's parser in vau's start, where zod would add ~55 ms */

/** A parameter's or a result's schema: the JSON Schema words the catalog uses. */
export type Schema = {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object"
  description?: string
  enum?: readonly unknown[]
  default?: unknown
  items?: Schema
  properties?: Record<string, Schema>
  required?: readonly string[]
  additionalProperties?: boolean | Schema
  minimum?: number
  maximum?: number
  /** "date" (YYYY-MM-DD), "path" (a vault path, as the user would say it), "json" (any JSON value) */
  format?: string
  examples?: unknown[]
  /** A CLI fills it from this environment variable when it isn't given (VAULTITE_TERMINAL: the app terminal it runs in). */
  env?: string
  /** A CLI fills it from stdin when text is piped in and it isn't given (a note's body: `echo text | vau note Title`). */
  stdin?: boolean
  /** A list given as text is one item, not split at its commas (questions, sentences). */
  commas?: false
  /** A "path" that may be a file outside the vault: an absolute one outside it is kept whole (pathAsSaid). */
  outside?: true
  /** A "path" only found (opened, pinned), never written: on a write op it still finds a file whose folder moved. */
  finds?: true
}

/** It acts on a kind of file, which fills one of its params: one of that file's actions (core/actions.ts). */
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
  icon?: string
  /** Only archived files (true); without it, only files that aren't. */
  archived?: boolean
  /** false: the app's menus have their own item for it (Archive), so they leave it out. */
  menu?: boolean
}

export const OP_KINDS = ["read", "write", "destructive"] as const
export type OpKind = typeof OP_KINDS[number]

/** An op as the catalog lists it (no functions); what a server leaves out reads as none. */
export type OpEntry = {
  id: string
  plugin: string | null
  summary: string
  help: string
  kind: OpKind
  params: Schema
  args: string[]
  cli: string | null
  mcp: string | null
  result: Schema | null
  /** Only this machine's owner may run it (Op.owner): what it is, else null. */
  owner: string | null
  exact?: boolean
  /** The bytes it takes as a raw body. */
  input?: string
  /** Its answer comes with a picture (`?as=answer`). */
  image?: true
  home?: true
  action: OpAction | null
}

class Bad extends Error {}
type Obj = Record<string, unknown>

const isMap = (v: unknown): v is Obj => isObj(v)
const isStr = (v: unknown): v is string => typeof v === "string"
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v)
const isBool = (v: unknown): v is boolean => typeof v === "boolean"
const isTrue = (v: unknown): v is true => v === true
const isStrs = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr)
const isList = (v: unknown): v is unknown[] => Array.isArray(v)
const SCHEMA_TYPES = ["string", "number", "integer", "boolean", "array", "object"] as const
const isType = (v: unknown): v is NonNullable<Schema["type"]> => SCHEMA_TYPES.some((x) => x === v)
const isKind = (v: unknown): v is OpKind => OP_KINDS.some((x) => x === v)

function opt<T>(o: Obj, k: string, ok: (v: unknown) => v is T): T | undefined {
  const v = o[k]
  if (v === undefined) return undefined
  if (!ok(v)) throw new Bad(k)
  return v
}

function given<T extends object>(base: T, fields: Partial<T>): T {
  const out = { ...base }
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) Object.assign(out, { [k]: v })
  return out
}

function schemaOf(v: unknown): Schema {
  if (!isMap(v)) throw new Bad("schema")
  const props = opt(v, "properties", isMap), extra = v.additionalProperties
  return given<Schema>({}, {
    type: opt(v, "type", isType),
    description: opt(v, "description", isStr),
    enum: opt(v, "enum", isList),
    default: v.default,
    items: v.items === undefined ? undefined : schemaOf(v.items),
    properties: props && Object.fromEntries(Object.entries(props).map(([k, s]) => [k, schemaOf(s)])),
    required: opt(v, "required", isStrs),
    additionalProperties: extra === undefined || isBool(extra) ? extra : schemaOf(extra),
    minimum: opt(v, "minimum", isNum),
    maximum: opt(v, "maximum", isNum),
    format: opt(v, "format", isStr),
    examples: opt(v, "examples", isList),
    env: opt(v, "env", isStr),
    stdin: opt(v, "stdin", isBool),
    commas: opt(v, "commas", (x): x is false => x === false),
    outside: opt(v, "outside", isTrue),
    finds: opt(v, "finds", isTrue),
  })
}

function actionOf(v: unknown): OpAction | null {
  if (v === null || v === undefined) return null
  if (!isMap(v) || !isStrs(v.on) || !isStr(v.param) || !isStr(v.label)) throw new Bad("action")
  return given<OpAction>({ on: v.on, param: v.param, label: v.label }, {
    from: opt(v, "from", (x): x is "path" | "name" => x === "path" || x === "name"),
    ask: opt(v, "ask", isStrs), icon: opt(v, "icon", isStr), archived: opt(v, "archived", isBool), menu: opt(v, "menu", isBool),
  })
}

const textOrNull = (o: Obj, k: string) => opt(o, k, (x): x is string | null => x === null || isStr(x)) ?? null

function entryOf(v: unknown): OpEntry {
  if (!isMap(v) || !isStr(v.id)) throw new Bad("id")
  return given<OpEntry>({
    id: v.id,
    plugin: textOrNull(v, "plugin"),
    summary: opt(v, "summary", isStr) ?? "",
    help: opt(v, "help", isStr) ?? "",
    kind: opt(v, "kind", isKind) ?? "write",
    params: v.params === undefined ? { type: "object" } : schemaOf(v.params),
    args: opt(v, "args", isStrs) ?? [],
    cli: textOrNull(v, "cli"),
    mcp: textOrNull(v, "mcp"),
    result: v.result === undefined || v.result === null ? null : schemaOf(v.result),
    owner: textOrNull(v, "owner"),
    action: actionOf(v.action),
  }, { exact: opt(v, "exact", isBool), input: opt(v, "input", isStr), image: opt(v, "image", isTrue), home: opt(v, "home", isTrue) })
}

export const catalogOf = (body: unknown): OpEntry[] | null =>
  Array.isArray(body) ? body.flatMap((e) => { try { return [entryOf(e)] } catch (x) { if (x instanceof Bad) return []; throw x } }) : null
