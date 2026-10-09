// Line diffs of any size for plugins (File history): core/linediff.ts, in a worker when there are many lines, so the
// app never waits on one.
import { diffLines as diffNow } from "../../../core/linediff.ts"
import type { Opcode } from "../../../core/textedit.ts"

/** Past this many lines in all, the diff is made in the worker. */
const BIG = 20_000

let worker: Worker | null = null, asked = 0

/** How to turn a into b (textedit's opcodes), never a wrong diff at any size. */
export function diffLines(a: string[], b: string[]): Promise<Opcode[]> {
  if (a.length + b.length <= BIG) return Promise.resolve(diffNow(a, b))
  const w = worker ??= new Worker(new URL("./diff.worker.ts", import.meta.url), { type: "module" })
  const id = ++asked
  return new Promise((done, fail) => {
    const on = (e: MessageEvent<{ id: number; ops: Opcode[] }>) => {
      if (e.data.id !== id) return
      w.removeEventListener("message", on); w.removeEventListener("error", err)
      done(e.data.ops)
    }
    const err = (e: ErrorEvent) => { w.removeEventListener("message", on); w.removeEventListener("error", err); fail(new Error(e.message)) }
    w.addEventListener("message", on)
    w.addEventListener("error", err)
    w.postMessage({ id, a, b })
  })
}
