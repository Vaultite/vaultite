// What the app's own windows may do in the browser engine (the default session: its pages, another machine's window, the
// frames a note shows): only what the app needs, only for its own pages; another machine's asks before it hears or sees.
import path from "node:path"
import { fileURLToPath } from "node:url"

/** What the app's pages use: the recorder's microphone, an MCP card's camera and location, pasting, notifications. */
const APP = new Set(["media", "geolocation", "clipboard-read", "clipboard-sanitized-write", "notifications", "fullscreen", "pointerLock",
  "speaker-selection", "storage-access", "top-level-storage-access"])
/** What any page may, a video in a note going full screen or copying its link: nothing it reads or senses. */
const ANYONE = new Set(["fullscreen", "clipboard-sanitized-write"])
/** Of those, what another machine's window asks the user for first. */
const ASK = new Set(["media", "geolocation"])

/** Whose page asks: this app's (a server on this machine, its built pages), another machine's window (`remotes`: their
 *  addresses), or anyone else's (a frame in a note, a page a window was sent to). */
export function whose(url: string, remotes: string[], dist: string): "app" | "remote" | "other" {
  let u: URL
  try { u = new URL(url) } catch { return "other" }
  if (u.protocol === "file:") { try { const p = fileURLToPath(u); return p.startsWith(dist + path.sep) ? "app" : "other" } catch { return "other" } }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "other"
  if (u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)) return "app"
  return remotes.some((r) => { try { return new URL(r).origin === u.origin } catch { return false } }) ? "remote" : "other"
}

/** What a page gets when it asks for `perm`: given, asked of the user, or refused. */
export function permissionFor(perm: string, who: ReturnType<typeof whose>): "allow" | "ask" | "deny" {
  if (ANYONE.has(perm)) return "allow"
  if (who === "other" || !APP.has(perm)) return "deny"
  return who === "remote" && ASK.has(perm) ? "ask" : "allow"
}
