// The server's reads of the Talk key's press log (presslog.ts, userData/talk): a day's steps and a press's kept audio,
// for the Companion page's Details. Reads only.
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
  throw new Error(`no talk call ${name}`)
}
