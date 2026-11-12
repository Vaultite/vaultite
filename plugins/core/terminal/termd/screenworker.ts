// One terminal's screen and history (libghostty-vt), in a thread of its own (screen.ts): what the terminal server asks of
// it, answered in order. Each message is answered with its number, so screen.ts knows what's done and since when one isn't.
import { parentPort, workerData } from "node:worker_threads"
import { Vt } from "../vt/vt.ts"
import { withPictures } from "./kitty.ts"
import type { CaptureFormat } from "./protocol.ts"

type In = { n: number; op: "write"; d: string } | { n: number; op: "resize"; cols: number; rows: number; cw: number; ch: number }
  | { n: number; op: "capture"; format: CaptureFormat; lines: number | null } | { n: number; op: "snapshot" } | { n: number; op: "text"; lines: number }

const { module, cols, rows, scrollback } = workerData as { module: WebAssembly.Module; cols: number; rows: number; scrollback: number }
let title: string | undefined, reply = ""
const make = (c: number, r: number, sb: number) => new Vt(module, { cols: c, rows: r, scrollback: sb, onTitle: (t) => { title = t }, onReply: (d) => { reply += d } })
let t = make(cols, rows, scrollback)

function answer(m: In): unknown {
  switch (m.op) {
    case "write":
      try { t.write(m.d) } catch (e) {
        // (libghostty-vt failed on it: a blank screen from here)
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
  const said = { n: m.n, app: t.mode(1), paste: t.mode(2004), ...(out !== undefined ? { out } : {}), ...(error ? { error } : {}),
    ...(title !== undefined ? { title } : {}), ...(reply ? { reply } : {}) }
  title = undefined; reply = ""
  parentPort!.postMessage(said)
})
