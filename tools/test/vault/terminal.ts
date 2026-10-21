import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, check, tmp, vault } = $
  const { execute, servers, cliApi, vau } = $.vars
  // vau terminal (plugins/core/terminal/ops.ts) on a stand-in API and window (no shells): sessions and their tabs,
  // opening, resuming by title, typing, ending, tidying gone agents' tabs.
  {
    const calls: string[] = []
    const tabs = [["t1", "claude-live1"], ["t2", "claude-gone1"], ["t3", "k3j2h1g0"], ["t4", "claude-far@m1"]].map(([id, t]) => ({ id, to: `view:terminal/${t}` }))
    const termApi = async (m: string, r: string, b?: unknown) => {
      calls.push(`${m} ${r}${b === undefined ? "" : ` ${JSON.stringify(b)}`}`)
      if (r === "terminals/sessions") return { status: 200, body: { sessions: [{ id: "claude-live1", agent: "claude", process: "claude", clients: 1, started: Date.now() - 120000, title: "Fixing the build", state: "working" }] } }
      if (r === "workspaces") return { status: 200, body: { workspaces: [{ layout: { root: { id: "g0", tabs, active: "t1" }, focus: "g0" } }] } }
      if (r === "workspaces/close") return { status: 200, body: { closed: [{ workspace: 1, id: "t2", to: (b as Any).path }] } }
      if (r === "claude-code?days=30") return { status: 200, body: { sessions: [{ id: "3f2a9c1e-5b7d-4e2a-9c1f-0a2b3c4d5e6f", title: "Left sidebar scrollbar" }, { id: "9e8d7c6b-5a4f-4e3d-8c2b-1a0f9e8d7c6b", title: "Sidebar tweaks" }] } }
      if (m === "DELETE") return { status: 200, body: { id: r.split("/")[1], ended: true } }
      if (m === "POST" && /^terminals\/[^/]+$/.test(r)) return { status: 200, body: { id: r.split("/")[1], started: true, agent: r.includes("claude") ? "claude" : null } }
      if (m === "POST" && r.endsWith("/send")) return { status: 200, body: { id: r.split("/")[1], ...(b as Any) } }
      if (r === "ui") return { status: 200, body: { ok: true } }
      return { status: 404, body: { error: "not found" } }
    }
    const { plugin: termPlugin } = await import("../../../plugins/core/terminal/plugin.ts")
    const { checkParams, OpError: OpErr, whoOf } = await import("../../../core/ops.ts")
    const termCtx = { vault, who: whoOf("cli", null), plugin: "terminal", op: async () => null,
      api: async (m: string, r: string, b?: unknown) => { const x = await termApi(m, r, b); if (x.status >= 400) throw new OpErr(String((x.body as Any)?.error ?? x.status), x.status); return x.body },
      ui: async (msg: Any) => (await termApi("POST", "ui", msg)).body }
    const term = async (verb: string, given: Record<string, unknown> = {}) => {
      const op = termPlugin.ops.find((o) => o.id === `terminal.${verb}`)!
      try {
        const p = checkParams(op, given)
        const r = await op.run(p, termCtx)
        return { code: 0, out: op.text!(r, p), err: "" }
      } catch (e) {
        if (e instanceof OpErr) return { code: 1, out: "", err: e.message }
        throw e
      }
    }
    let tr = await term("list")
    check("vau terminal: the sessions, what runs in them and their tabs; then the tabs whose session is gone (another machine's aren't)",
      tr.code === 0 && tr.out.includes('claude-live1  claude (working)  "Fixing the build"  2m ago, tab in workspace 1') &&
      tr.out.includes("claude-gone1  gone, tab in workspace 1 (an agent's") && tr.out.includes("k3j2h1g0  gone, tab in workspace 1 (a new shell") && !tr.out.includes("claude-far"), tr)
    calls.length = 0
    tr = await term("tidy")
    check("vau terminal tidy: closes the tabs of agents' sessions that are gone, not shells'",
      tr.code === 0 && calls.filter((x) => x.startsWith("POST workspaces/close")).join() === 'POST workspaces/close {"path":"view:terminal/claude-gone1"}', [tr, calls])
    calls.length = 0
    tr = await term("open", { agent: "claude", split: "right" })
    const opened = /^POST terminals\/(claude-[a-z0-9]{8})$/.exec(calls[0] ?? "")?.[1]
    check("vau terminal open <agent>: starts the session, then shows it", tr.code === 0 && !!opened &&
      calls[1] === `POST ui {"action":"open","path":"view:terminal/${opened}","split":"right","newTab":false}`, [tr, calls])
    calls.length = 0
    tr = await term("open", { agent: "nope" })
    check("vau terminal open: an agent no plugin brings is refused (and its shell ended)", tr.code === 1 && tr.err.includes("no agent 'nope'") && calls.some((x) => x.startsWith("DELETE terminals/nope-")), [tr, calls])
    calls.length = 0
    tr = await term("resume", { session: "left sidebar" })
    check("vau terminal resume <title>: the one session with those words, resumed in a tab", tr.code === 0 &&
      calls.includes("POST terminals/resume-claude-3f2a9c1e-5b7d-4e2a-9c1f-0a2b3c4d5e6f") && calls.some((x) => x.includes('"path":"view:terminal/resume-claude-3f2a9c1e-5b7d-4e2a-9c1f-0a2b3c4d5e6f"')), [tr, calls])
    tr = await term("resume", { session: "sidebar" })
    check("vau terminal resume: words in several titles list them", tr.code === 1 && tr.err.includes("2 sessions"), tr)
    calls.length = 0
    tr = await term("send", { id: "k3j2h1g0", text: "npm test" })
    check("vau terminal send: the text, then Enter", tr.code === 0 && calls[0] === 'POST terminals/k3j2h1g0/send {"text":"npm test","enter":true}', [tr, calls])
    calls.length = 0
    tr = await term("end", { id: "claude-live1" })
    check("vau terminal end: ends it and closes its tabs", tr.code === 0 && calls[0] === "DELETE terminals/claude-live1" &&
      calls[1] === 'POST workspaces/close {"path":"view:terminal/claude-live1"}' && tr.out.includes("closed its tab"), [tr, calls])
    tr = await term("end")
    check("vau terminal end: without an id (no VAULTITE_TERMINAL) asks which", tr.code === 1 && tr.err.includes("which terminal"), tr)
    tr = await term("screen", { id: "claude-far@m1" })
    check("vau terminal: another machine's id goes to that machine", tr.code === 1 && tr.err.includes("another machine's"), tr)
    // From the command line (the real routes: a session that isn't there is said, nothing starts): its words as the op's.
    tr = await vau("terminal", "send", "nosuch1", "npm", "test")
    check("vau terminal send: the id, then the rest of the words as the text", tr.code === 1 && tr.err.includes("no terminal session 'nosuch1'"), tr)
    tr = await execute(["terminal", "end"], { api: cliApi, env: { VAULTITE_TERMINAL: "nosuch2" }, stdin: async () => "" })
    check("vau terminal end: without an id, the terminal it runs in (VAULTITE_TERMINAL)", tr.code === 1 && tr.err.includes("no terminal session 'nosuch2'"), tr)
    tr = await vau("terminal", "screen", "claude-far@m1")
    check("vau terminal screen: another machine's id, from the command line", tr.code === 1 && tr.err.includes("another machine's"), tr)
  }

  // vau finds the server when VAULTITE_URL doesn't say: the desktop app's (vaults.json: a port per vault) for the vault
  // it's run in, then the default port, then the app's other open vaults, most recent first.
  {
    const ud = path.join(tmp, "userdata")
    fs.mkdirSync(ud, { recursive: true })
    fs.writeFileSync(path.join(ud, "vaults.json"), JSON.stringify({ vaults: [{ path: VAULT, port: 21001, open: true, last: 1 },
      { path: path.join(tmp, "other"), port: 21002, open: true, last: 3 }, { path: path.join(tmp, "closed"), port: 21003, open: false, last: 5 }] }))
    const found = servers({ VAULTITE_USER_DATA: ud }, VAULT), outside = servers({ VAULTITE_USER_DATA: ud }, tmp)
    check("vau: the server is the desktop app's for the vault it's run in, then the default, then other open vaults",
      found.join() === "http://127.0.0.1:21001,http://127.0.0.1:8793,http://127.0.0.1:21002" &&
      outside.join() === "http://127.0.0.1:8793,http://127.0.0.1:21002,http://127.0.0.1:21001" &&
      servers({ VAULTITE_USER_DATA: ud, VAULTITE_VAULT: VAULT }, tmp)[0] === "http://127.0.0.1:21001" &&
      servers({ VAULTITE_USER_DATA: path.join(tmp, "none") }, VAULT).join() === "http://127.0.0.1:8793", [found, outside])
  }

  // Terminal ids: an agent in one of its accounts, and another machine's.
  {
    const term = await import("../../../plugins/core/terminal/plugin.ts")
    const { splitMachine } = await import("../../../core/plugins.ts")
    check("terminal: an agent's id may name its account", JSON.stringify(term.agentOf("claude_work-k3j2h1g0")) === JSON.stringify({ name: "claude", resume: null, profile: "work" }) &&
      term.agentOf("claude-k3j2h1g0")?.profile === null && term.agentOf("resume-claude-0d1e2f3a-4444")?.resume === "0d1e2f3a-4444", term.agentOf("claude_work-k3j2h1g0"))
    check("terminal: @<machine> is another machine's", JSON.stringify(splitMachine("claude-k3j2@studio")) === JSON.stringify(["claude-k3j2", "studio"]) &&
      JSON.stringify(splitMachine("k3j2h1g0")) === JSON.stringify(["k3j2h1g0", ""]) && term.TERMINAL_ID.test("claude_work-k3@box-2") &&
      !term.TERMINAL_ID.test("a@B") && !term.TERMINAL_ID.test("a@b@c"), splitMachine("claude-k3j2@studio"))
    // An agent's questions on its screen: Claude Code's folder trust (before its hooks run) and permission, by their last lines.
    const cc = await import("../../../plugins/core/claude-code/plugin.ts")
    const asks = cc.plugin.services["agent-asks:claude"]()
    const showing = (text: string) => ({ screen: async () => text })
    const trust = await term.askOn(showing("Accessing workspace:\n\n /Users/sam/Notes\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm · Esc to cancel\n\n"), "t", asks)
    check("terminal: Claude Code's folder trust is a question, approved by choosing Yes (its default is No)", trust?.id === "trust" &&
      JSON.stringify(trust.approve) === JSON.stringify(["\x1b[B", "\r"]) && JSON.stringify(trust.deny) === JSON.stringify(["\x1b"]), trust)
    const perm = await term.askOn(showing(" Bash command\n   rm -rf build\n Do you want to proceed?\n ❯ 1. Yes\n   2. No"), "t", asks)
    check("terminal: its permission dialog is one too, Yes first", perm?.id === "permission" && JSON.stringify(perm.approve) === JSON.stringify(["\r"]), perm)
    const above = await term.askOn(showing(["Do you want to proceed?", ...Array.from({ length: 20 }, (_, i) => `output ${i}`)].join("\n")), "t", asks)
    check("terminal: a question scrolled up isn't asked now", above === null, above)
    // What a page gets back from a backend without pictures: the last `scrollback` lines, whole chunks, and a line
    // redrawn without end (a progress bar) held to its share.
    const { Tail } = await import("../../../plugins/core/terminal/backend.ts")
    const tail = new Tail(100)
    for (let i = 0; i < 500; i++) tail.push(`line ${i}\r\n`)
    const kept = tail.text().split("\r\n").filter(Boolean)
    check("terminal: the replay is the last scrollback lines", kept.length === 100 && kept[0] === "line 400" && kept.at(-1) === "line 499", kept.length)
    for (let i = 0; i < 2000; i++) tail.push(`\r${"#".repeat(50)} ${i}%`)
    check("terminal: output with no line breaks is held to about 200 characters a line", tail.text().length <= 100 * 200 + 60, tail.text().length)
    // Vaultite's vau first on PATH after the user's startup files put another vau first (as Homebrew's shellenv does),
    // then QA's stand-in agents (VAULTITE_AGENT_BIN) before the user's own.
    const { execFileSync } = await import("node:child_process")
    const { SHELL_DIR, shellArgs, shellFiles } = await import("../../../plugins/core/terminal/backend.ts")
    shellFiles()
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "vau-shell-")), ours = path.join(home, "ours"), other = path.join(home, "other"), agents = path.join(home, "agents")
    for (const d of [ours, other, agents]) { fs.mkdirSync(d); for (const f of ["vau", "claude"]) if (d !== ours || f === "vau") fs.writeFileSync(path.join(d, f), "#!/bin/sh\n", { mode: 0o755 }) }
    for (const f of [".zprofile", ".bash_profile"]) fs.writeFileSync(path.join(home, f), `PATH="${other}:$PATH"; export FROM_PROFILE=1\n`)
    const env = { HOME: home, TERM: "dumb", PATH: `${ours}:${agents}:/usr/bin:/bin`, VAULTITE_BIN: ours, VAULTITE_AGENT_BIN: agents }
    for (const sh of ["/bin/zsh", "/bin/bash"].filter((f) => fs.existsSync(f))) {
      const zsh = sh.endsWith("zsh"), print = "printf '%s|%s|%s|%s' \"$(command -v vau)\" \"$(command -v claude)\" \"$FROM_PROFILE\" \"${ZDOTDIR-unset}\""
      let out = ""
      try { out = execFileSync(sh, shellArgs(sh, { command: `${print}; exit` }), { cwd: home, env: { ...env, ...(zsh ? { ZDOTDIR: SHELL_DIR, VAULTITE_ZDOTDIR: SHELL_DIR } : {}) }, stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).toString() } catch (e) { out = String((e as Any).stdout) }
      check(`terminal: ${path.basename(sh)} runs the user's startup files, then puts Vaultite's vau first and QA's agents next`, out === `${path.join(ours, "vau")}|${path.join(agents, "claude")}|1|unset`, out)
    }
    // An agent's program not installed: its shell's exit 127 marks the state file, which the server tells the user.
    for (const sh of ["/bin/zsh", "/bin/bash", "/opt/homebrew/bin/fish", "/usr/bin/fish"].filter((f) => fs.existsSync(f))) {
      const marked = (cmd: string) => {
        const file = path.join(home, `state-${path.basename(sh)}`)
        fs.rmSync(file, { force: true })
        try { execFileSync(sh, ["-c", term.markMissing(cmd, file, sh)], { cwd: home, env, stdio: "ignore", timeout: 10_000 }) } catch { /* its status */ }
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
      }
      check(`terminal: ${path.basename(sh)} marks an agent that isn't installed, not one that ran`, marked("no-such-agent-x1 --flag") === "missing" &&
        marked("FOO=1 no-such-agent-x1") === "missing" && marked("true") === "" && marked("false") === "", [marked("no-such-agent-x1"), marked("true")])
    }
    fs.rmSync(home, { recursive: true, force: true })
  }

  // The keeper lets go of a shell's pty once it ends (node-pty 1.1 kept both ends open on macOS: a keeper running for
  // days took the machine's ptys, and new terminals and tmux failed).
  {
    const { ptydBackend } = await import("../../../plugins/core/terminal/backend.ts")
    const { execFileSync } = await import("node:child_process")
    const { waitFor } = await import("../lib.ts")
    const keeper = ptydBackend(`test-${process.pid}`, { daemon: path.resolve(import.meta.dirname, "../../../plugins/core/terminal/ptyd.ts") })
    const ptys = (pid: number) => process.platform === "linux"
      ? fs.readdirSync(`/proc/${pid}/fd`).filter((f) => { try { return /^\/dev\/(ptmx|pts\/)/.test(fs.readlinkSync(`/proc/${pid}/fd/${f}`)) } catch { return false } }).length
      : execFileSync("lsof", ["-p", String(pid)]).toString().split("\n").filter((l) => /\/dev\/(ptmx|ttys)|\(revoked\)/.test(l)).length
    const spec = { shell: "/bin/sh", run: null, cwd: tmp, env: { PATH: "/usr/bin:/bin", HOME: tmp }, ctx: {}, cols: 80, rows: 24, scrollback: 100 }
    // One at a time (a machine short of ptys still runs it), ended each way: killed, exiting, a spare taken then killed.
    const ways: [string, (id: string) => Promise<unknown>][] = [
      ["leak-kill", (id) => keeper.kill(id)],
      ["leak-exit", (id) => keeper.send(id, "exit", true)],
      ["leak-spare", async (id) => { await keeper.rename!(id, `${id}-taken`); await keeper.kill(`${id}-taken`) }],
    ]
    const seen: Record<string, unknown>[] = []
    // (ended even when a step throws: a keeper left behind holds its shells' ptys)
    const stop = () => { try { process.kill(Number(fs.readFileSync(`${keeper.socket}.pid`, "utf8")), "SIGTERM") } catch { /* none */ } }
    try {
      for (const [id, end] of ways) {
        await keeper.create(id, spec, { spare: id === "leak-spare" })
        const pid = Number(fs.readFileSync(`${keeper.socket}.pid`, "utf8"))
        const open = ptys(pid)
        // Ended only once its prompt is up: a hangup sent while the shell still starts could be lost on a slow machine.
        const ready = await waitFor(async () => (await keeper.screen(id, 5)).trim() !== "", 10_000, 50)
        await end(id)
        const ended = await waitFor(async () => (await keeper.list()).length === 0, 15_000, 100)
        const left = (await waitFor(() => ptys(pid) === 0, 5_000, 100)) ? 0 : ptys(pid)
        seen.push({ id, open, ready, ended, left })
      }
    } finally { stop() }
    check("terminal: the keeper lets go of a shell's pty once it ends", seen.every((s) => (s.open as number) >= 1 && s.ready && s.ended && s.left === 0), seen)
  }

  // Routes: * is one segment, a last ** the rest.
  {
    const { match, Plugin: P } = await import("../../../core/plugins.ts")
    const fake = Object.create(P.prototype) as InstanceType<typeof P>
    fake.routes = [["GET", "machines/*/**".split("/"), () => 1, {}], ["GET", "machines/self".split("/"), () => 2, {}]]
    const hit = match([fake], "GET", ["machines", "studio", "claude-code", "session", "x"])
    check("routes: ** takes the rest", hit?.[1].join("|") === "studio|claude-code/session/x", hit?.[1])
    check("routes: ** needs one segment at least", match([fake], "GET", ["machines", "studio"]) === null && match([fake], "GET", ["machines", "self"])?.[0]({} as never) === 2)
  }
}
