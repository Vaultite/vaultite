import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { OPENCLAW_DIR, api, app, check, tmp, TOOLS } = $
  // OpenClaw (plugins/core/openclaw): usage from its agents' databases, a conversation (compressed events too), memory,
  // scheduled jobs, its terminal, and connecting it to the vault (a fake openclaw that records what it was asked).
  {
    const A = "a1f0c3d2-5b6e-4c7a-8d9e-0f1a2b3c4d5a", B = "b2e1d4c3-6c7f-4d8b-9eaf-1a2b3c4d5e6b", C = "c3d2e5f4-7d8a-4e9c-afb0-2b3c4d5e6f7c"
    const { DatabaseSync } = await import("node:sqlite")
    const packed = new DatabaseSync(path.join(OPENCLAW_DIR, "agents/main/agent/openclaw-agent.sqlite"), { readOnly: true })
    const zstdRows = Number((packed.prepare("SELECT count(*) AS n FROM transcript_events WHERE event_zstd IS NOT NULL").get() as Any).n)
    packed.close()
    let [c, u] = await api("GET", "openclaw?days=7")
    check("openclaw: usage as OpenClaw recorded it (compressed replies too), a fork's copied reply once, a subagent's in its parent, no cost unpriced",
      zstdRows === 3 && c === 200 && u.total.cost === 0.2 && u.total.tokens === 32000 && u.total.unpriced === 1 && u.total.cache_hit === 0.603 &&
      u.plan === null && u.limits === null && u.days.length === 7, [zstdRows, c, u?.total])
    check("openclaw: projects by folder (a worktree next to its repository is the same one), models by id",
      u.projects?.map((p: Any) => `${p.name}:${p.sessions}`).join(",") === "lighthouse:2,notes:1,workspace:1" &&
      u.models?.map((m: Any) => m.name).join(",") === "claude-sonnet-5,gpt-5.4-mini,claude-haiku-4-5", [u.projects, u.models])
    const a = u.sessions?.find((s: Any) => s.id === A)
    check("openclaw: sessions: names (a label, a generated title, else the first prompt), cost, model, time working, each agent's",
      u.sessions?.length === 4 && u.sessions[0].id === A && a.title === "Upload retry fix" && a.cost === 0.12 && a.tokens === 25000 &&
      a.model === "claude-sonnet-5" && Math.abs(a.active_min - 102.5 / 60) < 0.01 && a.cwd === "/Users/alice/lighthouse" && a.accountLabel === "main" &&
      u.sessions.find((s: Any) => s.id === B)?.title === "Lighthouse notes" && u.sessions.find((s: Any) => s.id === C)?.title === "Write my morning brief", u.sessions)
    check("openclaw: running now, from OpenClaw's own state", u.live?.length === 1 && u.live[0].id === A && u.live[0].status === "busy" &&
      u.live[0].name === "agent:main:main" && u.live[0].cost === 0.12 && u.live[0].project === "lighthouse", u.live)
    ;[c, u] = await api("GET", "openclaw?days=7&account=scout")
    check("openclaw: one agent's (account)", c === 200 && u.sessions.length === 1 && u.sessions[0].title === "Reading list" && u.total.cost === 0.05 && !u.live.length, u)
    ;[c] = await api("GET", "openclaw?account=nobody")
    check("openclaw: an agent that isn't here is a 404", c === 404, c)
    let t: Any
    ;[c, t] = await api("GET", `openclaw/session/${A}`)
    const kinds = t.entries?.map((e: Any) => e.kind).join(",")
    check("openclaw session: its name, folder, key and model, and what was said on its active branch (no runtime context, no rewound turn)",
      c === 200 && t.title === "Upload retry fix" && t.cwd === "/Users/alice/lighthouse" && t.key === "agent:main:main" && t.model === "claude-sonnet-5" &&
      t.project === "lighthouse" && t.first && t.last > t.first && kinds === "user,assistant,tool,assistant,user,assistant" &&
      t.entries[0].text === "Fix the flaky upload test" && t.entries[4].text === "Thanks, that works", [c, kinds, { ...t, entries: undefined }])
    const [, tool, fixed] = [t.entries?.[1], t.entries?.[2], t.entries?.[3]]
    check("openclaw session: a tool call with its result, and an answer, both read from zstd-compressed events",
      tool?.name === "exec" && tool.summary === "npm test -- upload" && tool.error === true && tool.result?.startsWith("1 failing: upload retries") &&
      fixed?.text.startsWith("Fixed: the retry **waits** now."), [tool, fixed])
    ;[, t] = await api("GET", `openclaw/session/${A}?limit=2&before=4`)
    check("openclaw session: pages", t.start === 2 && t.entries.length === 2 && t.entries[0].name === "exec", [t.start, t.entries?.length])
    ;[c] = await api("GET", "openclaw/session/nope-0000")
    check("openclaw session: an unknown session is a 404", c === 404, c)
    ;[c] = await api("GET", "openclaw/session/..%2F..%2Fetc")
    check("openclaw session: not a path", c === 404, c)
    let [, m] = await api("GET", "openclaw/memory")
    check("openclaw memory: main's identity, soul, user and memory files, its two latest daily notes (not its instructions)",
      m.agent === "main" && m.files.map((f: Any) => f.name).join(",") === "IDENTITY.md,SOUL.md,USER.md,MEMORY.md" && m.files[2].text.includes("Alice Park") &&
      m.notes.map((n: Any) => n.date).join(",") === "2026-10-04,2026-10-03", m)
    ;[, m] = await api("GET", "openclaw/memory?account=scout&notes=0")
    check("openclaw memory: another agent's workspace (workspace-<id>)", m.dir.endsWith("workspace-scout") && m.files.map((f: Any) => f.name).join(",") === "SOUL.md" &&
      !m.notes.length, m)
    let [, jobs] = await api("GET", "openclaw/cron")
    const [brief, weekly] = jobs
    check("openclaw cron: its jobs, when each runs, the last run and the next", jobs.length === 3 && brief.name === "Morning brief" &&
      brief.schedule === "cron 0 7 * * * (America/Los_Angeles)" && brief.status === "ok" && Date.parse(brief.next) > Date.now() && brief.task === "Write my morning brief" &&
      weekly.enabled === false && weekly.next === null && weekly.schedule === "every 7 days" && weekly.status === "error" && weekly.error === "model timed out", jobs)
    ;[, jobs] = await api("GET", "openclaw/cron?account=scout")
    check("openclaw cron: one agent's", jobs.length === 1 && jobs[0].schedule === "once, 2026-12-01T09:00:00Z", jobs)
    const [, accts] = await api("GET", "openclaw/accounts")
    check("openclaw: its agents, to open it as one", accts.map((x: Any) => x.id).join(",") === "main,scout", accts)
    const agent = (await import("../../../core/plugins.ts")).service(app.plugins, "agent:openclaw")!
    const gone = await agent({ resume: "0000aaaa-1111-4222-8333-444455556666", context: "", state: null })
    check("openclaw in a terminal: a session that isn't here isn't resumed", gone.command.startsWith("printf") && gone.command.includes("no OpenClaw session"), gone)
    // A gateway listening (a made-up one on a free port), then none: its embedded runtime.
    const { createServer } = await import("node:net")
    const gw = createServer((s) => s.destroy())
    await new Promise<void>((ok) => gw.listen(0, "127.0.0.1", ok))
    process.env.OPENCLAW_GATEWAY_PORT = String((gw.address() as { port: number }).port)
    const [back, fresh, scout] = await Promise.all([agent({ resume: A, context: "", state: null, prompt: "Go on" }), agent({ resume: null, context: "", state: null }),
      agent({ resume: null, context: "", state: null, profile: "scout" })])
    await new Promise((ok) => gw.close(ok))
    const alone = await agent({ resume: null, context: "", state: null })
    delete process.env.OPENCLAW_GATEWAY_PORT
    check("openclaw in a terminal: its TUI on the session's key (the prompt sent first), or on an agent's main session",
      back.command === "OPENCLAW_TUI_SESSION='agent:main:main' openclaw tui --session 'agent:main:main' --message 'Go on'" && back.cwd === null &&
      fresh.command === "OPENCLAW_TUI_SESSION='agent:main:main' openclaw tui" &&
      scout.command === "OPENCLAW_TUI_SESSION='agent:scout:main' openclaw tui --session 'agent:scout:main'", [back, fresh, scout])
    check("openclaw in a terminal: --local when no gateway answers", alone.command === "OPENCLAW_TUI_SESSION='agent:main:main' openclaw tui --local", alone)
    // An open TUI (a stand-in named openclaw, on a session's key) lists that session as open, idle, after any working one.
    const fakeBin = path.join(tmp, "openclaw-tui-bin")
    fs.mkdirSync(fakeBin, { recursive: true })
    fs.writeFileSync(path.join(fakeBin, "openclaw"), "#!/bin/sh\nsleep 30\n", { mode: 0o755 })
    const tui = (await import("node:child_process")).spawn(path.join(fakeBin, "openclaw"), ["tui", "--local", "--session", "agent:scout:main"], { stdio: "ignore" })
    await new Promise((ok) => setTimeout(ok, 6000)) // the usage read is kept 5 s
    const [, withTui] = await api("GET", "openclaw?days=7")
    tui.kill()
    const openRow = withTui.live.find((x: Any) => x.name === "agent:scout:main")
    check("openclaw: a TUI open on a session lists it as open (idle), with its pid", openRow?.status === "idle" && openRow.pid > 0 &&
      withTui.live.findIndex((x: Any) => x.status === "busy") < withTui.live.indexOf(openRow), withTui.live)
    // Connecting: OpenClaw's own CLI saves the server (a fake here, which records its arguments); only this machine's owner.
    const bin = path.join(tmp, "openclaw-bin"), calls = path.join(bin, "calls"), PATH = process.env.PATH
    fs.mkdirSync(bin)
    // (npm -g puts it beside Node, where the plugin looks too)
    const installed = [".local/bin", ".npm-global/bin"].map((d) => path.join(os.homedir(), d)).concat(["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", path.dirname(fs.realpathSync(process.execPath))])
      .some((d) => fs.existsSync(path.join(d, "openclaw")))
    if (!installed) {
      process.env.PATH = bin
      const missing = await app.runOp("openclaw.connect", {}).then(() => null, (e: Any) => e)
      check("openclaw connect: a clear error when OpenClaw isn't installed", missing?.status === 409 && /isn't installed/.test(missing.message), missing?.message)
    }
    fs.writeFileSync(path.join(bin, "openclaw"), `#!/bin/sh\nprintf '%s\\n' "$@" >> "${calls}"\necho 'Saved MCP server "vaultite" to /tmp/openclaw.json.'\n`, { mode: 0o755 })
    process.env.PATH = `${bin}${path.delimiter}${PATH}`
    const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
    const refused = await app.runOp("openclaw.connect", {}, { http: stranger }).then(() => null, (e: Any) => e)
    check("openclaw connect: only this machine's owner", refused?.status === 403 && !fs.existsSync(calls), refused?.status)
    const [r1, r2] = [await app.runOp("openclaw.connect", {}), await app.runOp("openclaw.connect", {})]
    const lines = fs.readFileSync(calls, "utf8").trim().split("\n")
    const saved = JSON.parse(lines[3] ?? "{}")
    check("openclaw connect: runs openclaw mcp set vaultite with vau mcp over stdio, the same again the second time",
      lines.length === 8 && lines.slice(0, 3).join(" ") === "mcp set vaultite" && lines.slice(4).join("\n") === lines.slice(0, 4).join("\n") &&
      JSON.stringify(saved.args) === JSON.stringify([path.join(path.dirname(TOOLS), "bin", "vau"), "mcp"]) && saved.env?.VAULTITE_URL === "http://127.0.0.1:8793" &&
      (r1.result as Any).saved.startsWith("Saved MCP server") && (r2.result as Any).server.command === saved.command, [lines, r1.result])
    process.env.PATH = PATH
    const [, oc] = await api("GET", "render?path=Dashboards/OpenClaw.md")
    check("the OpenClaw page: what runs now first, usage, memory, scheduled jobs, projects and models as text", typeof oc === "string" &&
      oc.indexOf("Working: Upload retry fix") > 0 && oc.indexOf("Working: Upload retry fix") < oc.indexOf("### Recent") && oc.includes("## OpenClaw usage") &&
      oc.includes("### USER.md") && oc.includes("Daily note, 2026-10-04") && oc.includes("Weekly review: every 7 days, off") && oc.includes("lighthouse: $0.15") &&
      oc.includes("## OpenClaw by model"), String(oc).slice(0, 1500))
  }
}
