// The Inbox's part of vau. `vau inbox hook` stays a command because a hook must never fail its agent (an op missing
// would exit 2, which a Claude Code Stop hook reads as "don't stop"); a plugin command takes every `vau inbox ...`.
import { CliError, done, execute, type PluginCli } from "../../../core/cli.ts"

const SUBS: Record<string, string> = { "": "inbox.list", add: "inbox.add", read: "inbox.read", unread: "inbox.unread", clear: "inbox.clear",
  answer: "inbox.answer", push: "inbox.push", voice: "inbox.voice", report: "inbox.report", ask: "inbox.ask", decide: "inbox.decide",
  decisions: "inbox.decisions", reports: "inbox.reports", progress: "inbox.progress", reply: "inbox.reply", settle: "inbox.settle", done: "inbox.done", snooze: "inbox.snooze", wake: "inbox.wake", pin: "inbox.pin", hold: "inbox.hold" }

export const cli: PluginCli = {
  commands: [{
    name: "inbox",
    after: "notify",
    summary: "What's new in the inbox (decisions waiting on you, agents' sessions that need you, results to review, events); ask or answer a decision; an agent's hook posts here.",
    usage: "vau inbox [add <title> [--body <text>] [--source <url>] [--from <who>] | report <title> --tldr <line> --summary <text> [--decision <q | a* | b>] | ask <question> --options <a> <b> --default <a> | decide <path> <answer> | decide --defaults | decisions | reports [--since <when>] | progress <line> | reply <path|id> <text> | settle <path|id> [--title <title>] | snooze <path|id> --until <when> | wake <path|id> | pin <path|id> [--off] | hold <until|off> [--label <what>] | hook <agent> [<json>] | read [<id>...] | unread <id>... | answer <id> <approve|deny|reply|read> [--text <text>] | push <title> | voice <text> | clear]",
    help: `The Inbox is for decisions: each question an agent asks is its own item (a file in Inbox/), its options as
buttons and the default it takes if unanswered; agents' sessions while they need you (an approval, an answer to read);
results to review (status new). Reports are records: archived as they come, listed in the morning brief (vau inbox
reports). Progress is a session's own row (vau inbox progress), never the inbox. Without a subcommand: all of it. The
subcommands are operations: vau inbox.add --help explains one (inbox.list, inbox.add, inbox.report, inbox.ask,
inbox.decide, inbox.decisions, inbox.reports, inbox.progress, inbox.reply, inbox.settle, inbox.snooze, inbox.wake,
inbox.pin, inbox.hold, inbox.read, inbox.unread, inbox.answer, inbox.push, inbox.voice, inbox.clear).

  vau inbox                                   what's new
  vau inbox add "Plant care apps compared" --body "## Findings ..." --from Claude
  echo "## Findings" | vau inbox add "Plant care apps compared"
  vau inbox read                              mark every event read
  vau inbox read mg3k2a-1f9c0e                mark one read (ids: vau inbox)
  vau inbox unread mg3k2a-1f9c0e              mark one unread (seeing the Inbox won't read it again)
  vau inbox clear                             forget every event
  vau inbox report "Sidebar fixed" --work fix --tldr "The sidebar scrolls again." --summary "..." \\
    --decision "Ship it to the phone too? | Yes | Not yet*" --images /tmp/after.png
                                              end a task you were handed: a record, and a decision per question
  vau inbox ask "Keep the quieter island?" --options Keep "Go back" --default Keep
                                              one decision (--blocking: you wait on it)
  vau inbox decisions                         what waits on the user's answer
  vau inbox decide "Inbox/Keep the quieter island.md" "Go back"   their answer (--default; --defaults: all of them)
  vau inbox reports --since 2026-11-06        the reports filed since, one line each (the brief's digest)
  vau inbox progress "Two of five fixes in"   your session's row says it, quietly
  vau inbox reply "Inbox/Sidebar fixed.md" "Yes, ship it"   the reply, typed into the agent's session
  vau inbox reply mg3k2a-1f9c0e "The second one"            the same, to a session's row (ids: vau inbox)
  vau inbox settle "Inbox/Sidebar fixed.md"   archive a result (--title names it anew; done: its old name)
  vau inbox snooze "Inbox/Sidebar fixed.md" --until tomorrow   out of the way till then (3h, weekend...)
  vau inbox wake "Inbox/Sidebar fixed.md"     back now, on top
  vau inbox pin "Inbox/Sidebar fixed.md"     keep it on top till it's done (--off unpins it)
  vau inbox hold 30m --label "Practice guitar"   nothing told till then, then what came (off ends it)

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
      if (r.code !== 0) throw new CliError(r.err.replace(/^vau [^:]+: /, ""), r.code === 2)
      return a.flags.json ? done(JSON.parse(r.out), "") : done(null, r.out)
    },
  }],
}
