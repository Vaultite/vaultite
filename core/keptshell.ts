// A shell kept running for the scripts asked of it, one at a time: PowerShell takes seconds to start and run its first
// query (half a minute on an Arm machine), then answers each in milliseconds.
import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process"
import crypto from "node:crypto"
import type { Socket } from "node:net"

export type KeptShell = {
  /** What `script` printed, or null when it didn't finish within `timeout` ms (the shell is ended) or the shell ended. */
  ask(script: string, timeout: number): Promise<string | null>
  close(): void
}

/** `cmd args` reading a script a line on stdin (`echo(marker)` prints a marker after each): started when asked (`first`
 *  its first line), ended `idle` ms after its last answer or with this process (its stdin closes). */
export function keptShell(cmd: string, args: string[], o: { echo: (marker: string) => string; first?: string; idle?: number }): KeptShell {
  const MARK = `<<vaultite-${crypto.randomUUID()}>>`
  let child: ChildProcessWithoutNullStreams | null = null, queue: Promise<unknown> = Promise.resolve(), idle: NodeJS.Timeout | null = null
  let asked = 0
  const end = () => { const c = child; child = null; if (c && c.exitCode === null) { c.stdin.end(); c.kill() } }
  function start() {
    const c = spawn(cmd, args, { windowsHide: true })
    c.stdout.setEncoding("utf8")
    c.on("error", () => {})
    c.stdin.on("error", () => {})
    c.on("exit", () => { if (child === c) child = null })
    // (an idle shell doesn't keep this process alive; an answer awaited does, by its timeout)
    c.unref()
    for (const s of [c.stdin, c.stdout, c.stderr]) (s as unknown as Socket).unref?.()
    c.stderr.resume()
    if (o.first) c.stdin.write(`${o.first}\n`)
    return (child = c)
  }
  const once = (script: string, timeout: number) => new Promise<string | null>((resolve) => {
    const c = child ?? start()
    let out = ""
    const done = (text: string | null) => { clearTimeout(timer); c.stdout.off("data", data); c.off("exit", gone); resolve(text) }
    const data = (d: string) => { out += d; const at = out.indexOf(MARK); if (at >= 0) done(out.slice(0, at)) }
    const gone = () => done(null)
    const timer = setTimeout(() => { if (child === c) end(); done(null) }, timeout)
    c.stdout.on("data", data)
    c.once("exit", gone)
    c.stdin.write(`${script}; ${o.echo(MARK)}\n`)
  })
  return {
    ask(script, timeout) {
      if (idle) clearTimeout(idle)
      asked++
      const p = queue.then(() => once(script, timeout))
      queue = p.then(() => { if (--asked) return; idle = setTimeout(end, o.idle ?? 300_000); idle.unref() })
      return p
    },
    close() { if (idle) clearTimeout(idle); end() },
  }
}
