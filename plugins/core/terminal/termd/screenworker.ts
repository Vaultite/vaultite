import { parentPort, workerData } from "node:worker_threads"
import { Vt } from "../vt/vt.ts"
import { withPictures } from "./kitty.ts"
import type { CaptureFormat } from "./protocol.ts"

type In = { n: number; op: "write"; d: string } | { n: number; op: "resize"; cols: number; rows: number; cw: number; ch: number }
  | { n: number; op: "capture"; format: CaptureFormat; lines: number | null } | { n: number; op: "snapshot" } | { n: number; op: "text"; lines: number }

type Modes = { app: boolean; paste: boolean }
const { module, cols, rows, scrollback, modes: was } = workerData as { module: WebAssembly.Module; cols: number; rows: number; scrollback: number; modes?: Modes }
let title: string | undefined, reply = "", modes: Modes = was ?? { app: false, paste: false }
// Its program set its modes once and won't on a redraw: unpasted, an agent's long text came in ~1 KB pieces, most lost.
const make = (c: number, r: number, sb: number) => {
  const v = new Vt(module, { cols: c, rows: r, scrollback: sb, onTitle: (x) => { title = x }, onReply: (d) => { reply += d } })
  const set = `${modes.app ? "\x1b[?1h" : ""}${modes.paste ? "\x1b[?2004h" : ""}`
  if (set) v.write(set)
  return v
}
let t = make(cols, rows, scrollback)

function answer(m: In): unknown {
  switch (m.op) {
    case "write":
      try { t.write(m.d) } catch (e) {
        const was = t
        t = make(was.cols, was.rows, was.scrollback)
        return { failed: String((e as Error)?.message ?? e) }
      }
      return undefined
    case "resize": t.resize(m.cols, m.rows, m.cw, m.ch); return undefined
    case "capture": {
      const above = Math.min(t.length, m.lines === null ? t.length : Math.max(0, m.lines - t.rows))
      const head = { cols: t.cols, rows: t.rows, cursor: t.cursor, alternate: t.alternate, input: t.inputLine() }
      if (m.format === "vt") return { ...head, text: t.serialize(above) }
      if (m.format === "html") return { ...head, text: t.html(above) }
      return { ...head, text: t.text(m.lines) }
    }
    case "snapshot": return withPictures(t)
    case "text": return t.text(m.lines)
  }
}

parentPort!.on("message", (m: In) => {
  let out: unknown, error: string | undefined
  try { out = answer(m) } catch (e) { error = String((e as Error)?.message ?? e) }
  modes = { app: t.mode(1), paste: t.mode(2004) }
  const said = { n: m.n, ...modes, ...(out !== undefined ? { out } : {}), ...(error ? { error } : {}),
    ...(title !== undefined ? { title } : {}), ...(reply ? { reply } : {}) }
  title = undefined; reply = ""
  parentPort!.postMessage(said)
})
