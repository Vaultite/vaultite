// GET /api/ops: vau may run another build than the server, so it parses the catalog here.
import { z } from "zod"

/** A parameter's or a result's schema: the JSON Schema words the catalog uses. */
export const Schema = z.object({
  type: z.enum(["string", "number", "integer", "boolean", "array", "object"]).optional(),
  description: z.string().optional(),
  enum: z.array(z.unknown()).readonly().optional(),
  default: z.unknown().optional(),
  get items() { return Schema.optional() },
  get properties() { return z.record(z.string(), Schema).optional() },
  required: z.array(z.string()).readonly().optional(),
  get additionalProperties() { return z.union([z.boolean(), Schema]).optional() },
  minimum: z.number().optional(),
  maximum: z.number().optional(),
  /** "date" (YYYY-MM-DD), "path" (a vault path, as the user would say it), "json" (any JSON value) */
  format: z.string().optional(),
  examples: z.array(z.unknown()).optional(),
  /** A CLI fills it from this environment variable when it isn't given (VAULTITE_TERMINAL: the app terminal it runs in). */
  env: z.string().optional(),
  /** A CLI fills it from stdin when text is piped in and it isn't given (a note's body: `echo text | vau note Title`). */
  stdin: z.boolean().optional(),
  /** A list given as text is one item, not split at its commas (questions, sentences). */
  commas: z.literal(false).optional(),
  /** A "path" that may be a file outside the vault: an absolute one outside it is kept whole (pathAsSaid). */
  outside: z.literal(true).optional(),
})
export type Schema = z.infer<typeof Schema>

/** It acts on a kind of file, which fills one of its params: one of that file's actions (core/actions.ts). */
export const OpAction = z.object({
  /** The types it acts on (a file's `type:`, its kind's), or "*" for any file. */
  on: z.array(z.string()),
  /** The param the file fills, with its path or its name (the file name without its extension). */
  param: z.string(),
  from: z.enum(["path", "name"]).optional(),
  /** How it reads in a menu, in sentence case ("Add to timeline"). */
  label: z.string(),
  /** Params the app asks for besides the required ones (a book's page). */
  ask: z.array(z.string()).optional(),
  /** A lucide icon's name. */
  icon: z.string().optional(),
  /** Only archived files (true); without it, only files that aren't. */
  archived: z.boolean().optional(),
  /** false: the app's menus have their own item for it (Archive), so they leave it out. */
  menu: z.boolean().optional(),
})
export type OpAction = z.infer<typeof OpAction>

export const OpKind = z.enum(["read", "write", "destructive"])
export type OpKind = z.infer<typeof OpKind>

/** An op as the catalog lists it (no functions); what a server leaves out reads as none. */
export const OpEntry = z.object({
  id: z.string(),
  plugin: z.string().nullable().default(null),
  summary: z.string().default(""),
  help: z.string().default(""),
  kind: OpKind.default("write"),
  params: Schema.default({ type: "object" }),
  args: z.array(z.string()).default([]),
  cli: z.string().nullable().default(null),
  mcp: z.string().nullable().default(null),
  result: Schema.nullable().default(null),
  /** Only this machine's owner may run it (Op.owner): what it is, else null. */
  owner: z.string().nullable().default(null),
  exact: z.boolean().optional(),
  /** The bytes it takes as a raw body. */
  input: z.string().optional(),
  /** Its answer comes with a picture (`?as=answer`). */
  image: z.literal(true).optional(),
  home: z.literal(true).optional(),
  action: OpAction.nullable().default(null),
})
export type OpEntry = z.infer<typeof OpEntry>

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the parse at the boundary
export const catalogOf = (body: unknown): OpEntry[] | null =>
  Array.isArray(body) ? body.flatMap((e) => { const r = OpEntry.safeParse(e); return r.success ? [r.data] : [] }) : null
