// The tmux backend: each shell a `vau-<id>` session on `tmux -L vaultite` (`-<port>` off the default port), with a
// client per shell held by the server, so a restart kills only clients. Used when chosen, and by shells started there.
import { execFile } from "node:child_process"
import fs from "node:fs"
import { quote } from "../../../core/codingagents.ts"
import { outliving, runtimeDir } from "../../../core/plugins.ts"
import os from "node:os"
import path from "node:path"
import { loadPty, ptyLink, shellArgs, type Backend, type Link } from "./backend.ts"

export const TMUX = ["/opt/homebrew/bin/tmux", "/usr/local/bin/tmux", "/usr/bin/tmux"].find((p) => fs.existsSync(p)) ?? ""
const PREFIX = "vau-" // tmux session names: vau-<id>

/** `name`: vaultite, or vaultite-<port>. */
export function tmuxBackend(name: string, o: { conf: string; env: () => Record<string, string> }): Backend | null {
  if (!TMUX) return null
  const SOCKET = name
  // A shell's exit status, written by the command tmux runs (the tmux client itself always exits 0).
  const STATUS_DIR = path.join(runtimeDir(), "vaultite-terminal")
  const statusFile = (id: string) => path.join(STATUS_DIR, `${id}.exit`)

  const tmux = (...args: string[]) => new Promise<string>((resolve, reject) =>
    execFile(TMUX, ["-L", SOCKET, "-f", o.conf, ...args], { timeout: 5000, env: o.env() }, (err, stdout) => (err ? reject(err) : resolve(stdout))))
  const pane = (id: string) => `=${PREFIX}${id}:` // its pane (a bare =name only names the session)
  const hasSession = (id: string) => tmux("has-session", "-t", `=${PREFIX}${id}`).then(() => true, () => false)

  /** What tmux runs for a shell: through sh, which writes the shell's exit status, named after the tmux session it's in
   *  when it ends (a ready shell is renamed when it's taken). */
  const tmuxCommand = (sh: string, args: string[]) => ["/bin/sh", "-c",
    `"$0" "$@"; s=$?; n=$(${quote(TMUX)} -S "\${TMUX%%,*}" display-message -p -t "$TMUX_PANE" '#{session_name}' 2>/dev/null); ` +
    `echo $s > ${quote(STATUS_DIR)}/"\${n#${PREFIX}}.exit"`, sh, ...args]
  /** Vaultite's variables for new-session (-e). PATH can't go this way (tmux gives a new session's command the PATH of
   *  the client that made it), so it's the client's own. */
  const tmuxVars = (ctx: Record<string, string>) => Object.entries(ctx).filter(([k]) => k !== "PATH").flatMap(([k, v]) => ["-e", `${k}=${v}`])

  /** Scrolling from the page as a terminal's wheel would: mouse-reporting programs get wheel events, full-screen ones
   *  arrows, a shell tmux's history (copy mode). Typing first leaves copy mode: input waits in `queue`. */
  function scroller(id: string, write: (b: Buffer) => void) {
    let left = 0, scrolling = false, scrolled = false, queue = Promise.resolve()
    const target = pane(id)
    return {
      async scroll(lines: number) {
        left += lines
        if (scrolling) return
        scrolling = true
        try {
          while (left) {
            const n = Math.max(-500, Math.min(500, left)), count = String(Math.abs(n))
            left -= n
            const [inMode, mouse, sgr, alt, width, height] = (await tmux("display-message", "-p", "-t", target,
              "#{pane_in_mode} #{mouse_any_flag} #{mouse_sgr_flag} #{alternate_on} #{pane_width} #{pane_height}")).trim().split(" ").map(Number)
            if (inMode) await tmux("send-keys", "-t", target, "-X", "-N", count, n > 0 ? "scroll-up" : "scroll-down")
            else if (mouse) {
              // Wheel up (64) or down (65) at the pane's middle, in the encoding it asked for.
              const button = n > 0 ? 64 : 65, x = Math.ceil(width / 2), y = Math.ceil(height / 2)
              const report = sgr ? `\x1b[<${button};${x};${y}M` : `\x1b[M${String.fromCharCode(32 + button, 32 + x, 32 + y)}`
              const hex = [...Buffer.from(report.repeat(Math.min(Math.abs(n), 100)), "latin1")].map((c) => c.toString(16).padStart(2, "0"))
              await tmux("send-keys", "-t", target, "-H", ...hex)
            } else if (alt) await tmux("send-keys", "-t", target, "-N", count, n > 0 ? "Up" : "Down")
            else if (n > 0) {
              await tmux("copy-mode", "-e", "-t", target)
              await tmux("send-keys", "-t", target, "-X", "-N", count, "scroll-up")
              scrolled = true
            }
          }
        } catch { left = 0 } finally { scrolling = false }
      },
      write(buf: Buffer) {
        if (scrolled) {
          scrolled = false
          queue = queue.then(() => tmux("send-keys", "-t", target, "-X", "cancel").then(() => {}, () => {}))
        }
        queue = queue.then(() => write(buf))
      },
    }
  }

  return {
    name: "tmux", label: "tmux", redraws: true, spares: true,
    ready: async () => true,
    has: hasSession,
    async list() {
      let text = ""
      try { text = await tmux("list-sessions", "-F", "#{session_name}\t#{session_created}\t#{pane_current_command}\t#{session_attached}\t#{pane_title}\t#{pane_pid}\t#{session_activity}") } catch { return [] } // no server yet
      return text.split("\n").flatMap((line) => {
        const [sname, created, command = "", attached = "0", title = "", pid = "", activity = ""] = line.split("\t")
        if (!sname?.startsWith(PREFIX)) return []
        return [{ id: sname.slice(PREFIX.length), pid: Number(pid) || undefined, process: command, created: Number(created) * 1000 || 0,
          activity: Number(activity) * 1000 || undefined, attached: Number(attached) || 0, title }]
      })
    },
    async create(id, spec, c) {
      try { fs.mkdirSync(STATUS_DIR, { recursive: true }); fs.rmSync(statusFile(id), { force: true }) } catch { /* reported as a clean exit */ }
      const args = ["new-session", "-d", "-s", `${PREFIX}${id}`, "-x", String(spec.cols), "-y", String(spec.rows), "-c", spec.run?.cwd || spec.cwd,
        ...tmuxVars(spec.ctx), ...tmuxCommand(spec.shell, shellArgs(spec.shell, c?.spare ? null : spec.run))]
      // (new-session may start tmux's server, which must outlive a systemd unit's restart: outliving)
      const [cmd, argv] = outliving(TMUX, ["-L", SOCKET, "-f", o.conf, ...args], `tmux-${SOCKET}`)
      await new Promise<void>((resolve, reject) => execFile(cmd, argv, { timeout: 5000, env: { ...spec.env, PATH: spec.ctx.PATH } },
        (err) => (err ? reject(err) : resolve())))
    },
    async attach(id, cols, rows): Promise<Link> {
      const lib = await loadPty()
      try { fs.rmSync(statusFile(id), { force: true }) } catch { /* none */ }
      const p = lib.spawn(TMUX, ["-L", SOCKET, "-f", o.conf, "attach-session", "-t", `=${PREFIX}${id}`],
        { name: "xterm-256color", cols, rows, cwd: os.homedir(), env: o.env() })
      const raw = (b: Buffer) => { try { p.write(b as unknown as string) } catch { /* ended */ } }
      const sc = scroller(id, raw)
      return ptyLink(p, {
        write: (b) => sc.write(b),
        scroll: (n) => void sc.scroll(n),
        // tmux redraws its screen for this client (the replay can end mid-screen).
        redraw: () => {
          tmux("list-clients", "-F", "#{client_pid} #{client_tty}").then((out) => {
            const tty = out.split("\n").find((l) => l.startsWith(`${p.pid} `))?.split(" ")[1]
            if (tty) return tmux("refresh-client", "-t", tty)
          }).catch(() => {})
        },
        // The tmux client ended. The shell's status, if it exited; neither that nor the session there, a clean end
        // (killed: plugin.ts says SIGHUP); the session still there (the client was killed), null: reattach.
        exit: async () => {
          let status = ""
          try { status = fs.readFileSync(statusFile(id), "utf8").trim(); fs.rmSync(statusFile(id), { force: true }) } catch { /* none */ }
          if (status) return { code: Number(status) || 0, signal: 0 }
          return (await hasSession(id)) ? null : { code: 0, signal: 0 }
        },
      })
    },
    kill: async (id) => { await tmux("kill-session", "-t", `=${PREFIX}${id}`).catch(() => {}) },
    async rename(from, to) {
      await tmux("rename-session", "-t", `=${PREFIX}${from}`, `${PREFIX}${to}`)
      // Its id, for what starts in it from now on (another pane; an agent typed into it): the shell started without it.
      await tmux("set-environment", "-t", `=${PREFIX}${to}`, "VAULTITE_TERMINAL", to).catch(() => {})
    },
    async screen(id, lines) {
      // The visible screen plus `lines` above it, wrapped lines joined.
      const height = Number((await tmux("display-message", "-p", "-t", pane(id), "#{pane_height}")).trim()) || 24
      return tmux("capture-pane", "-p", "-J", "-t", pane(id), "-S", String(-Math.max(0, lines - height)))
    },
    clearHistory: async (id) => { await tmux("clear-history", "-t", pane(id)).catch(() => {}) },
    async send(id, text, enter) {
      if (text) await tmux("send-keys", "-t", pane(id), "-l", "--", text)
      if (enter) { if (text) await new Promise((r) => setTimeout(r, 150)); await tmux("send-keys", "-t", pane(id), "Enter") }
    },
  }
}
