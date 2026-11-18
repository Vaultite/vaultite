// A command, not an op: a hook must never fail its agent (a missing op exits 2, which a Stop hook reads as "don't stop").
import { CliError, done, type PluginCli } from "../../../core/cli.ts"

export const cli: PluginCli = {
  commands: [{
    name: "inbox",
    sub: "hook",
    after: "notify",
    summary: "An agent's hook: tells the Inbox what a coding agent started outside the app is doing (stopped, needs you).",
    usage: "vau inbox hook <agent> [<json>]",
    help: `Reads the hook's JSON from stdin, or from its last argument, and says which app terminal it ran in
($VAULTITE_TERMINAL). The app's own terminals need none. Never fails its agent: when the server is down, it does nothing.
  Claude Code (~/.claude/settings.json): "Stop" and "Notification" hooks running  vau inbox hook claude
  Codex (~/.codex/config.toml):          notify = ["vau", "inbox", "hook", "codex"]
(vau is the app's bin/vau: give its full path where vau isn't on PATH.)`,
    run: async (a, c) => {
      const agent = a._[0]
      if (!agent) throw new CliError("which agent: vau inbox hook <claude|codex|...>")
      // Codex passes its JSON as the last argument; Claude Code on stdin.
      let raw = a._.slice(1).join(" ").trim()
      if (!raw) raw = (await c.stdin(true).catch(() => "")).trim()
      let json: unknown = {}
      try { json = raw ? JSON.parse(raw) : {} } catch { json = {} }
      const q = new URLSearchParams({ agent })
      if (c.env.VAULTITE_TERMINAL) q.set("terminal", c.env.VAULTITE_TERMINAL)
      try { await c.call("POST", `inbox/hook?${q}`, json) } catch { /* the server isn't up, or the Inbox is off */ }
      return done({ ok: true }, "")
    },
  }],
}
