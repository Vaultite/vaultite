// Operations: everything an agent, script or plugin can do, each defined once; the HTTP API (/api/ops), vau, MCP and
// `vau docs api` are generated from the catalog so none can drift. `kind` decides locking and MCP hints.
import { distance } from "./blocks.ts"
import { actionProblems, type OpAction } from "./actions.ts"
import type { Readable } from "node:stream"
import type { Item, Vault } from "./vault.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

/** A parameter's or a result's schema: the JSON Schema words the catalog uses. */
export type Schema = {
  type?: "string" | "number" | "integer" | "boolean" | "array" | "object"
  description?: string
  enum?: readonly unknown[]
  default?: unknown
  items?: Schema
  properties?: Record<string, Schema>
  required?: string[]
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
}

/** A parameter: its schema, and whether it must be given. */
export type Param = Omit<Schema, "required"> & { required?: boolean }

export type OpKind = "read" | "write" | "destructive"

/** Who asked: the client (X-Vaultite-Client: "cli", "mcp", "app"...), the agent it works for (X-Vaultite-Agent:
 *  "claude-code"), how to name that agent to the user, and what a note or a log it writes says as its `source`. */
export type Who = { client: string | null; agent: string | null; label: string; source: string }

export type OpCtx = {
  vault: Vault
  who: Who
  /** Run another op (its parameters checked like a request's; `input`: the bytes for one that takes them); throws its
   *  OpError. */
  op: (id: string, params?: Item, input?: Readable) => Promise<Any>
  /** A route of the HTTP API, in-process: its body; a 4xx or 5xx throws an OpError with its message. */
  api: (method: string, route: string, body?: unknown) => Promise<Any>
  /** Drive the user's open window (POST /api/ui's message: open, command, notify; null: which windows are open): its
   *  answer. */
  ui: (message: Item | null) => Promise<Any>
  /** The plugin it belongs to (null: the core's). */
  plugin: string | null
  /** Why the caller isn't this machine's owner for `what` (core/owner.ts), or "": for an op that's the owner's only in part
   *  (turning a vault plugin on approves it here). "" without a request (in-process, an approved MCP call). */
  refusal?: (what: string) => Promise<string>
  /** The bytes it was given besides its parameters (an op with `input`): a raw request body, or an in-process caller's. */
  input?: Readable
}

export type Op = {
  id: string
  /** One line: what it does. */
  summary: string
  /** More: when to use it, what it answers, examples (`vau <id> --help`, the tool's description). */
  help?: string
  kind: OpKind
  params?: Record<string, Param>
  /** An object parameter that keeps parameters it doesn't name (log.create's `data`), text read as JSON when it is one.
   *  Without it, an unknown parameter is an error. */
  rest?: string
  /** The parameters given by position (CLI: `vau note.create "Title"`), in order; the last may be an array (the rest). */
  args?: string[]
  /** Its name in the CLI (`note`: `vau note "Title"`), one or more words (`inbox add`: `vau inbox add ...`; `vau inbox`
   *  then lists the ops under it). Old commands keep their names and flags this way. */
  cli?: string
  /** An MCP tool: true (named after the id: `note_create`), or the tool's name. */
  mcp?: boolean | string
  /** What it answers, for the docs. */
  result?: Schema
  lock?: boolean
  /** Only this machine's owner may run it (what it is, for the refusal: "the terminal"): a shell, the screen. Over HTTP
   *  anyone else gets a 403 (core/owner.ts; the plugin's allowUsers / allowRemote apply). */
  owner?: string
  /** It acts on a kind of file, which fills one of its params: one of that file's actions (core/actions.ts). */
  action?: OpAction
  run: (params: Any, ctx: OpCtx) => Promise<unknown> | unknown
  /** The result as Markdown, for an agent or a terminal (else JSON). `who` asked: an answer may read differently for an
   *  MCP client (`who.client` "mcp": a file's path before its text) than for vau, which prints a file exactly. */
  text?: (result: Any, params: Any, who?: Who) => string
  /** Its text is printed as is when piped, no newline added (a secret going into another command). */
  exact?: boolean
  /** It also takes bytes of any size (what they are: "the file"), as `ctx.input`: the raw body of POST /api/ops/<id>
   *  (any type but JSON; the parameters then in the query), or an in-process caller's (call's `input`). */
  input?: string
}

/** An op as the catalog lists it (no functions). */
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
  /** Op.exact: printed as is when piped. */
  exact?: boolean
  /** Op.input: the bytes it takes as a raw body. */
  input?: string
  action: OpAction | null
}

/** What an op can't do, with what to do instead: a 400 over HTTP (`status`), the tool's error over MCP. */
export class OpError extends Error {
  status: number
  problems: string[]
  constructor(message: string, status = 400, problems: string[] = []) {
    super(message)
    this.status = status
    this.problems = problems
  }
}

export const ID = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/

/** An op's definition checked (an id that reads like one, args that are params): the problems, or []. */
export function opProblems(op: Op): string[] {
  const out: string[] = []
  if (!ID.test(op.id)) out.push(`op id '${op.id}' should be area.verb, lowercase (note.create)`)
  if (!op.summary?.trim()) out.push(`${op.id}: a summary is missing`)
  if (!["read", "write", "destructive"].includes(op.kind)) out.push(`${op.id}: kind is read, write or destructive`)
  for (const a of op.args ?? []) if (!op.params?.[a]) out.push(`${op.id}: arg '${a}' isn't one of its params`)
  if (op.rest && op.params?.[op.rest]?.type !== "object") out.push(`${op.id}: rest '${op.rest}' should be one of its params, an object`)
  for (const [k, p] of Object.entries(op.params ?? {})) {
    if (!/^[a-z][a-zA-Z0-9_]*$/.test(k)) out.push(`${op.id}: param '${k}' should be a plain name (camelCase or snake_case)`)
    if (!p.description?.trim()) out.push(`${op.id}: param '${k}' has no description`)
  }
  if (op.cli !== undefined && !/^[a-z][a-z0-9-]*( [a-z][a-z0-9-]*)*$/.test(op.cli)) out.push(`${op.id}: cli name '${op.cli}' should be lowercase words`)
  if (typeof op.mcp === "string" && !/^[a-z][a-z0-9_]{0,63}$/.test(op.mcp)) out.push(`${op.id}: MCP tool name '${op.mcp}' should be snake_case`)
  if (op.action) out.push(...actionProblems(op.id, op.action, Object.keys(op.params ?? {})))
  return out
}

/** An op's parameters as one JSON Schema object. */
export function paramsSchema(op: Op): Schema {
  const properties: Record<string, Schema> = {}
  const required: string[] = []
  for (const [k, p] of Object.entries(op.params ?? {})) {
    const { required: req, ...s } = p
    properties[k] = s
    if (req) required.push(k)
  }
  return { type: "object", properties, ...(required.length ? { required } : {}), additionalProperties: !!op.rest }
}

export const toolName = (op: Op): string | null => (op.mcp ? (typeof op.mcp === "string" ? op.mcp : op.id.replace(/[.-]/g, "_")) : null)

export function entryOf(op: Op, plugin: string | null): OpEntry {
  return { id: op.id, plugin, summary: op.summary, help: op.help ?? "", kind: op.kind, params: paramsSchema(op), args: op.args ?? [],
    cli: op.cli ?? null, mcp: toolName(op), result: op.result ?? null, owner: op.owner ?? null, action: op.action ?? null, ...(op.exact ? { exact: true } : {}),
    ...(op.input ? { input: op.input } : {}) }
}

// ---------- checking and converting parameters ----------

const typeName = (v: unknown) => (v === null ? "null" : Array.isArray(v) ? "a list" : typeof v === "object" ? "an object" : `a ${typeof v}`)
const DATE = /^\d{4}-\d\d-\d\d$/

/** A value read as `s` says, converting text the way a command line gives it ("3", "true", "a,b", JSON): the value, or
 *  a problem (a string) prefixed by its name. */
function convert(name: string, v: unknown, s: Schema): { ok: true; v: unknown } | { ok: false; why: string } {
  const bad = (what: string) => ({ ok: false as const, why: `${name}: ${what}` })
  if (s.format === "json" || !s.type) return { ok: true, v }
  let x = v
  switch (s.type) {
    case "string":
      if (typeof x === "number" || typeof x === "boolean") x = String(x)
      if (typeof x !== "string") return bad(`should be text, not ${typeName(x)}`)
      if (s.format === "date" && !DATE.test(x.trim())) return bad(`should be a date, YYYY-MM-DD (got '${x}')`)
      break
    case "number":
    case "integer":
      if (typeof x === "string" && x.trim() && Number.isFinite(Number(x))) x = Number(x)
      if (typeof x !== "number" || !Number.isFinite(x)) return bad(`should be a number, not ${typeName(x)}${typeof x === "string" ? ` ('${x}')` : ""}`)
      if (s.type === "integer" && !Number.isInteger(x)) return bad(`should be a whole number (got ${x})`)
      if (s.minimum !== undefined && x < s.minimum) return bad(`should be at least ${s.minimum} (got ${x})`)
      if (s.maximum !== undefined && x > s.maximum) return bad(`should be at most ${s.maximum} (got ${x})`)
      break
    case "boolean":
      if (x === "true" || x === "yes" || x === "1" || x === "on") x = true
      else if (x === "false" || x === "no" || x === "0" || x === "off") x = false
      if (typeof x !== "boolean") return bad(`should be true or false, not ${typeName(x)}`)
      break
    case "array": {
      if (typeof x === "string") {
        const t = x.trim()
        if (t.startsWith("[")) { try { x = JSON.parse(t) } catch { return bad("isn't a valid JSON list") } }
        else x = !t ? [] : s.commas === false ? [t] : t.split(",").map((e) => e.trim()).filter(Boolean)
      }
      if (!Array.isArray(x)) x = [x]
      const items: unknown[] = []
      for (const [i, e] of (x as unknown[]).entries()) {
        const r = s.items ? convert(`${name}[${i}]`, e, s.items) : { ok: true as const, v: e }
        if (!r.ok) return r
        items.push(r.v)
      }
      x = items
      break
    }
    case "object":
      if (typeof x === "string") { try { x = JSON.parse(x) } catch { return bad("isn't a valid JSON object") } }
      if (!x || typeof x !== "object" || Array.isArray(x)) return bad(`should be an object, not ${typeName(x)}`)
      if (s.properties) {
        const o: Item = { ...(x as Item) }
        for (const [k, ps] of Object.entries(s.properties)) {
          if (o[k] === undefined) continue
          const r = convert(`${name}.${k}`, o[k], ps)
          if (!r.ok) return r
          o[k] = r.v
        }
        for (const k of s.required ?? []) if (o[k] === undefined) return bad(`${k} is missing`)
        x = o
      }
      break
  }
  if (s.enum && !s.enum.includes(x)) {
    const names = s.enum.map((e) => (typeof e === "string" && /^[\w:-]+$/.test(e) ? e : JSON.stringify(e)))
    return bad(`should be ${names.length > 1 ? `${names.slice(0, -1).join(", ")} or ${names.at(-1)}` : names[0]} (got ${JSON.stringify(x)})`)
  }
  return { ok: true, v: x }
}

/** An op's parameters checked and converted, with their defaults: the parameters, or an OpError naming every problem
 *  (unknown ones with the nearest name, missing ones, wrong types) and how to call it. */
export function checkParams(op: Op, given: unknown): Item {
  if (given !== undefined && given !== null && (typeof given !== "object" || Array.isArray(given))) {
    throw new OpError(`${op.id} takes an object of its parameters, not ${typeName(given)}`)
  }
  const params = op.params ?? {}
  const out: Item = {}
  const problems: string[] = []
  const extra: Item = {}
  for (const [k, v] of Object.entries((given ?? {}) as Item)) {
    if (v === undefined) continue
    const p = params[k]
    if (!p && op.rest) {
      extra[k] = typeof v === "string" && /^(-?\d|true$|false$|null$|\[|\{)/.test(v.trim()) ? (() => { try { return JSON.parse(v) } catch { return v } })() : v
      continue
    }
    if (!p) {
      const near = nearest(k, Object.keys(params))
      problems.push(`${k}: ${op.id} has no such parameter${near ? ` (did you mean ${near}?)` : ""}`)
      continue
    }
    if (v === null && !p.required) continue // null: not given
    const { required: _req, ...schema } = p
    const r = convert(k, v, schema)
    if (r.ok) out[k] = r.v
    else problems.push(r.why)
  }
  if (op.rest && Object.keys(extra).length) out[op.rest] = { ...(out[op.rest] ?? {}), ...extra }
  for (const [k, p] of Object.entries(params)) {
    if (out[k] !== undefined || problems.some((x) => x.startsWith(`${k}:`) || x.startsWith(`${k} `))) continue
    if (p.default !== undefined) out[k] = structuredClone(p.default)
    else if (p.required) problems.push(`${k} is missing (${p.description ?? "required"})`)
  }
  if (problems.length) throw new OpError(`${op.id}: ${problems.join("; ")}. ${usage(entryOf(op, null))}`, 400, problems)
  return out
}

/** A parameter as a CLI flag: `newTab` is `--new-tab`. */
export const flagOf = (k: string) => `--${k.replace(/[A-Z]/g, (x) => `-${x.toLowerCase()}`)}`

/** How to call an op, in a line: `vau note <title> [--body <body>] ...` */
export function usage(e: OpEntry): string {
  const props = e.params.properties ?? {}, required = e.params.required ?? []
  const pos = e.args.map((a) => (required.includes(a) ? `<${a}>` : `[${a}]`))
  const flags = Object.entries(props).filter(([k]) => !e.args.includes(k)).map(([k, s]) => {
    const f = `${flagOf(k)}${s.type === "boolean" ? "" : ` <${s.type === "array" ? "a,b" : s.enum ? s.enum.join("|") : flagOf(k).slice(2)}>`}`
    return required.includes(k) ? f : `[${f}]`
  })
  if (e.params.additionalProperties === true) flags.push("[--<other> <value>...]")
  return `Usage: vau ${[e.cli ?? e.id, ...pos, ...flags].join(" ")}`
}

/** The nearest of `names` to `s` (by edit distance, close enough to be a typo), or null. */
export function nearest(s: string, names: string[]): string | null {
  let best: string | null = null, bestD = Infinity
  for (const n of names) {
    const d = distance(s.toLowerCase(), n.toLowerCase())
    if (d < bestD) { best = n; bestD = d }
  }
  return best !== null && bestD <= Math.max(2, Math.floor(s.length / 3)) ? best : null
}

// ---------- who asked ----------

/** Who asked, from the request's X-Vaultite-Client and -Agent (or an MCP client's own name, given as the agent). */
export function whoOf(client: string | null, agent: string | null): Who {
  const n = (agent ?? "").trim()
  const known: [RegExp, string, string, string][] = [
    [/claude[-_ ]?code/i, "claude-code", "Claude Code", "claude"],
    [/claude/i, "claude-app", "Claude", "claude"],
    [/codex/i, "codex", "Codex", "codex"],
    [/chatgpt|openai/i, "chatgpt", "ChatGPT", "chatgpt"],
    [/cursor/i, "cursor", "Cursor", "cursor"],
    [/opencode/i, "opencode", "OpenCode", "opencode"],
    [/openclaw/i, "openclaw", "OpenClaw", "openclaw"],
    [/hermes/i, "hermes", "Hermes", "hermes"],
    [/gemini/i, "gemini", "Gemini", "gemini"],
  ]
  for (const [re, id, label, source] of known) if (re.test(n)) return { client, agent: id, label, source }
  const slug = n.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40)
  if (slug) return { client, agent: slug, label: n.slice(0, 60), source: slug }
  if (client === "mcp") return { client, agent: null, label: "An MCP client", source: "mcp" }
  if (client === "cli") return { client, agent: null, label: "vau", source: "cli" }
  return { client, agent: null, label: client ?? "the API", source: client ?? "api" }
}

// ---------- docs ----------

/** A parameter as a line of docs: `- \`title\` (text, required): what it is. Default: x.` */
function paramLine(k: string, s: Schema, required: boolean, positional: boolean) {
  const t = s.enum ? s.enum.map((e) => JSON.stringify(e)).join(" | ") : s.type === "array" ? `list of ${s.items?.type ?? "values"}` : s.format ?? s.type ?? "any"
  const bits = [t, required ? "required" : null, positional ? "positional" : null].filter(Boolean).join(", ")
  const def = s.default !== undefined ? ` Default: ${JSON.stringify(s.default)}.` : ""
  return `- \`${k}\` (${bits}): ${s.description ?? ""}${def}`
}

/** An op's answer as Markdown when it has no words of its own: its JSON, fenced. */
export const jsonBlock = (r: unknown) => "```json\n" + JSON.stringify(r, null, 2) + "\n```"

/** One op as Markdown (its section of the docs, and `vau <id> --help`). */
export function opDoc(e: OpEntry, heading = "###"): string {
  const props = e.params.properties ?? {}
  const req = e.params.required ?? []
  const names = [e.cli ? `\`vau ${e.cli}\`` : null, e.mcp ? `MCP \`${e.mcp}\`` : null].filter(Boolean).join(", ")
  return [
    `${heading} ${e.id}`,
    `${e.summary}${e.kind === "read" ? "" : e.kind === "write" ? " (writes)" : " (destructive)"}${names ? ` Also ${names}.` : ""}`,
    e.help ? e.help.trim() : null,
    Object.keys(props).length ? Object.entries(props).map(([k, s]) => paramLine(k, s, req.includes(k), e.args.includes(k))).join("\n") : "No parameters.",
    usage(e),
  ].filter(Boolean).join("\n\n")
}

/** The catalog as Markdown: how to call ops, then every op, grouped by area. */
export function opsDoc(entries: OpEntry[]): string {
  const areas = new Map<string, OpEntry[]>()
  for (const e of entries) {
    const a = e.id.split(".")[0]
    if (!areas.has(a)) areas.set(a, [])
    areas.get(a)!.push(e)
  }
  return [
    "## Operations (the API)",
    "Everything an agent, a script or a plugin can do with the vault and the app is an operation: an id (`note.create`), its " +
      "parameters (checked, with defaults), and its answer. The same catalog is the HTTP API, the CLI and the MCP tools, so " +
      "use whichever reaches you:",
    "- CLI: `vau <id> [args] [--param value]` (`vau <id> --help`; `--json` for JSON, `--count`/`--paths` for a list's size or files; `vau ops` lists them). Lists take `a,b`.\n" +
      "- HTTP: `POST /api/ops/<id>` with the parameters as a JSON object (`?as=text`: the answer as Markdown); `GET /api/ops` is the catalog, with a JSON Schema per op.\n" +
      "- MCP: the tools named in each op below.",
    "Plugins add their own (`plugin.op`, `vau docs vault-plugins`), only while they're on, so this list is this vault's.",
    ...[...areas].map(([a, es]) => [`### ${a}`, ...es.map((e) => opDoc(e, "####"))].join("\n\n")),
  ].join("\n\n")
}

/** A plugin's ops as a section of its docs (generated, like its blocks). */
export function pluginOpsDoc(entries: OpEntry[]): string {
  if (!entries.length) return ""
  return ["## Operations", "Run with `vau <id>`, `POST /api/ops/<id>` or MCP (`vau docs api`: how).", ...entries.map((e) => opDoc(e, "###"))].join("\n\n")
}

// ---------- paths as the user says them ----------

type TreeFile = { path: string; type?: unknown }

/** A path as the user says it ("Today", "notes/idea") made a vault path: exact, with .md, any case, a file's name, or
 *  a path from before a folder moved; a web address is its web tab. Views, folders and misses come back as given ("Logs/Work" never picks Work.md). */
export function pathAsSaid(tree: { files?: TreeFile[]; others?: TreeFile[]; folders?: string[] }, raw: string): string {
  if (/^https?:\/\//i.test(raw.trim())) return `view:web/${raw.trim()}` // a web address: its web tab
  const p = raw.trim().replace(/^\/+/, "").replace(/\/+$/, "")
  if (!p || p.startsWith("view:")) return p
  const folder = (tree.folders ?? []).find((d) => d === p) ?? (tree.folders ?? []).find((d) => d.toLowerCase() === p.toLowerCase())
  if (folder) return folder
  const pages = new Set((tree.files ?? []).map((f) => f.path))
  const types = new Map((tree.files ?? []).map((f) => [f.path, f.type]))
  const all = [...(tree.files ?? []), ...(tree.others ?? [])].map((f) => f.path)
  const low = p.toLowerCase()
  const stem = (x: string) => { const n = x.split("/").pop()!; return (pages.has(x) ? n.replace(/\.[^.]+$/, "") : n).toLowerCase() }
  const by = (ok: (x: string) => boolean) => {
    const hits = all.filter(ok), dash = hits.filter((x) => types.get(x) === "dashboard")
    return hits.length === 1 ? hits[0] : dash.length === 1 ? dash[0] : null
  }
  const tail = low.split("/").pop()!.replace(/\.md$/, "")
  return all.find((x) => x === p) ?? by((x) => x === `${p}.md`) ?? by((x) => x.toLowerCase() === low || x.toLowerCase() === `${low}.md`) ??
    by((x) => stem(x) === low) ?? (low.includes("/") ? by((x) => stem(x) === tail) : null) ?? p
}
