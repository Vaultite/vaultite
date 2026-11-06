// The server's reads of the Talk key's press log (presslog.ts, userData/talk): a day's steps, a press's kept audio and
// its ask's picture (userData/screens), for the Companion page's Details. Reads only.
import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { pressLog } from "./presslog.ts"

const dir = () => path.join(app.getPath("userData"), "talk")
const presses = pressLog(dir, "talk")
/** A press's audio at most (bytes): a long hands-free one isn't sent whole. */
const MOST = 4 * 1024 * 1024

export async function talkCall(name: string, args: unknown[]) {
  const o = (args[0] && typeof args[0] === "object" ? args[0] : {}) as { day?: unknown; press?: unknown }
  if (name === "talk:presses") return presses.read(typeof o.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.day) ? o.day : undefined)
  if (name === "talk:audio") {
    const id = typeof o.press === "string" && /^[\w-]+$/.test(o.press) ? o.press : ""
    try {
      const b = id ? fs.readFileSync(path.join(dir(), `${id}.wav`)) : null
      return b && b.length <= MOST ? { wav: b.toString("base64") } : { wav: null }
    } catch { return { wav: null } }
  }
  if (name === "talk:shot") {
    // (only the helper's own pictures of the screen, by name: nothing else on this Mac)
    const n = typeof (o as { name?: unknown }).name === "string" ? (o as { name: string }).name : ""
    if (!/^display-[\w-]+\.png$/.test(n)) return { png: null }
    try { const b = fs.readFileSync(path.join(app.getPath("userData"), "screens", n)); return { png: b.length <= MOST ? b.toString("base64") : null } } catch { return { png: null } }
  }
  throw new Error(`no talk call ${name}`)
}
