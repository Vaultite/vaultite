// What the app's main process asks of the passwords process (kdbxproc.ts), and its answers: checked on both sides.
import { z } from "zod"
import { GENERATE } from "./generate.ts"
import { CHANGE, GROUP_CHANGE, MOVES, REMOVAL } from "./passwordswire.ts"

const BYTES = z.custom<Uint8Array>((v) => v instanceof Uint8Array)
const ACCESS = z.object({ file: z.string(), password: BYTES.optional() })
export type Access = z.infer<typeof ACCESS>
const AGENTS = z.object({ file: z.string(), password: BYTES })

const OTP = z.object({ key: BYTES, period: z.number(), digits: z.number(), algorithm: z.enum(["sha1", "sha256", "sha512"]) })
const SECRETS = z.object({ username: z.string(), password: z.string(), otp: z.union([OTP, z.literal("steam"), z.null()]) })
const GROUP = z.object({ id: z.string(), name: z.string(), parent: z.string().nullable(), share: z.string().nullable(), bin: z.boolean(), expanded: z.boolean() })
const ROW = z.object({ id: z.string(), group: z.string(), title: z.string(), username: z.string(), urls: z.array(z.string()), tags: z.array(z.string()),
  free: z.boolean(), shared: z.boolean(), expired: z.boolean(), otp: z.boolean(), modified: z.number() })
const ONLY_UNLOCKED = { expires: z.number().nullable(), from: z.string().nullable() }
const LISTED = ROW.extend(ONLY_UNLOCKED)
const PAST = z.object({ at: z.number(), until: z.number(), changed: z.array(z.string()) })
const FULL = LISTED.extend({ password: z.boolean(), notes: z.string(), history: z.array(PAST) })
const CODE = z.object({ code: z.string(), period: z.number() })
const VERSION = z.object({ at: z.number(), title: z.string(), username: z.string(), password: z.boolean(), urls: z.array(z.string()), notes: z.string() })
const HEALTH = z.object({ id: z.string(), bits: z.number().nullable(), same: z.string().nullable(), since: z.number(), excluded: z.boolean() })
const MADE = z.object({ password: z.string(), bits: z.number() })
const LEAK = z.object({ id: z.string(), times: z.number() })
const ENTRY = z.object({ id: z.string(), title: z.string(), username: z.string(), urls: z.array(z.string()), free: z.boolean(), expired: z.boolean(), otp: z.boolean() })
export const INDEX_ROW = ROW.extend({ fp: z.string() })
export const SAVED = z.object({ id: z.string(), warnings: z.array(z.string()) })

// oxlint-disable-next-line anti-slop/no-unknown-parameters, anti-slop/no-unknown-returns -- a message between processes: parsed here
export type Serve = (raw: unknown) => Promise<unknown>
export type Op<A extends z.ZodType, R extends z.ZodType> = { name: string; ask: A; answer: R }
function op<A extends z.ZodType, R extends z.ZodType>(name: string, ask: A, answer: R) {
  return {
    name, ask, answer,
    serve: (fn: (a: z.output<A>) => Promise<z.input<R>>): Serve => async (raw) => answer.parse(await fn(ask.parse(raw))),
  }
}

export const OPS = {
  unlock: op("unlock", AGENTS, z.null()),
  lock: op("lock", z.null(), z.null()),
  check: op("check", ACCESS, z.null()),
  list: op("list", ACCESS, z.object({ groups: z.array(GROUP), entries: z.array(LISTED), recycles: z.boolean() })),
  get: op("get", ACCESS.extend({ id: z.string() }), FULL.nullable()),
  password: op("password", ACCESS.extend({ id: z.string(), at: z.number().optional() }), z.string()),
  code: op("code", ACCESS.extend({ id: z.string() }), CODE.nullable()),
  secretsOf: op("secretsOf", ACCESS.extend({ id: z.string() }), SECRETS.nullable()),
  entriesForUrl: op("entriesForUrl", ACCESS.extend({ url: z.string() }), z.array(ROW)),
  samePassword: op("samePassword", ACCESS.extend({ ids: z.array(z.string()), given: z.string() }), z.array(z.string())),
  index: op("index", ACCESS.extend({ salt: z.string() }), z.array(INDEX_ROW)),
  save: op("save", ACCESS.extend({ change: CHANGE }), SAVED),
  saveLogin: op("saveLogin", ACCESS.extend({ url: z.string(), username: z.string(), given: z.string(), id: z.string().optional() }), SAVED),
  keepSecret: op("keepSecret", ACCESS.extend({ title: z.string(), value: z.string() }), SAVED),
  move: op("move", ACCESS.extend({ moves: MOVES }), SAVED),
  delete: op("delete", ACCESS.extend({ removal: REMOVAL }), SAVED),
  saveGroup: op("saveGroup", ACCESS.extend({ group: GROUP_CHANGE }), SAVED),
  removeGroup: op("removeGroup", ACCESS.extend({ id: z.string() }), SAVED),
  version: op("version", ACCESS.extend({ id: z.string(), at: z.number() }), VERSION),
  restore: op("restore", ACCESS.extend({ id: z.string(), at: z.number() }), SAVED),
  health: op("health", ACCESS, z.array(HEALTH)),
  exclude: op("exclude", ACCESS.extend({ id: z.string(), on: z.boolean() }), SAVED),
  strength: op("strength", z.object({ text: z.string() }), z.number()),
  generate: op("generate", GENERATE, MADE),
  hashStarts: op("hashStarts", ACCESS, z.array(z.string())),
  leaked: op("leaked", z.object({ start: z.string(), range: z.string() }), z.array(LEAK)),
  agentEntries: op("agentEntries", AGENTS, z.array(ENTRY)),
  agentSecrets: op("agentSecrets", AGENTS.extend({ id: z.string() }), SECRETS.nullable()),
}
export type OpName = keyof typeof OPS

export const ASK = z.object({ id: z.number(), op: z.string(), args: z.unknown() })
export const ANSWER = z.union([z.object({ id: z.number(), value: z.unknown() }), z.object({ id: z.number(), error: z.string() })])
