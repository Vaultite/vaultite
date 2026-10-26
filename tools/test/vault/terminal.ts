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
    const userWho = termCtx.who
    termCtx.who = whoOf("cli", "claude-code")
    tr = await term("open", { agent: "claude", prompt: " Fix the failing test ", split: "right" })
    termCtx.who = userWho
    const behind = /^POST terminals\/(claude-[a-z0-9]{8}) (.*)$/.exec(calls[0] ?? "")
    check("vau terminal open from an agent: starts with its prompt, its tab behind the user's, a toast to show it", tr.code === 0 && !!behind &&
      behind[2] === '{"prompt":"Fix the failing test"}' && calls[1] === `POST ui {"action":"open","path":"view:terminal/${behind[1]}","background":true}` &&
      calls[2] === `POST ui {"action":"notify","text":"Claude Code started a session","button":{"label":"Show","open":"view:terminal/${behind[1]}"}}`, [tr, calls])
    tr = await term("open", { prompt: "hi" })
    check("vau terminal open: a prompt with no agent is refused", tr.code === 1 && tr.err.includes("a prompt is an agent's"), tr)
    calls.length = 0
    tr = await term("open", { agent: "nope" })
    check("vau terminal open: an agent no plugin brings is refused (and its shell ended)", tr.code === 1 && tr.err.includes("no agent 'nope'") && calls.some((x) => x.startsWith("DELETE terminals/nope-")), [tr, calls])
    calls.length = 0
    tr = await term("ask", { prompt: "  What changed in the release notes this week?  ", model: "haiku" })
    const asked = /^POST terminals\/(claude-[a-z0-9]{8}) (.*)$/.exec(calls[0] ?? "")
    check("vau terminal ask: a new agent's session told the prompt first, in the background (no tab)", tr.code === 0 && !!asked &&
      asked[2] === JSON.stringify({ prompt: "What changed in the release notes this week?", model: "haiku" }) && calls.length === 1 &&
      tr.out.includes('"What changed in the release notes this week?"') && tr.out.includes("in the background"), [tr, calls])
    calls.length = 0
    tr = await term("ask", { prompt: "Plan the garden for spring, with the beds by the fence first and the herbs where the sun stays longest", account: "personal", open: true })
    check("vau terminal ask: in an account, its tab opened when asked, titled by the prompt's first words",
      tr.code === 0 && /^POST terminals\/claude_personal-[a-z0-9]{8} /.test(calls[0] ?? "") && calls[1]?.startsWith('POST ui {"action":"open","path":"view:terminal/claude_personal-') &&
      tr.out.includes('"Plan the garden for spring, with the beds by the fence…"'), [tr, calls])
    tr = await term("ask", { prompt: "   " })
    check("vau terminal ask: an empty prompt is refused", tr.code === 1 && tr.err.includes("say what to ask"), tr)
    fs.mkdirSync(path.join(VAULT, "Attachments"), { recursive: true })
    fs.writeFileSync(path.join(VAULT, "Attachments/Qa shot.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]))
    calls.length = 0
    tr = await term("ask", { prompt: "What's wrong here?", files: ["Attachments/Qa shot.png"] })
    const given = /^POST terminals\/claude-[a-z0-9]{8} (.*)$/.exec(calls[0] ?? "")
    check("vau terminal ask: files given with the prompt, by their full paths", tr.code === 0 && !!given &&
      JSON.parse(given[1]).prompt === `What's wrong here?\n\nAttached:\n- ${path.join(fs.realpathSync(VAULT), "Attachments/Qa shot.png")}`, [tr, calls])
    calls.length = 0
    tr = await term("ask", { prompt: "And this?", files: ["Attachments/Nowhere.png"] })
    check("vau terminal ask: a file that isn't there is refused, nothing started", tr.code === 1 && tr.err.includes("there's no file") && !calls.length, [tr, calls])
    fs.rmSync(path.join(VAULT, "Attachments/Qa shot.png"))
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
    // Codex has no hooks (and before 0.163 no OSC 7501, whose blocked has no kind): its approval, seen by its last lines, is Yes by Enter.
    const cx = await import("../../../plugins/core/codex/plugin.ts")
    const codexAsk = await term.askOn(showing("  $ curl -sI https://example.com | head -1\n\n\n› 1. Yes, proceed (y)\n  2. Yes, and don't ask again for commands that start with `curl` (p)\n" +
      "  3. No, and tell Codex what to do differently (esc)\n\n  Press enter to confirm or esc to cancel"), "t", cx.plugin.services["agent-asks:codex"]())
    check("terminal: Codex's approval of a command is a permission, Yes by Enter, No by Esc", codexAsk?.id === "permission" &&
      JSON.stringify(codexAsk.approve) === JSON.stringify(["\r"]) && JSON.stringify(codexAsk.deny) === JSON.stringify(["\x1b"]), codexAsk)
    const above = await term.askOn(showing(["Do you want to proceed?", ...Array.from({ length: 20 }, (_, i) => `output ${i}`)].join("\n")), "t", asks)
    check("terminal: a question scrolled up isn't asked now", above === null, above)
    // Four choices wrapped in a narrow terminal put its question more than 12 lines up: still asked, Enter for Yes.
    const tall = ["──────────────────────────────────────", " Read file", "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌", " Read(/tmp/m1s.png)", "╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌",
      " Do you want to proceed?", " ❯ 1. Yes", "   2. Yes, allow reading from /tmp", "      and /private/tmp during this", "      session", "   3. Yes, and always allow access", "      to tmp/ from this project",
      "   4. No, and tell Claude", "      what to do", "      differently", "", " Esc to cancel · Tab to amend ·", " ctrl+e to explain"]
    const narrow = await term.askOn(showing(["❯ Look at the screenshot", "", "⏺ Reading /tmp/m1s.png", ...tall].join("\n")), "t", asks)
    check("terminal: a permission whose question is far above the bottom is asked now", narrow?.id === "permission", narrow)
    const moved = await term.askOn(showing(tall.map((l) => l.replace(" ❯ 1. Yes", "   1. Yes").replace("   4. No", " ❯ 4. No")).join("\n")), "t", asks)
    check("terminal: Approve doesn't press Enter while another choice than Yes is chosen", moved === null, moved)
    const gone = await term.askOn(showing([...tall.slice(5, 8), "", "⏺ Done.", "", "─".repeat(38), "❯ ", "─".repeat(38), "  ? for shortcuts"].join("\n")), "t", asks)
    check("terminal: a dialog above the user's prompt was answered", gone === null, gone)
    // Its agent saying it waits (Claude Code's session file) blocks its terminal whatever else says, until it no longer does.
    {
      const id = "claude-waits1"
      const state = term.plugin.services["terminal:state"] as (id: string) => Any, waits = term.plugin.services["terminal:agent-waits"] as (id: string, k: string | null) => void
      const before = state(id)
      waits(id, "question")
      const blocked = state(id)
      waits(id, null)
      check("terminal: its agent's word that it waits blocks it, and no longer once it doesn't", before === null && blocked?.state === "blocked" &&
        blocked.kind === "question" && blocked.from === "agent" && blocked.agent === "claude" && state(id) === null, [before, blocked, state(id)])
    }
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

  // Whose shells: a server's keeper and tmux server go by its port; an app that serves none (this test's, npm run
  // check's) has its own, so a test never lists, ends or drops the spare shells of a live server on the machine.
  {
    const { backendName } = await import("../../../plugins/core/terminal/backend.ts")
    const kept = $.app.plugins.find((p) => p.id === "terminal")!.exports.kept as { name: string; socket: string }
    check("terminal: the default port's keeper is vaultite, another port's its own, an app serving none this process's",
      backendName(8793) === "vaultite" && backendName(30123) === "vaultite-30123" && backendName(0, 42) === "vaultite-x42", [backendName(8793), backendName(30123), backendName(0, 42)])
    check("terminal: this test's app keeps its shells apart from a live server's", kept.name === `vaultite-x${process.pid}` &&
      kept.socket.includes(`-vaultite-x${process.pid}`), kept)
  }

  // The keeper lets go of a shell's pty once it ends (node-pty 1.1 kept both ends open on macOS: a keeper running for
  // days took the machine's ptys, and new terminals and tmux failed). (Windows: windows-terminal.ts.)
  if (process.platform !== "win32") {
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
    const stop = () => { try { process.kill(Number(fs.readFileSync(`${keeper.files}.pid`, "utf8")), "SIGTERM") } catch { /* none */ } }
    const access: unknown[] = [await keeper.access(tmp)]
    try {
      for (const [id, end] of ways) {
        await keeper.create(id, spec, { spare: id === "leak-spare" })
        const pid = Number(fs.readFileSync(`${keeper.files}.pid`, "utf8"))
        const open = ptys(pid)
        // Ended only once its prompt is up: a hangup sent while the shell still starts could be lost on a slow machine.
        const ready = await waitFor(async () => (await keeper.screen(id, 5)).trim() !== "", 10_000, 50)
        await end(id)
        const ended = await waitFor(async () => (await keeper.list()).length === 0, 15_000, 100)
        const left = (await waitFor(() => ptys(pid) === 0, 5_000, 100)) ? 0 : ptys(pid)
        seen.push({ id, open, ready, ended, left })
      }
      access.push(await keeper.access(tmp), await keeper.access(path.join(tmp, "no-such-folder")))
    } finally { stop() }
    check("terminal: the keeper lets go of a shell's pty once it ends", seen.every((s) => (s.open as number) >= 1 && s.ready && s.ended && s.left === 0), seen)
    // (Settings > Permissions: whether the keeper itself may read the vault, which macOS can refuse it and not the app)
    check("terminal: the keeper says whether it can read a folder, and never starts for that", JSON.stringify(access) ===
      JSON.stringify([null, { ok: true }, { ok: false, why: "the folder isn't there" }]), access)
  }

  // OSC 7501 (osc7501.ts): reports by the spec's rules, taken out of the output however it's cut, records' state; the
  // probe answered by the keeper before the primary DA after it (Claude Code reads a DA answer first as "not spoken").
  {
    const { parse, Records, Scanner, REPLY } = await import("../../../plugins/core/terminal/osc7501.ts")
    const b64 = (t: string) => Buffer.from(t).toString("base64")
    const tf = parse("state=blocked:kind=permission:app=terraform:msg=QXBwbHkgMyB0byBhZGQsIDEgdG8gY2hhbmdlLCAwIHRvIGRlc3Ryb3k/")
    check("osc7501: the spec's report", JSON.stringify(tf) === JSON.stringify({ state: "blocked", id: "", msg: "Apply 3 to add, 1 to change, 0 to destroy?", kind: "permission", app: "terraform" }), tf)
    const p = (b: string) => JSON.stringify(parse(b))
    check("osc7501: a malformed pair is skipped, an unknown key ignored, the last of a repeated key wins, spaces trimmed",
      p(" state = idle :nope: x=1 :foo=bar:state=done") === JSON.stringify({ state: "done", id: "" }), p(" state = idle :nope: x=1 :foo=bar:state=done"))
    check("osc7501: no state, or one it doesn't know, is ignored whole", parse("msg=aGk=") === null && parse("state=sleeping") === null)
    check("osc7501: a msg with a control character, base64 that doesn't decode, or past its limit discards the report (one outside the value characters is a malformed pair)",
      parse(`state=working:msg=${b64("one\ntwo")}`) === null && parse("state=working:msg=a") === null && p("state=working:msg=@@@") === JSON.stringify({ state: "working", id: "" }) && parse(`state=working:msg=${b64("x".repeat(2049))}`) === null &&
      parse(`state=working:title=${b64("x".repeat(193))}`) === null && parse(`state=working:msg=${b64("é 2048".padEnd(2047, "x"))}`) !== null)
    check("osc7501: an id outside its grammar is ignored (never the root's), a good one kept", parse("state=done:id=a//b") === null && parse(`state=done:id=${"a/".repeat(8)}a`) === null &&
      (parse("state=done:id=build/test") as { id: string }).id === "build/test")
    check("osc7501: kind only with blocked, progress only 0-100 with working or blocked, app in its characters",
      p("state=idle:kind=permission:progress=5:app=a b") === JSON.stringify({ state: "idle", id: "" }) &&
      p("state=working:progress=101:kind=auth") === JSON.stringify({ state: "working", id: "" }) && p("state=blocked:kind=auth:progress=40") === JSON.stringify({ state: "blocked", id: "", kind: "auth", progress: 40 }))
    check("osc7501: the probe, and an echoed answer isn't one", parse("?") === "probe" && parse(REPLY.slice(7, -2)) === null)
    // Cut at every place: the same reports, prompts and resets, and the output without the reports.
    const report = `\x1b]7501;state=working:app=x:msg=${b64("Building")}\x1b\\`, probe = "\x1b]7501;?\x07"
    const stream = `a${report}b\x1b]0;title\x07c${probe}\x1b[c\x1b]133;A\x07d\x1bc`
    const bad: unknown[] = []
    for (let k = 0; k <= stream.length; k++) {
      const sc = new Scanner(), x = sc.feed(stream.slice(0, k)), y = sc.feed(stream.slice(k))
      const seen = [...x.seen, ...y.seen].map((e) => e.t).join(), out = (x.out + y.out).replace(report, "").replace(probe, "")
      if (seen !== "report,probe,prompt,reset" || out !== "ab\x1b]0;title\x07c\x1b[c\x1b]133;A\x07d\x1bc") bad.push({ k, seen, out })
    }
    const whole = new Scanner().feed(stream)
    check("osc7501: found and taken out of the output wherever a chunk ends (one begun in an earlier chunk goes on whole)", !bad.length && !whole.out.includes("7501"), bad.slice(0, 3))
    const cancelled = new Scanner().feed("\x1b]7501;state=done\x1b[1mbold")
    check("osc7501: ESC that isn't ST cancels the report, and what it starts goes on", !cancelled.seen.length && cancelled.out === "\x1b[1mbold", cancelled)
    // Records: blocked anywhere wins, else the root's, else its children's; lifetimes; clear; app from an ancestor.
    const r = new Records()
    const say = (b: string) => r.report(parse(b) as Exclude<ReturnType<typeof parse>, "probe" | null>)
    say("state=working:app=deploy"); say(`state=working:id=us:msg=${b64("Pushing")}`); say(`state=blocked:kind=permission:id=eu:msg=${b64("Approve eu-west?")}`)
    const blocked = r.status()
    say("state=done:id=eu")
    const root = r.status()
    say("state=clear:id=us"); say("state=clear:id=eu"); say(`state=done:app=deploy:msg=${b64("Deployed")}`)
    check("osc7501: blocked anywhere is the terminal's state (app from the root), then the root's", JSON.stringify(blocked) === JSON.stringify({ state: "blocked", kind: "permission", msg: "Approve eu-west?", app: "deploy" }) &&
      root?.state === "working" && r.status()?.msg === "Deployed", [blocked, root, r.status()])
    say("state=working:id=job")
    r.drop()
    check("osc7501: a prompt or the program's end drops working and blocked, done stays", r.status()?.state === "done" && r.said().seen)
    say("state=working:id=a/b"); say("state=working:id=a/c"); say("state=clear:id=a")
    const kids = r.status()?.state
    say("state=clear")
    check("osc7501: clear removes a record and those beneath it; with no id, all", kids === "done" && r.status() === null && r.said().seen, kids)
    const many = new Records()
    for (let i = 0; i < 300; i++) many.report({ state: "working", id: `w${i}` })
    many.report({ state: "blocked", id: "w299" })
    check("osc7501: at most 256 records, the least recently updated going", many.status()?.state === "blocked" && (many as unknown as { map: Map<string, unknown> }).map.size === 256 &&
      !(many as unknown as { map: Map<string, unknown> }).map.has("w0"))
    // The keeper answers the probe in its place: the shell reads the answer, then the headless terminal's DA answer.
    if (process.platform !== "win32") await (async () => {
    const { ptydBackend } = await import("../../../plugins/core/terminal/backend.ts")
    const { waitFor } = await import("../lib.ts")
    const keeper = ptydBackend(`test7501-${process.pid}`, { daemon: path.resolve(import.meta.dirname, "../../../plugins/core/terminal/ptyd.ts") })
    const got = path.join(tmp, "probe-answer")
    const said: unknown[] = []
    keeper.status!.follow((id, s) => said.push({ id, ...s }))
    const script = `stty raw -echo; printf '\\033]7501;?\\033\\\\\\033[c'; dd bs=1 count=${REPLY.length + 7} of=${got} 2>/dev/null; ` +
      `printf '\\033]7501;state=blocked:kind=question:msg=${b64("Which port?")}\\033\\\\'; sleep 30`
    const spec = { shell: "/bin/sh", run: { command: script }, cwd: tmp, env: { PATH: "/usr/bin:/bin", HOME: tmp }, ctx: {}, cols: 80, rows: 24, scrollback: 100 }
    const stop = () => { try { process.kill(Number(fs.readFileSync(`${keeper.files}.pid`, "utf8")), "SIGTERM") } catch { /* none */ } }
    let answer = "", listed: unknown = null
    try {
      await keeper.create("probe1", { ...spec, run: { command: script } })
      await waitFor(() => fs.existsSync(got) && fs.statSync(got).size >= REPLY.length + 7, 10_000, 50)
      answer = fs.existsSync(got) ? fs.readFileSync(got, "latin1") : ""
      await waitFor(() => JSON.stringify(said).includes("Which port?"), 5_000, 50)
      listed = (await keeper.list()).find((x) => x.id === "probe1")?.said
      await keeper.kill("probe1")
    } finally { stop() }
    check("osc7501: the keeper answers the probe before the primary DA after it", answer.startsWith(REPLY) && answer.slice(REPLY.length).startsWith("\x1b[?"), JSON.stringify(answer))
    const blockedSaid = { seen: true, status: { state: "blocked", kind: "question", msg: "Which port?" } }
    check("osc7501: the keeper tells the server its records as they change (from the probe on: it speaks it), and lists them",
      JSON.stringify(said.at(-1)) === JSON.stringify({ id: "probe1", ...blockedSaid }) && said.every((x) => (x as { seen: boolean }).seen) &&
      JSON.stringify(listed) === JSON.stringify(blockedSaid), [said, listed])
    // An agent's hooks once it speaks OSC 7501 (its terminal's mark there): they say nothing.
    const term = await import("../../../plugins/core/terminal/plugin.ts")
    const { execFileSync } = await import("node:child_process")
    const dir = path.join(tmp, "osc-hooks"), file = path.join(dir, "state"), mark = path.join(dir, "state.osc")
    fs.mkdirSync(dir)
    const set = term.stateCommand(file, mark)
    execFileSync("/bin/sh", ["-c", set("waiting", "permission")])
    const before = fs.readFileSync(file, "utf8")
    fs.writeFileSync(mark, "")
    execFileSync("/bin/sh", ["-c", set("working")])
    check("osc7501: an agent's state hooks mark what it asks, and do nothing once it speaks OSC 7501", before === "waiting:permission" && fs.readFileSync(file, "utf8") === "waiting:permission", before)
    })()
  }

  if (process.platform === "win32") await (await import("./terminal-windows.ts")).default($)

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
