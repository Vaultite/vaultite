// The server's reads of the Talk key's press log (presslog.ts, userData/talk): a day's steps, a press's kept audio and
// its ask's picture (userData/screens), for the Companion page's Details. Reads only.
import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { pressLog } from "./presslog.ts"
import { objectOr, opt } from "./ipcwire.ts"
import { z } from "zod"

const dir = () => path.join(app.getPath("userData"), "talk")
const presses = pressLog(dir, "talk")
/** A press's audio at most (bytes): a long hands-free one isn't sent whole. */
const MOST = 4 * 1024 * 1024

const CALL = objectOr(z.object({ day: opt(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), press: z.string().regex(/^[\w-]+$/).catch(""), name: z.string().catch("") }))
export async function talkCall(name: string, args: unknown[]) {
  const o = CALL.parse(args[0])
  if (name === "talk:presses") return presses.read(o.day)
  if (name === "talk:audio") {
    const id = o.press
    try {
      const b = id ? fs.readFileSync(path.join(dir(), `${id}.wav`)) : null
      return b && b.length <= MOST ? { wav: b.toString("base64") } : { wav: null }
    } catch { return { wav: null } }
  }
  if (name === "talk:shot") {
    // (only the helper's own pictures of the screen, by name: nothing else on this Mac)
    const n = o.name
    if (!/^display-[\w-]+\.png$/.test(n)) return { png: null }
    try { const b = fs.readFileSync(path.join(app.getPath("userData"), "screens", n)); return { png: b.length <= MOST ? b.toString("base64") : null } } catch { return { png: null } }
  }
  throw new Error(`no talk call ${name}`)
}
