import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { HERMES_DIR, api, app, check, TOOLS } = $
  // Hermes (plugins/core/hermes): usage from its databases (the main home and a profile), a session's conversation,
  // its memory and jobs, its terminal and hermes.connect, from the fixture.
  {
    let [c, u] = await api("GET", "hermes?days=7&account=default")
    check("hermes: usage as Hermes recorded it: per model (an aux call too), a chat's totals, a subagent's and a compression's in their session, an old one left out",
      c === 200 && u.total.cost === 0.09 && u.total.tokens === 17770 && u.total.unpriced === 0 && u.total.cache_hit === 0.723 &&
      u.plan === null && u.limits === null && Array.isArray(u.live) && u.days.length === 7, [c, u?.total])
    check("hermes: projects: a worktree next to its repository is the same project, a chat app's sessions under the app",
      u.projects.map((p: Any) => `${p.name}:${p.sessions}`).join() === "lighthouse:2,Telegram:1", u.projects)
    check("hermes: models by their name, most cost first", u.models.map((m: Any) => m.name).join() ===
      "claude-sonnet-4.6,hermes-4-405b,gpt-5.4-mini,gemini-3-flash", u.models)
    const [a, b, cc] = ["20260929_090000_aaaa01", "20260928_100000_bbbb01", "20260929_102000_cccc01"].map((id) => u.sessions.find((s: Any) => s.id === id))
    check("hermes: sessions: titles (the first prompt when untitled), cost, model, time working, top-level only",
      u.sessions.length === 3 && u.sessions[0].id === a?.id && a.title === "Fix the map tiles" && a.cost === 0.074 && a.tokens === 15420 &&
      a.model === "claude-sonnet-4.6" && Math.abs(a.active_min - 5) < 0.01 && a.cwd === "/Users/alice/lighthouse" && a.account === "default" &&
      b?.title === "What's on my calendar tomorrow?" && b.project === "Telegram" && cc?.project === "lighthouse" && Math.abs(cc.active_min - 50 / 60) < 0.01, u.sessions)
    ;[c, u] = await api("GET", "hermes?days=7")
    const r = u.sessions?.find((s: Any) => s.id === "20260929_080000_rrrr01")
    check("hermes: every home when no account is named, each session saying which", c === 200 && u.total.tokens === 18270 && u.total.cost === 0.09 &&
      r?.account === "research" && r.accountLabel === "Research" && r.project === "notes" && u.sessions.find((s: Any) => s.id === a.id)?.accountLabel === "Default", [c, u?.total, r])
    ;[c] = await api("GET", "hermes?account=nope")
    check("hermes: an unknown profile is a 404", c === 404, c)
    ;[, u] = await api("GET", "hermes/accounts")
    check("hermes: its homes", JSON.stringify(u) === JSON.stringify([{ id: "default", label: "Default" }, { id: "research", label: "Research" }]), u)
    let t: Any
    ;[c, t] = await api("GET", "hermes/session/20260929_090000_aaaa01")
    check("hermes session: found by id, with title, folder, branch, model and times", c === 200 && t.title === "Fix the map tiles" &&
      t.cwd === "/Users/alice/lighthouse" && t.branch === "tiles" && t.model === "claude-sonnet-4.6" && t.project === "lighthouse" && t.first && t.last > t.first,
      [c, { ...t, entries: undefined }])
    const kinds = t.entries?.map((e: Any) => e.kind).join(",")
    check("hermes session: what was said and each tool call, with the part compression continued it in (not its summary, a rewound or a system row)",
      kinds === "user,assistant,tool,tool,assistant,user,assistant" && t.total === 7 && t.entries[0].text === "The map tiles flicker when zooming" &&
      t.entries[6].text === "Lint is clean.", kinds)
    const [term, readf] = [t.entries[2], t.entries[3]]
    check("hermes session: a tool call is one line with its result (an error when Hermes says one)", term.name === "terminal" &&
      term.summary === "npm test -- tiles" && term.result === "1 failing: tiles cache" && term.error === false && JSON.parse(term.input).command === "npm test -- tiles" &&
      readf.name === "read_file" && readf.summary === "src/tile.ts" && readf.error === true && readf.result === "No such file: src/tile.ts" &&
      t.entries[4].text === "Fixed: tiles are cached **per zoom** now.", [term, readf, t.entries[4]])
    ;[, t] = await api("GET", "hermes/session/20260929_090000_aaaa01?limit=2&before=4")
    check("hermes session: pages", t.start === 2 && t.entries.length === 2 && t.entries[0].name === "terminal", [t.start, t.entries?.length])
    ;[, t] = await api("GET", "hermes/session/20260929_102000_cccc01")
    check("hermes session: a message with an image", t.entries?.[0]?.text === "Make the header sticky\n\n_(image)_", t.entries?.[0])
    ;[, t] = await api("GET", "hermes/session/20260928_100000_bbbb01")
    check("hermes session: an untitled one is its first prompt, a chat app's under the app", t.title === "What's on my calendar tomorrow?" && t.project === "Telegram", t.title)
    ;[c, t] = await api("GET", "hermes/session/20260929_080000_rrrr01")
    check("hermes session: found in a profile", c === 200 && t.account === "research" && t.entries.length === 2, [c, t?.account])
    ;[c] = await api("GET", "hermes/session/nope")
    check("hermes session: an unknown session is a 404", c === 404, c)
    ;[c] = await api("GET", "hermes/session/..%2F..%2Fetc")
    check("hermes session: not a path", c === 404, c)
    const agent = (await import("../../../core/plugins.ts")).service(app.plugins, "agent:hermes")!
    const gone = await agent({ resume: "20260101_000000_gone00", context: "", state: null })
    check("hermes in a terminal: a session that isn't on this machine isn't resumed", gone.command.startsWith("printf") && gone.command.includes("no Hermes session"), gone)
    let run = await agent({ resume: "20260929_090000_aaaa01", context: "Inside Vaultite.", state: null })
    check("hermes in a terminal: resumes in the session's folder", run.command === `HERMES_HOME='${HERMES_DIR}' hermes -r '20260929_090000_aaaa01'` &&
      run.cwd === "/Users/alice/lighthouse", run)
    run = await agent({ resume: "20260929_080000_rrrr01", context: "", state: null })
    check("hermes in a terminal: a profile's session resumes in its profile", run.command.endsWith("hermes -p 'research' -r '20260929_080000_rrrr01'") && run.cwd === "/Users/alice/notes", run)
    run = await agent({ resume: null, context: "", state: null, profile: "research", prompt: "Hi there" })
    check("hermes in a terminal: a new one in a profile, with its first prompt", run.command.endsWith("hermes -p 'research' chat -q 'Hi there'") && run.cwd === null, run)
    let m: Any
    ;[c, m] = await api("GET", "hermes/memory")
    check("hermes memory: its soul, and each entry of what it noted and knows about the user", c === 200 && m.soul.includes("You are Hermes, a careful assistant for Alice Park.") &&
      m.memory.length === 2 && m.memory[1] === "The map tiles cache lives in src/tiles.ts.\nIt is keyed by zoom." &&
      JSON.stringify(m.user) === JSON.stringify(["Alice Park prefers metric units.", "Works on Lighthouse, an app for tide tables."]), m)
    ;[, m] = await api("GET", "hermes/memory?account=research")
    check("hermes memory: a profile without any", m.account === "research" && m.soul === null && m.memory === null && m.user === null, m)
    ;[c, m] = await api("GET", "hermes/cron")
    const [morning, weekly] = m.jobs ?? []
    check("hermes cron: each job, its schedule, whether it's on and how its last run went", c === 200 && m.jobs.length === 2 &&
      morning.name === "Morning tide summary" && morning.schedule === "0 7 * * *" && morning.enabled && morning.status === "ok" && morning.next &&
      weekly.name === "Weekly cleanup" && !weekly.enabled && weekly.status === "error" && weekly.error === "Provider timeout", m.jobs)
    const [, page] = await api("GET", "render?path=Dashboards/Hermes.md")
    check("the Hermes page: sessions, usage, projects, models, jobs and memory as text", typeof page === "string" && page.includes("## Hermes sessions") &&
      page.includes("Fix the map tiles") && page.includes("## Hermes by project") && page.includes("Telegram: $0.01") && page.includes("## Hermes by model") &&
      page.includes("- Weekly cleanup: every 10080m (paused), last ran") && page.includes("(error): Provider timeout") &&
      page.includes("- The map tiles cache lives in src/tiles.ts.\n  It is keyed by zoom.") && page.includes("> You are Hermes"), String(page).slice(0, 1500))

    // hermes.connect: Vaultite's MCP server in Hermes' config.yaml, as a small edit; only this machine's owner may.
    const cfg = path.join(HERMES_DIR, "config.yaml"), was = fs.readFileSync(cfg, "utf8")
    const outsider = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
    const refused = await app.runOp("hermes.connect", {}, { http: outsider }).then(() => null, (e: Any) => e)
    check("hermes connect: refused to anyone but this machine's owner, nothing written", refused?.status === 403 && fs.readFileSync(cfg, "utf8") === was, refused?.message)
    const vauNode = (await import("../../../core/service.ts")).stableNode(process.execPath, process.env.PATH)
    const entry = `  vaultite:\n    command: ${JSON.stringify(vauNode)}\n    args: [${JSON.stringify(path.resolve(TOOLS, "..", "bin", "vau"))}, "mcp"]\n    env:\n      VAULTITE_URL: "http://127.0.0.1:8793"\n      VAULTITE_AGENT: "hermes"\n`
    let [code, said] = await api("POST", "ops/hermes.connect?as=text", {})
    const now = fs.readFileSync(cfg, "utf8")
    check("hermes connect: adds vaultite under mcp_servers (vau mcp, by the server's Node), every other line as it was",
      code === 200 && now === was.replace(`    args: ["mcp-server-time"]\n`, `    args: ["mcp-server-time"]\n${entry}`) && String(said).startsWith("Added Vaultite's MCP server in"), [code, said, now])
    ;[code, said] = await api("POST", "ops/hermes.connect?as=text", {})
    check("hermes connect: again, nothing changes", code === 200 && fs.readFileSync(cfg, "utf8") === now && String(said).includes("nothing changed"), said)
    fs.writeFileSync(cfg, now.replace(JSON.stringify(vauNode), '"/old/node"'))
    let res = await app.runOp("hermes.connect", {})
    check("hermes connect: a stale entry is updated", (res.result as Any).changed === "updated" && fs.readFileSync(cfg, "utf8") === now, fs.readFileSync(cfg, "utf8"))
    res = await app.runOp("hermes.connect", { account: "research" })
    const rcfg = fs.readFileSync(path.join(HERMES_DIR, "profiles", "research", "config.yaml"), "utf8")
    check("hermes connect: a profile without mcp_servers gets it at the end", (res.result as Any).changed === "added" &&
      rcfg === `model:\n  default: openai/gpt-5.4\n\nmcp_servers:\n${entry}`, rcfg)
    const blank = path.join(HERMES_DIR, "profiles", "blank", "config.yaml")
    fs.mkdirSync(path.dirname(blank))
    fs.writeFileSync(blank, "mcp_servers:\n# none yet\nmodel: x\n")
    await app.runOp("hermes.connect", { account: "blank" })
    check("hermes connect: an empty mcp_servers gets it under", fs.readFileSync(blank, "utf8") === `mcp_servers:\n${entry}# none yet\nmodel: x\n`, fs.readFileSync(blank, "utf8"))
    fs.writeFileSync(blank, "mcp_servers: [oops\n")
    const bad = await app.runOp("hermes.connect", { account: "blank" }).then(() => null, (e: Any) => e)
    check("hermes connect: a config.yaml that isn't YAML is left alone", bad?.status === 400 && fs.readFileSync(blank, "utf8") === "mcp_servers: [oops\n", bad?.message)
    fs.rmSync(path.dirname(blank), { recursive: true })
  }
}
