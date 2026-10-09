// The Inbox's part of vau. `vau inbox hook` stays a command because a hook must never fail its agent (an op missing
// would exit 2, which a Claude Code Stop hook reads as "don't stop"); a plugin command takes every `vau inbox ...`.
import { CliError, done, execute, type PluginCli } from "../../../core/cli.ts"

const SUBS: Record<string, string> = { "": "inbox.list", add: "inbox.add", read: "inbox.read", unread: "inbox.unread", clear: "inbox.clear",
  answer: "inbox.answer", push: "inbox.push", voice: "inbox.voice", report: "inbox.report", reply: "inbox.reply", done: "inbox.done" }

export const cli: PluginCli = {
  commands: [{
    name: "inbox",
    after: "notify",
    summary: "What's new in the inbox (results to review, agents' events); add a result; an agent's hook posts here.",
    usage: "vau inbox [add <title> [--body <text>] [--source <url>] [--from <who>] | report <title> --summary <text> | reply <path> <text> | done <path> [--title <title>] | hook <agent> [<json>] | read [<id>...] | unread <id>... | answer <id> <answer> | push <title> | voice <text> | clear]",
    help: `The Inbox: results to review (files in Inbox/, status new) and what coding agents said (events, kept on the
server's machine until read, then for a week: finished, waiting for you). Without a subcommand: both, newest first. The subcommands are
operations: vau inbox.add --help explains one (inbox.list, inbox.add, inbox.report, inbox.reply, inbox.done,
inbox.read, inbox.unread, inbox.answer, inbox.push, inbox.voice, inbox.clear).

  vau inbox                                   what's new
  vau inbox add "Plant care apps compared" --body "## Findings ..." --from Claude
  echo "## Findings" | vau inbox add "Plant care apps compared"
  vau inbox read                              mark every event read
  vau inbox read mg3k2a-1f9c0e                mark one read (ids: vau inbox)
  vau inbox unread mg3k2a-1f9c0e              mark one unread (seeing the Inbox won't read it again)
  vau inbox clear                             forget every event
  vau inbox report "Sidebar fixed" --summary "..." --questions "Ship it?" --images /tmp/after.png
                                              end a task you were handed: a report the user replies to
  vau inbox reply "Inbox/Sidebar fixed.md" "Yes, ship it"   the reply, typed into the agent's session
  vau inbox done "Inbox/Sidebar fixed.md"     archive a result (--title names it anew)

Hooks (for an agent started outside the app; the app's own terminals need none): \`vau inbox hook <agent>\` reads the
hook's JSON from stdin, or from its last argument, and says which app terminal it ran in ($VAULTITE_TERMINAL):
  Claude Code (~/.claude/settings.json): "Stop" and "Notification" hooks running  vau inbox hook claude
  Codex (~/.codex/config.toml):          notify = ["vau", "inbox", "hook", "codex"]
(vau is the app's bin/vau: give its full path where vau isn't on PATH.)`,
    run: async (a, c) => {
      const sub = a._[0] ?? ""
      if (sub === "hook") {
        const agent = a._[1]
        if (!agent) throw new CliError("which agent: vau inbox hook <claude|codex|...>")
        // Codex passes its JSON as the last argument; Claude Code on stdin.
        let raw = a._.slice(2).join(" ").trim()
        if (!raw) raw = (await c.stdin(true).catch(() => "")).trim()
        let json: unknown = {}
        try { json = raw ? JSON.parse(raw) : {} } catch { json = {} }
        const q = new URLSearchParams({ agent })
        if (c.env.VAULTITE_TERMINAL) q.set("terminal", c.env.VAULTITE_TERMINAL)
        // A hook never fails its agent: whatever happens here, it exits 0.
        try { await c.call("POST", `inbox/hook?${q}`, json) } catch { /* the server isn't up, or the Inbox is off */ }
        return done({ ok: true }, "")
      }
      const id = SUBS[sub]
      if (!id) throw new CliError(`no 'vau inbox ${sub}': ${Object.keys(SUBS).filter(Boolean).join(", ")} or hook (vau inbox --help)`)
      // The op, by its id, with this command line's words as given (a list's flag keeps all its values; add's body
      // piped in: its stdin param).
      const raw = a.raw ?? []
      const words = sub ? raw.slice(raw.indexOf(sub) + 1) : raw
      const r = await execute([id, ...words], { api: c.api, env: c.env, stdin: c.stdin, url: c.url })
      if (r.code !== 0) throw new CliError(r.err.replace(/^vau [^:]+: /, ""))
      return a.flags.json ? done(JSON.parse(r.out), "") : done(null, r.out)
    },
  }],
}
