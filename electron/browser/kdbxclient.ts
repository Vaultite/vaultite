// Main's side of the passwords process: kept while unlocked, else ended, which clears the strings JavaScript can't zero.
import type { z } from "zod"
import { ANSWER, OPS, type Op } from "./kdbxwire.ts"

export type Child = {
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a message between processes: parsed by its reader
  postMessage: (m: unknown) => void
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- a message between processes: parsed by its reader
  onMessage: (fn: (m: unknown) => void) => void
  onExit: (fn: () => void) => void
  kill: () => void
}
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- an answer's value: parsed by its op
type Waiting = { ok: (value: unknown) => void; fail: (e: Error) => void }
type Running = { child: Child; waiting: Map<number, Waiting>; gone: Promise<void>; idle?: NodeJS.Timeout }

const LINGER_MS = 1000, SAVE_MS = 30_000

export class KdbxClient {
  private readonly start: () => Child
  private readonly crashed: () => void
  private readonly linger: number
  private now: Running | null = null
  private ending: Promise<void> = Promise.resolve()
  private open = false
  private locks = 0
  private asked = 0

  constructor(start: () => Child, crashed: () => void, linger = LINGER_MS) {
    this.start = start
    this.crashed = crashed
    this.linger = linger
  }

  running() { return this.now !== null }
  unlocked() { return this.open }

  async call<A extends z.ZodType, R extends z.ZodType>(op: Op<A, R>, args: z.input<A>): Promise<z.output<R>> {
    const at = this.locks
    for (let e: Promise<void> | null = null; e !== this.ending;) { e = this.ending; await e }
    const value = op.answer.parse(await this.post(this.now ??= this.begin(), op, args))
    if (op.name === OPS.unlock.name && at === this.locks) this.open = true
    return value
  }

  lock() {
    this.locks++
    this.open = false
    const r = this.now
    if (!r) return
    this.retire(r)
    this.post(r, OPS.lock, null).catch(() => {})
    const late = setTimeout(() => r.child.kill(), SAVE_MS)
    void r.gone.then(() => clearTimeout(late))
  }

  private post<A extends z.ZodType, R extends z.ZodType>(r: Running, op: Op<A, R>, args: z.input<A>) {
    clearTimeout(r.idle)
    const id = ++this.asked
    return new Promise<unknown>((ok, fail) => { r.waiting.set(id, { ok, fail }); r.child.postMessage({ id, op: op.name, args }) })
  }
  private begin(): Running {
    let left = () => {}
    const r: Running = { child: this.start(), waiting: new Map(), gone: new Promise((done) => { left = done }) }
    r.child.onMessage((raw) => {
      const m = ANSWER.safeParse(raw)
      const w = m.success ? r.waiting.get(m.data.id) : undefined
      if (!m.success || !w) return
      r.waiting.delete(m.data.id)
      if ("error" in m.data) w.fail(new Error(m.data.error)); else w.ok(m.data.value)
      // (after who asked heard it: an unlock is open by then)
      setImmediate(() => this.rest(r))
    })
    r.child.onExit(() => {
      left()
      this.ended(r)
    })
    return r
  }
  private ended(r: Running) {
    clearTimeout(r.idle)
    for (const w of r.waiting.values()) w.fail(new Error("the passwords process stopped"))
    r.waiting.clear()
    if (this.now !== r) return
    this.now = null
    if (this.open) this.crashed()
    this.open = false
  }
  private retire(r: Running) {
    clearTimeout(r.idle)
    this.now = null
    this.ending = r.gone
  }
  private rest(r: Running) {
    if (r.waiting.size) return
    if (this.now !== r) return r.child.kill()
    clearTimeout(r.idle)
    if (!this.open) r.idle = setTimeout(() => { this.retire(r); r.child.kill() }, this.linger)
  }
}
