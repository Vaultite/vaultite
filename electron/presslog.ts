// What each press of a key did, a day at a time (the helper's Talk key: down, up, the recognizer, what was heard, the ask
// sent or why it wasn't; a realtime turn the same way), so a press that went nowhere can be traced. No Electron.
import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { Json } from "./linehelper.ts"

/** How many days of it are kept. */
const KEEP_DAYS = 14
const day = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}` }

/** A press under way: its steps, then how it ended (once; steps after its end are kept, marked late); `after`, what its
 *  ask led to once sent (its answer's first sound, a voice failing over). */
export type Press = { id: string; step: (ev: string, data?: Data) => void; end: (outcome: string, data?: Data) => void; ended: () => boolean
  after: (ev: string, data?: Data) => void }
type Data = { [k: string]: Json }
const LINE = z.looseObject({ t: z.number(), press: z.string(), kind: z.string(), ev: z.string(), ms: z.number() })

/** The log in `dir` (`<prefix>-<day>.jsonl`), each line `{t, press, kind, ev, ...}`; older days than KEEP_DAYS go. */
export function pressLog(dir: () => string, prefix = "presses", now = Date.now) {
  let n = 0, pruned = ""
  function write(line: z.input<typeof LINE> & Data) {
    try {
      const d = dir(), t = line.t, today = day(t)
      fs.mkdirSync(d, { recursive: true })
      fs.appendFileSync(path.join(d, `${prefix}-${today}.jsonl`), `${JSON.stringify(line)}\n`)
      if (pruned !== today) {
        pruned = today
        const oldest = day(t - KEEP_DAYS * 86_400_000)
        for (const f of fs.readdirSync(d)) { const m = new RegExp(`^${prefix}-(\\d{4}-\\d{2}-\\d{2})\\.jsonl$`).exec(f); if (m && m[1] < oldest) fs.rmSync(path.join(d, f), { force: true }) }
      }
    } catch { /* a log never stops a press */ }
  }
  return {
    /** A press of `kind` (talk, realtime...) begins: its first step `ev`. */
    start(kind: string, ev: string, data: Data = {}): Press {
      const t0 = now(), id = `${kind}-${t0.toString(36)}-${++n}`
      let over = false
      const put = (e: string, d: Data) => write({ t: now(), press: id, kind, ev: e, ms: now() - t0, ...d })
      put(ev, data)
      return {
        id,
        step: (e, d = {}) => put(e, over ? { ...d, late: true } : d),
        end: (outcome, d = {}) => { if (over) return; over = true; put("end", { outcome, ...d }) },
        ended: () => over,
        after: (e, d = {}) => put(e, d),
      }
    },
    /** A day's lines (`date`: YYYY-MM-DD), oldest first. */
    read(date = day(now())) {
      let text = ""
      try { text = fs.readFileSync(path.join(dir(), `${prefix}-${date}.jsonl`), "utf8") } catch { return [] }
      return text.split("\n").flatMap((l) => { try { return LINE.safeParse(JSON.parse(l)).data ?? [] } catch { return [] } })
    },
  }
}
