// What the app's main process asks of the passwords process (kdbxproc.ts), and its answers: checked on both sides.
import { z } from "zod"
import { CHANGE } from "./passwordswire.ts"

const BYTES = z.custom<Uint8Array>((v) => v instanceof Uint8Array)
const ACCESS = z.object({ file: z.string(), password: BYTES.optional() })
export type Access = z.infer<typeof ACCESS>
const AGENTS = z.object({ file: z.string(), password: BYTES })

const OTP = z.object({ key: BYTES, period: z.number(), digits: z.number(), algorithm: z.enum(["sha1", "sha256", "sha512"]) })
const SECRETS = z.object({ username: z.string(), password: z.string(), otp: z.union([OTP, z.literal("steam"), z.null()]) })
const GROUP = z.object({ id: z.string(), name: z.string(), parent: z.string().nullable(), share: z.string().nullable(), bin: z.boolean() })
const ROW = z.object({ id: z.string(), group: z.string(), title: z.string(), username: z.string(), urls: z.array(z.string()), tags: z.array(z.string()),
  free: z.boolean(), shared: z.boolean(), expired: z.boolean(), otp: z.boolean(), modified: z.number() })
const FULL = ROW.extend({ password: z.string(), notes: z.string(), otpUri: z.string(), code: z.string().nullable() })
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
  list: op("list", ACCESS, z.object({ groups: z.array(GROUP), entries: z.array(ROW) })),
  get: op("get", ACCESS.extend({ id: z.string() }), FULL.nullable()),
  secretsOf: op("secretsOf", ACCESS.extend({ id: z.string() }), SECRETS.nullable()),
  entriesForUrl: op("entriesForUrl", ACCESS.extend({ url: z.string() }), z.array(ROW)),
  samePassword: op("samePassword", ACCESS.extend({ ids: z.array(z.string()), given: z.string() }), z.array(z.string())),
  index: op("index", ACCESS.extend({ salt: z.string() }), z.array(INDEX_ROW)),
  save: op("save", ACCESS.extend({ change: CHANGE }), SAVED),
  saveLogin: op("saveLogin", ACCESS.extend({ url: z.string(), username: z.string(), given: z.string(), id: z.string().optional() }), SAVED),
  keepSecret: op("keepSecret", ACCESS.extend({ title: z.string(), value: z.string() }), SAVED),
  delete: op("delete", ACCESS.extend({ id: z.string() }), SAVED),
  agentEntries: op("agentEntries", AGENTS, z.array(ENTRY)),
  agentSecrets: op("agentSecrets", AGENTS.extend({ id: z.string() }), SECRETS.nullable()),
}
export type OpName = keyof typeof OPS

export const ASK = z.object({ id: z.number(), op: z.string(), args: z.unknown() })
export const ANSWER = z.union([z.object({ id: z.number(), value: z.unknown() }), z.object({ id: z.number(), error: z.string() })])
