// Files from outside the vault, opened in the desktop app: tabs like any file but not indexed. Only paths the desktop
// app allowed over IPC (never a URL) can be read or written, so the web version answers 404 for every absolute path.
import fs from "node:fs"
import path from "node:path"
import { kindOf, tooBig } from "./filetypes.ts"
import { HTTPError, reply } from "./plugins.ts"
import { merge3 } from "./textedit.ts"
import { applyEdit, textHash } from "./texthash.ts"
import { readText, writeText } from "./vault.ts"

const allowed = new Set<string>()

const real = (p: string) => {
  try {
    return fs.realpathSync(p)
  } catch {
    return path.resolve(p)
  }
}

/** Let the app open these files (from the desktop app's main process only). */
export function allow(paths: unknown) {
  if (!Array.isArray(paths)) return
  for (const p of paths) if (typeof p === "string" && path.isAbsolute(p)) allowed.add(real(p))
}

/** An absolute path, never a vault one (which can't have ":" or "\\"): /x, or Windows' C:/x, C:\x and \\server\x. */
export const isOutside = (p: unknown) => typeof p === "string" && /^(\/|[a-z]:[\\/]|\\\\)/i.test(p)

function check(p: string) {
  if (!allowed.has(real(p))) throw new HTTPError(404, `no file '${p}'`)
  return p
}

/** An outside path the app may read (its bytes, its info), or a 404. */
export const allowedPath = (p: string) => check(p)

/** GET /api/file/info for an allowed outside path: its size and dates, like a vault file's (core/files.ts). */
export function info(p: string) {
  check(p)
  let st: fs.Stats
  try {
    st = fs.statSync(p)
  } catch {
    throw new HTTPError(404, `no file '${p}'`)
  }
  if (!st.isFile()) throw new HTTPError(400, `'${p}' is a folder`)
  return { path: p, kind: kindOf(p), size: st.size, mtime: Math.floor(st.mtimeMs), ctime: Math.floor(st.birthtimeMs || st.mtimeMs) }
}

function read(p: string) {
  let text: string, st: fs.Stats
  try {
    st = fs.statSync(p)
    text = readText(p)
    if (text.includes("\0")) throw new TypeError("binary")
  } catch (e) {
    if (e instanceof HTTPError) throw e
    if (tooBig(e)) throw new HTTPError(413, `'${p}' is too big to open as text`)
    if (e instanceof TypeError) throw new HTTPError(415, `'${p}' isn't text`)
    throw new HTTPError(404, `no file '${p}'`)
  }
  return { path: p, text, mtime: Math.floor(st.mtimeMs), kind: null, problems: [], outside: true }
}

/** GET and PUT /api/file for an allowed outside path. */
export function handle(method: string, p: string, body: { text?: unknown; base?: unknown; baseHash?: unknown; edit?: unknown }) {
  check(p)
  if (method === "GET") return read(p)
  if (method !== "PUT") throw new HTTPError(405, "files outside the vault can only be read and saved")
  let cur: string | null
  try {
    cur = readText(p)
  } catch {
    cur = null
  }
  const base = typeof body.base === "string" ? body.base : null, baseHash = typeof body.baseHash === "string" ? body.baseHash : null
  if (cur === null && (base !== null || baseHash !== null)) throw new HTTPError(404, `${p} isn't there any more (moved or deleted)`)
  // An editor's save is its edit of the base and the base's fingerprint, as in the vault (core/files.ts PUT): the
  // base itself only when the file changed on disk, to merge.
  let text: string
  if (body.edit !== undefined) {
    if (cur !== null && baseHash !== null && textHash(cur) !== baseHash) return reply(412, { error: "the file changed on disk: send its base to merge" })
    const made = cur !== null && baseHash !== null ? applyEdit(cur, body.edit) : null
    if (made === null) throw new HTTPError(400, "edit is {at, cut, add}, an edit of the text whose baseHash is sent")
    text = made
  } else if (typeof body.text === "string") text = body.text
  else throw new HTTPError(400, "text must be a string")
  if (cur !== null && base !== null && cur !== base && cur !== text) {
    const merged = merge3(base, text, cur)
    if (merged === null) return reply(409, { error: "the file changed on disk in the same place", ...read(p) })
    text = merged
  }
  if (cur !== text) writeText(p, text)
  return read(p)
}
