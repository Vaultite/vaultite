// A native helper speaking JSON lines (screen.swift, capture.swift, takeover.swift, appwindows.swift): started on its
// first ask and again after it dies; every ask answered, by it, its exit or a timeout. Its events go to `event`.
import { spawn, type ChildProcess } from "node:child_process"

export type LineHelper = {
  ask: <T = Record<string, unknown>>(call: Record<string, unknown>, ms?: number) => Promise<T>
  started: () => Promise<ChildProcess>
  running: () => boolean
  /** Asks it hasn't answered yet. */
  pending: () => number
  /** Its stdin ended (it gives back what it held), killed if it's still there 2 s on. */
  quit: () => void
}
export function lineHelper(o: { binary: () => Promise<string>; event?: (m: Record<string, unknown>) => void; exited?: () => void; stderr?: "ignore" | "inherit"; timeout?: { ms: number; why: string } }): LineHelper {
  let child: ChildProcess | null = null, starting: Promise<ChildProcess> | null = null, next = 1
  const waiting = new Map<number, (m: Record<string, unknown>) => void>()
  const failAll = () => { for (const done of waiting.values()) done({ ok: false, why: "helper" }); waiting.clear() }
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
          let m: Record<string, unknown>
          try { m = JSON.parse(line) } catch { continue }
          if (typeof m.id === "number") { waiting.get(m.id)?.(m); waiting.delete(m.id) }
          else if (typeof m.event === "string") o.event?.(m)
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
    async ask<T>(call: Record<string, unknown>, ms = o.timeout?.ms ?? 15_000): Promise<T> {
      const c = await started()
      const id = next++
      return new Promise<T>((done) => {
        const timer = setTimeout(() => { if (waiting.delete(id)) done({ ok: false, why: o.timeout?.why ?? "timeout" } as T) }, ms)
        waiting.set(id, (m) => { clearTimeout(timer); done(m as T) })
        c.stdin!.write(JSON.stringify({ ...call, id }) + "\n")
      })
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
