// The server's log, each line dated so it matches what someone saw, and its errors for plugin.onServerError. Listeners
// run synchronously (a fatal one must be written before exit) and never re-entered.
import { AsyncLocalStorage } from "node:async_hooks"
import util from "node:util"

export type ServerError = {
  t: number
  /** The first line: the error's message, with what was logged before it ("terminal: couldn't start: Error: ..."). */
  message: string
  stack?: string
  /** The API request it happened in ("GET /api/state"), if any. */
  where?: string
  /** It ended the server (an exception nothing caught). */
  fatal?: boolean
}

export const errorContext = new AsyncLocalStorage<string>()

const subs = new Set<(e: ServerError) => void>()
let inside = false

function emit(e: ServerError) {
  if (inside || !subs.size) return
  inside = true
  try { for (const f of subs) try { f(e) } catch { /* a listener's problem, never the caller's */ } } finally { inside = false }
}

/** Hear the server's errors; returns how to stop. */
export function onServerError(fn: (e: ServerError) => void) {
  subs.add(fn)
  return () => { subs.delete(fn) }
}

const firstLine = (s: string) => s.split("\n").find((l) => l.trim())?.trim().slice(0, 500) ?? ""

/** console.error's arguments as an error: the text before the first Error and that Error's message, its stack. */
export function errorOf(args: unknown[], fatal = false): ServerError {
  const err = args.find((a): a is Error => a instanceof Error)
  const before = err ? args.slice(0, args.indexOf(err)) : args
  const head = before.map((a) => (typeof a === "string" ? a : util.inspect(a, { depth: 2, breakLength: Infinity }))).join(" ").trim()
  const msg = err ? `${err.name && err.name !== "Error" ? `${err.name}: ` : ""}${err.message}` : ""
  return { t: Date.now(), message: firstLine([head, msg].filter(Boolean).join(" ")) || "(an empty error)",
    ...(err?.stack ? { stack: err.stack.slice(0, 8000) } : {}), ...(errorContext.getStore() ? { where: errorContext.getStore() } : {}),
    ...(fatal ? { fatal } : {}) }
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0")
const stampNow = () => {
  const d = new Date()
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())} `
}

/** Each new line written to `stream` starts with the date and time. */
function stamp(stream: NodeJS.WriteStream) {
  const write = stream.write.bind(stream) as (chunk: string, cb?: (e?: Error | null) => void) => boolean
  let atStart = true
  stream.write = ((chunk: unknown, enc?: unknown, cb?: unknown) => {
    const done = (typeof enc === "function" ? enc : cb) as ((e?: Error | null) => void) | undefined
    if (typeof chunk !== "string" && !(chunk instanceof Uint8Array)) return write(chunk as string, done)
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(typeof enc === "string" ? (enc as BufferEncoding) : "utf8")
    if (!text) return write(text, done)
    const t = stampNow()
    let out = (atStart ? t : "") + text
    atStart = out.endsWith("\n")
    out = (atStart ? out.slice(0, -1) : out).replace(/\n/g, `\n${t}`) + (atStart ? "\n" : "")
    return write(out, done)
  }) as typeof stream.write
}

let started = false
/** Once, as the server starts (server.ts): timestamps on the log's lines, and its errors heard. */
export function startServerLog() {
  if (started) return
  started = true
  stamp(process.stdout)
  stamp(process.stderr)
  const error = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    error(...args)
    try { emit(errorOf(args)) } catch { /* never into the caller */ }
  }
  // A promise nothing waited on that failed (a plugin's fire-and-forget save): logged and heard, not the whole server
  // ended with every client's sockets, shells' links and asks.
  process.on("unhandledRejection", (e) => { console.error("Unhandled rejection:", e instanceof Error ? e : new Error(String(e))) })
  // Doesn't change what Node does for an exception (it still ends the process), so a crash is recorded and launchd still
  // restarts it.
  process.on("uncaughtExceptionMonitor", (e, origin) => {
    emit(errorOf([origin === "unhandledRejection" ? "Unhandled rejection:" : "Uncaught exception:", e instanceof Error ? e : new Error(String(e))], true))
  })
}
