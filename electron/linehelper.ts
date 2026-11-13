// A native helper speaking JSON lines (screen.swift, capture.swift, takeover.swift, appwindows.swift): started on its
// first ask and again after it dies; every ask answered, by it, its exit or a timeout. Its events go to `event`.
import { spawn, type ChildProcess } from "node:child_process"
import { z } from "zod"

export type Json = string | number | boolean | null | undefined | Json[] | { [k: string]: Json }
export type Call = { op: string; [k: string]: Json }
export type LineHelper = {
  ask: <S extends z.ZodType>(call: Call, answer: S, ms?: number) => Promise<z.output<S>>
  started: () => Promise<ChildProcess>
  running: () => boolean
  /** Asks it hasn't answered yet. */
  pending: () => number
  /** Its stdin ended (it gives back what it held), killed if it's still there 2 s on. */
  quit: () => void
}
const ANSWER = z.looseObject({ id: z.number() })
const FAILED = (why: string) => ({ ok: false, why })
export function lineHelper<E extends z.ZodType>(o: { binary: () => Promise<string>; events?: E; event?: (m: z.output<E>) => void; exited?: () => void; stderr?: "ignore" | "inherit"
  timeout?: { ms: number; why: string } }): LineHelper {
  let child: ChildProcess | null = null, starting: Promise<ChildProcess> | null = null, next = 1
  const waiting = new Map<number, (line: z.infer<typeof ANSWER> | ReturnType<typeof FAILED>) => void>()
  const failAll = () => { for (const done of waiting.values()) done(FAILED("helper")); waiting.clear() }
  const heard = (line: string) => {
    let json: unknown
    try { json = JSON.parse(line) } catch { return }
    const answer = ANSWER.safeParse(json)
    if (answer.success) { waiting.get(answer.data.id)?.(answer.data); waiting.delete(answer.data.id); return }
    const event = o.events?.safeParse(json)
    if (event?.success) o.event?.(event.data)
  }
  const started = (): Promise<ChildProcess> => {
    if (child && child.exitCode === null && !child.killed) return Promise.resolve(child)
    starting ??= o.binary().then((bin) => {
      const c = spawn(bin, [], { stdio: ["pipe", "pipe", o.stderr ?? "ignore"] })
      let buf = ""
      c.stdout!.on("data", (b: Buffer) => {
        buf += b.toString()
        for (let i; (i = buf.indexOf("\n")) >= 0;) {
          const line = buf.slice(0, i)
          buf = buf.slice(i + 1)
          heard(line)
        }
      })
      c.stdin!.on("error", () => {})
      // (one that couldn't start, or whose pipe broke, ends as one that exited: an unheard error would throw in main)
      let over = false
      const gone = () => {
        if (over) return
        over = true
        if (c.exitCode === null && !c.killed) c.kill()
        if (child !== c) return
        child = null
        failAll()
        o.exited?.()
      }
      c.on("error", gone)
      c.once("exit", gone)
      child = c
      return c
    }).finally(() => { starting = null })
    return starting
  }
  return {
    started,
    running: () => !!child,
    pending: () => waiting.size,
    async ask(call, answer, ms = o.timeout?.ms ?? 15_000) {
      const c = await started()
      const id = next++
      const line = await new Promise<z.infer<typeof ANSWER> | ReturnType<typeof FAILED>>((done) => {
        const timer = setTimeout(() => { if (waiting.delete(id)) done(FAILED(o.timeout?.why ?? "timeout")) }, ms)
        waiting.set(id, (m) => { clearTimeout(timer); done(m) })
        c.stdin!.write(JSON.stringify({ ...call, id }) + "\n")
      })
      return answer.parse(line)
    },
    quit() {
      const c = child
      child = null
      failAll()
      c?.stdin?.end()
      if (c) setTimeout(() => { if (c.exitCode === null) c.kill() }, 2000).unref()
    },
  }
}
