import { z } from "zod"
import { CliError, done, type PluginCli } from "../../../core/cli.ts"

const Waited = z.looseObject({ met: z.string().nullish(), timedOut: z.boolean().optional(),
  exit: z.looseObject({ code: z.number(), signal: z.number(), lost: z.boolean().optional() }).nullish() })
const Got = z.looseObject({ id: z.string().optional(), ended: z.boolean().optional(), exit: Waited.shape.exit })
// 124 when the time ran out, as timeout(1) exits; 128 + a signal's number, as a shell reports one.
const waitCode = (r: z.infer<typeof Waited> | undefined) => {
  if (!r || r.met === undefined) return 0
  if (r.met === "exit" && r.exit) return r.exit.lost ? 1 : r.exit.signal ? 128 + r.exit.signal : r.exit.code & 255
  if (r.timedOut) return 124
  return r.met ? 0 : 1
}

const DETACH = 0x1c

export const cli: PluginCli = {
  ops: {
    "terminal.wait": { code: (r) => waitCode(Waited.safeParse(r).data) },
    "terminal.start": { code: (r) => waitCode(Waited.safeParse(r).data) },
    "terminal.send": { code: (r) => waitCode(Waited.safeParse(r).data) },
  },
  commands: [{
    name: "terminal",
    sub: "attach",
    summary: "Attach this terminal to one of the app's terminals (⌃\\ detaches, leaving it running): shells, agents, another machine's.",
    usage: "vau terminal attach <terminal>",
    help: `Shows one of the app's terminals here and types into it, as its tab does: the screen and the history it keeps
come first, then what it prints; this terminal's size is its size while you type here (the last device used sets it).
⌃\\ detaches: it goes on running, in the app and in its tabs. The terminal is named as every terminal op names it: its
id, its name or the end of its id, <id>@<machine> for another machine's (through this server).

  vau terminal attach claude-k3j2h1g0
  vau terminal attach "Release notes"
  vau terminal attach h1g0@studio`,
    run: async (a, c) => {
      const given = a._[0]
      if (!given) throw new CliError("which terminal? vau terminal attach <id or name> (vau terminal lists them)", true)
      if (!process.stdin.isTTY || !process.stdout.isTTY) throw new CliError("attach needs a terminal: run it in one, not piped")
      const got = Got.parse(await c.call("POST", "ops/terminal.get", { id: given }))
      if (!got.id) throw new CliError(`no terminal '${given}'`)
      if (got.ended) throw new CliError(`${got.id} ended${got.exit ? ` (exit code ${got.exit.code})` : ""}: vau terminal capture ${got.id} shows what it left`)
      const id = got.id
      const { WebSocket } = await import("ws")
      const out = process.stdout, input = process.stdin
      const size = () => ({ cols: out.columns || 80, rows: out.rows || 24 })
      const q = new URLSearchParams({ cols: String(size().cols), rows: String(size().rows), attach: "1" })
      const ws = new WebSocket(`${c.url.replace(/^http/, "ws")}/api/terminal/${encodeURIComponent(id)}?${q}`, { headers: { "X-Vaultite-Client": "cli" } })
      const code = await new Promise<number>((resolve, reject) => {
        let said = "", raw = false
        let shell = size()
        const restore = () => {
          if (raw) { try { input.setRawMode(false) } catch {} raw = false }
          input.pause()
          input.off("data", typed)
          process.off("SIGWINCH", resized)
          // (out of the alternate screen and the modes a program there left on: mouse, bracketed paste, a hidden cursor)
          out.write("\x1b[?1049l\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l\x1b[?2004l\x1b[?25h\x1b[0m\r\n")
        }
        const typed = (d: Buffer) => {
          if (d.length === 1 && d[0] === DETACH) { said = `Detached from ${id}: it's still running (vau terminal attach ${id} again).`; ws.close(1000); return }
          const mine = size()
          if (mine.cols !== shell.cols || mine.rows !== shell.rows) resized()
          if (ws.readyState === ws.OPEN) ws.send(d, { binary: true })
        }
        const resized = () => { if (ws.readyState === ws.OPEN) { shell = size(); ws.send(JSON.stringify({ t: "resize", ...shell })) } }
        let exit = 0
        ws.on("open", () => {
          input.setRawMode(true); raw = true
          input.resume()
          input.on("data", typed)
          process.on("SIGWINCH", resized)
        })
        ws.on("message", (data: Buffer, binary: boolean) => {
          if (binary) { out.write(data); return }
          let m: { t?: string; code?: number; signal?: number; reason?: string; label?: string; ended?: boolean; lost?: boolean; cols?: number; rows?: number }
          try { m = JSON.parse(String(data)) } catch { return }
          if (m.t === "size") shell = { cols: Number(m.cols) || 0, rows: Number(m.rows) || 0 }
          if (m.t === "attached") out.write("\x1b[H\x1b[2J\x1b[3J")
          else if (m.t === "exit" && m.lost) { exit = 1; said = `${id} was lost: its terminal server went away.` }
          else if (m.t === "exit") { exit = m.signal ? 128 + m.signal : (m.code ?? 0) & 255; said = `${id} ended${m.ended ? "" : ` (${m.signal ? `signal ${m.signal}` : `exit code ${m.code ?? 0}`})`}.` }
          else if (m.t === "gone") said = `${id}'s session is gone.`
          else if (m.t === "refused" || m.t === "unreachable") { said = `${m.label ? `${m.label} ` : ""}${m.reason ?? "refused"}`; exit = 1 }
        })
        let failed = false
        ws.on("close", () => {
          if (failed) return
          restore()
          if (!said) { said = `Connection lost: ${id} may still be running (vau terminal attach ${id} again).`; exit = 1 }
          out.write(`${said}\r\n`)
          resolve(exit)
        })
        ws.on("error", (e) => { failed = true; restore(); reject(new CliError(`can't reach ${c.url}: ${e.message}`)) })
      })
      return { ...done({ id, code }, ""), code }
    },
  }],
}
