import fs from "node:fs"
import path from "node:path"
import { writeAtomic } from "../../../core/vault.ts"
import { dir, MAX, plugin, TERMINAL } from "./server.ts"

// Terminals handed a task to do alone (a dispatch, a voice note, a reply's session): the turn that reports is their
// last, then the terminal ends (a reply resumes the session, or starts a new one). Kept here: terminals outlive a restart.
const handedFile = () => path.join(dir(), "handed.json")
export function handed(): string[] {
  try {
    const v = JSON.parse(fs.readFileSync(handedFile(), "utf8"))
    return Array.isArray(v) ? v.filter((t) => typeof t === "string") : []
  } catch { return [] }
}
export function hand(terminal: string, on = true) {
  if (!TERMINAL.test(terminal)) return
  const all = handed().filter((t) => t !== terminal)
  if (on) all.push(terminal)
  fs.mkdirSync(dir(), { recursive: true })
  writeAtomic(handedFile(), JSON.stringify(all.slice(-MAX)))
}

/** Handed terminals that reported, by when: their turn's end (the hook's Stop) ends them. A turn ends in minutes. */
export const ending = new Map<string, number>()
const ENDING = 30 * 60_000

const endingSoon = new Map<string, ReturnType<typeof setTimeout>>()
/** A handed terminal whose turn reported: it ends, once the agent has written it down. */
export function endHanded(terminal: string) {
  const at = terminal ? ending.get(terminal) : undefined
  if (at === undefined) return
  ending.delete(terminal)
  if (Date.now() - at >= ENDING) return
  hand(terminal, false)
  clearTimeout(endingSoon.get(terminal))
  endingSoon.set(terminal, setTimeout(() => { endingSoon.delete(terminal); void plugin.runOp("terminal.end", { id: terminal, keepTabs: true }).catch(() => {}) }, 2000))
}
/** A reply goes to `terminal`: the end its last report set off (with that turn's end, or about to) is called off; still
 *  handed, it ends once it reports again. */
export function keepHanded(terminal: string) {
  ending.delete(terminal)
  const t = endingSoon.get(terminal)
  if (t) { clearTimeout(t); endingSoon.delete(terminal) }
}

