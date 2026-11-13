export type Plain = {
  /** The reason in plain words ("the disk is full"), to follow "Couldn't …: "; null when there's none a person can act on. */
  reason: string | null
  /** A bug in the app's code or a plugin's (worth keeping in Errors), not the world saying no (a refusal, no network). */
  bug: boolean
  /** The exact text, for Details and the error log. */
  detail: string
}

const CODES: Record<string, string> = {
  ENOENT: "it isn't there anymore",
  EACCES: "Vaultite isn't allowed to open it",
  EPERM: "macOS didn't allow it",
  ENOSPC: "the disk is full",
  EDQUOT: "the disk is full",
  EEXIST: "something with that name is already there",
  ENOTEMPTY: "the folder isn't empty",
  EBUSY: "another app is using it",
  EROFS: "it's on a disk that can't be written",
  EMFILE: "too many files are open; try again in a moment",
  ENAMETOOLONG: "the name is too long",
  EISDIR: "it's a folder",
  ENOTDIR: "it isn't a folder",
  EADDRINUSE: "another app is using its port",
  ECONNREFUSED: "the server didn't answer",
  ECONNRESET: "the connection dropped",
  ETIMEDOUT: "the server didn't answer in time",
  ENOTFOUND: "that address wasn't found; check the network",
  EAI_AGAIN: "the network isn't reachable",
  ENETUNREACH: "the network isn't reachable",
}
const NETWORK = /^(Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.?|The server didn't answer|The network connection was lost\.?|net::ERR_[A-Z_]+)/i
const ENGINE = new Set(["TypeError", "ReferenceError", "SyntaxError", "RangeError", "EvalError", "URIError", "AggregateError", "InternalError"])
const ENGINE_TEXT = /\b(undefined|null|NaN)\b|is not (a function|a constructor|defined|iterable)|Cannot (read|set|access) propert|Unexpected (token|end of)|Maximum call stack|out of memory|\bat \S+ \(|\w+\.(js|ts|tsx|mjs):\d+|\b[A-Z][A-Za-z]*(Error|Exception):|\bERR_[A-Z_]{3,}\b/
const DUMP = /\berrno\b|\bexit (code )?-?\d+|[{}<>]|=>/

/** Electron's wrapping of an error from the main process ("Error invoking remote method 'x': Error: …"). */
const unwrap = (s: string) => s.replace(/^Error invoking remote method '[^']+': /, "").replace(/^Error: /, "")

/** An error, a rejection's reason or a message, as it should reach a person. */
export function plainError(e: unknown): Plain {
  const o = (typeof e === "object" && e !== null ? e : {}) as { name?: unknown; message?: unknown; status?: unknown; code?: unknown; stack?: unknown }
  const raw = typeof e === "string" ? e : typeof o.message === "string" ? o.message : String(e ?? "")
  const name = typeof o.name === "string" ? o.name : ""
  const text = unwrap(raw).trim()
  const detail = typeof o.stack === "string" && o.stack.includes(text) ? o.stack : `${name && name !== "Error" && !raw.startsWith(name) ? `${name}: ` : ""}${raw}`
  const status = typeof o.status === "number" ? o.status : 0
  if (NETWORK.test(text)) return { reason: "the server didn't answer", bug: false, detail }
  // (a code first: one an error carries, or Node's in its text: "EACCES: permission denied, open '…'", "spawn ENOENT")
  const code = (typeof o.code === "string" && o.code) || [...text.matchAll(/\b(E[A-Z]{3,}[A-Z_]*)\b/g)].map((m) => m[1]).find((c) => CODES[c]) || ""
  if (CODES[code]) return { reason: CODES[code], bug: false, detail }
  const refusal = status >= 400 && status < 500
  const technical = !text || ENGINE.has(name) || text.includes("\n") || /\bE[A-Z]{3,}:/.test(text) || ENGINE_TEXT.test(text) ||
    !refusal && (text.length > 200 || DUMP.test(text))
  if (technical) return { reason: null, bug: true, detail }
  return { reason: text.replace(/\.$/, ""), bug: false, detail }
}

export const sentence = (reason: string) => `${reason[0].toUpperCase()}${reason.slice(1)}${/[.?!]$/.test(reason) ? "" : "."}`

export function plainText(e: unknown, what?: string) {
  const { reason } = plainError(e)
  return what ? (reason ? `${what}: ${reason}.` : `${what}.`) : reason ? sentence(reason) : "Something went wrong."
}
