import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { isDeepStrictEqual } from "node:util"
import type { Any, VaultTest } from "./harness.ts"
import { freePort } from "../lib.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, tmp, vault } = $
  const { execute, servers, cliApi, vau } = $.vars
  // vau terminal (plugins/core/terminal/ops.ts) on a stand-in API and window (no shells): sessions and their tabs,
  // opening, resuming by title, typing, ending, tidying gone agents' tabs.
  {
    const calls: string[] = []
    const tabs = [["t1", "claude-live1"], ["t2", "claude-gone1"], ["t3", "k3j2h1g0"], ["t4", "claude-far@m1"], ["t5", "claude-new1"]].map(([id, t]) => ({ id, to: `view:terminal/${t}` }))
    const termApi = async (m: string, r: string, b?: unknown) => {
      calls.push(`${m} ${r}${b === undefined ? "" : ` ${JSON.stringify(b)}`}`)
      if (r.startsWith("terminals/sessions")) return { status: 200, body: { sessions: [{ id: "claude-live1", agent: "claude", process: "claude", clients: 1, started: Date.now() - 120000, title: "Fixing the build", state: "working" },
        { id: "a8f3k2m1", agent: null, process: "zsh", clients: 0, started: Date.now() - 60000, name: "Release notes" }], starting: ["claude-new1"], ...(r.includes("ended=1") ? { ended: [{ id: "q9w8e7r6", backend: "vaultite", command: "npm test", started: Date.now() - 90000, exit: { code: 3, signal: 0, at: Date.now() - 30000 } }] } : {}) } }
      if (r.includes("/capture?")) return { status: 200, body: { id: r.split("/")[1], format: "text", text: "line 1\nline 2" } }
      if (m === "POST" && r.endsWith("/wait")) return { status: 200, body: { met: "exit", timedOut: false, waited: 1.5, for: ["exit"], exit: { code: 3, signal: 0 } } }
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
      tr.code === 0 && tr.out.includes('claude-live1  claude (working)  "Fixing the build"  2m ago, tab in workspace 1') && tr.out.includes('a8f3k2m1  zsh  named "Release notes"') &&
      tr.out.includes("claude-gone1  gone, tab in workspace 1 (an agent's") && tr.out.includes("k3j2h1g0  gone, tab in workspace 1 (a new shell") && !tr.out.includes("claude-far") && !tr.out.includes("claude-new1"), tr)
    calls.length = 0
    tr = await term("tidy")
    check("vau terminal tidy: closes the tabs of agents' sessions that are gone, not shells', nor one still starting",
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
    calls.length = 0
    tr = await term("open", { agent: "claude", model: "opus", effort: "xhigh", mode: "auto", cwd: "/tmp" })
    const how = /^POST terminals\/(claude-[a-z0-9]{8}) (.*)$/.exec(calls.find((c) => c.startsWith("POST terminals/")) ?? "")
    check("vau terminal open: an agent's model, effort, mode and folder go with it", tr.code === 0 && how?.[2] === JSON.stringify({ model: "opus", effort: "xhigh", mode: "auto", cwd: "/tmp" }), [tr, calls])
    const uiWas = termCtx.ui
    termCtx.ui = async () => { throw new OpErr("no app window is open", 409) }
    tr = await term("open", { agent: "claude" })
    termCtx.ui = uiWas
    check("vau terminal open: no window open isn't an error (the session runs), it says so", tr.code === 0 && tr.out.includes("no app window is open, so no tab"), tr)
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
    check("vau terminal send: the text, then Enter", tr.code === 0 && calls.at(-1) === 'POST terminals/k3j2h1g0/send {"text":"npm test","enter":true,"confirm":true}', [tr, calls])
    // A terminal by its name, or the end of its id (one only: several are listed), or one that ended lately.
    const sent = async (id: string) => { calls.length = 0; const x = await term("send", { id, text: "hi" }); return [x, calls.find((c) => c.endsWith("/send {\"text\":\"hi\",\"enter\":true,\"confirm\":true}"))] as const }
    const [byName, toName] = await sent("release notes"), [bySuffix, toSuffix] = await sent("m1"), [, toEnd] = await sent("k2m1")
    check("vau terminal: a terminal by its name (any case) or the end of its id", byName.code === 0 && toName?.startsWith("POST terminals/a8f3k2m1/") &&
      bySuffix.code === 1 && bySuffix.err.includes("'m1'") && toEnd?.startsWith("POST terminals/a8f3k2m1/") && !toSuffix, [byName, toName, bySuffix, toEnd])
    tr = await term("send", { id: "live", text: "hi" })
    check("vau terminal: a name or end that names none says so", tr.code === 1 && tr.err.includes("no terminal 'live'"), tr)
    calls.length = 0
    tr = await term("key", { id: "Release notes", keys: ["C-c", "Up", "Enter"] })
    check("vau terminal key: the keys by name, in order", tr.code === 0 && calls.at(-1) === 'POST terminals/a8f3k2m1/send {"keys":["C-c","Up","Enter"]}' && tr.out === "Pressed C-c Up Enter in a8f3k2m1.", [tr, calls])
    tr = await term("capture", { id: "k3j2h1g0", lines: 20, format: "vt" })
    check("vau terminal capture: its lines as given", tr.code === 0 && tr.out === "line 1\nline 2" && calls.includes("GET terminals/k3j2h1g0/capture?format=vt&lines=20"), [tr, calls.slice(-1)])
    calls.length = 0
    tr = await term("wait", { id: "q9w8e7r6", for: ["exit"], timeout: 30 })
    check("vau terminal wait: one that ended lately counts, and its end says how", tr.code === 0 && tr.out === "q9w8e7r6 ended (exit code 3) after 1.5 s." &&
      calls.some((c) => c.startsWith("GET terminals/sessions?ended=1")) && calls.at(-1) === 'POST terminals/q9w8e7r6/wait {"for":["exit"],"timeout":30,"quiet":2}', [tr, calls])
    calls.length = 0
    tr = await term("send", { id: "Release notes", text: "Summarize it", wait: true, timeout: 60 })
    check("vau terminal send --wait: types, then waits for its turn to end (wait's default)", tr.code === 0 && calls.at(-1) === 'POST terminals/a8f3k2m1/wait {"timeout":60}' &&
      tr.out.endsWith("(Enter). a8f3k2m1 ended (exit code 3) after 1.5 s."), [tr, calls])
    {
      const asked: { op: string; p: Any }[] = []
      const waitAnswer = { id: "claude-far1", met: "exit", timedOut: false, waited: 2.5, for: ["exit"], exit: { code: 0, signal: 15, at: 1 } }
      const answers = new Map<string, object>(Object.entries({
        "terminal.wait": waitAnswer,
        "terminal.send": { id: "claude-far1", sent: 3, enter: true, submitted: false, why: "it was waiting on the user", met: null, timedOut: true, waited: 5, for: ["idle"], state: "blocked" },
        "terminal.end": { id: "claude-far1", ended: true, closedTabs: 1 },
        "terminal.rename": { id: "claude-far1", name: "far" },
        "terminal.capture": { id: "claude-far1", format: "text", text: "far line" },
        "terminal.start": { id: "k9j8h7g6", command: "make", shown: false },
      }))
      const port = await freePort()
      const server = http.createServer((req, res) => {
        let body = ""
        req.on("data", (d) => (body += d)).on("end", () => {
          const op = (req.url ?? "").replace("/api/ops/", "")
          asked.push({ op, p: JSON.parse(body || "{}") })
          res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(answers.get(op) ?? { error: "no such op" }))
        })
      }).listen(port, "127.0.0.1")
      await new Promise((r) => server.once("listening", r))
      const ms = $.app.plugins.find((x) => x.id === "machines")!.services, was = ms["machines:machine"]
      const studio = { id: "studio", label: "Studio", url: `http://127.0.0.1:${port}`, online: true, self: false, plugins: ["terminal"] }
      ms["machines:machine"] = async (id: string) => (id === "studio" ? studio : null)
      try {
        const out = async (verb: string, given: Parameters<typeof checkParams>[1]) => {
          const op = termPlugin.ops.find((o) => o.id === `terminal.${verb}`)!, p = checkParams(op, given), r = await op.run(p, termCtx)
          return { r: JSON.parse(JSON.stringify(r)), text: op.text!(r, p) }
        }
        const w = await out("wait", { id: "claude-far1@studio", for: ["exit"], timeout: 30 })
        check("vau terminal wait <id>@<machine>: asked there, its answer and text as it says",
          w.text === "claude-far1@studio ended (signal 15) after 2.5 s." && isDeepStrictEqual(w.r, { ...waitAnswer, id: "claude-far1@studio", machine: "studio" }) &&
          isDeepStrictEqual(asked.at(-1), { op: "terminal.wait", p: { id: "claude-far1", for: ["exit"], timeout: 30, quiet: 2 } }), [w, asked.at(-1)])
        const sd = await out("send", { id: "claude-far1@studio", text: "yes", wait: true, timeout: 5 })
        check("vau terminal send --wait <id>@<machine>: its answer's words, then the wait's",
          sd.text === "Typed into claude-far1@studio: yes (Enter). It didn't take it: it was waiting on the user. Still not idle after 5 s: claude-far1@studio is blocked." &&
          sd.r.sent === 3 && sd.r.machine === "studio", sd)
        const en = await out("end", { id: "claude-far1@studio", keepTabs: true })
        check("vau terminal end <id>@<machine>: its tabs as there", en.text === "Ended claude-far1@studio, closed its tab." && en.r.closedTabs === 1 && en.r.ended === true, en)
        const nm = await out("rename", { id: "claude-far1@studio", name: "far" })
        const cp = await out("capture", { id: "claude-far1@studio" })
        const st = await out("start", { command: "make", machine: "studio" })
        check("vau terminal rename, capture and start on another machine: their answers and words", nm.text === 'Named claude-far1@studio "far".' && cp.text === "far line" &&
          cp.r.format === "text" && st.text === 'Started k9j8h7g6@studio running "make".' && st.r.machine === "studio" && st.r.shown === false, [nm, cp, st])
      } finally {
        if (was) ms["machines:machine"] = was; else delete ms["machines:machine"]
        server.close()
      }
    }
    tr = await term("list", { ended: true })
    check("vau terminal --ended: the ones that ended lately, with how", tr.code === 0 && /q9w8e7r6 {2}npm test {2}ended just now \(exit code 3\)/.test(tr.out), tr)
    tr = await term("start", { command: "npm test", agent: "claude" })
    check("vau terminal start: a command or an agent, not both", tr.code === 1 && tr.err.includes("not both"), tr)
    calls.length = 0
    tr = await term("start", { command: "npm test", name: "tests", cwd: "/tmp" })
    const started = /^POST terminals\/([a-z0-9]{8}) (.*)$/.exec(calls.find((c) => c.startsWith("POST terminals/")) ?? "")
    check("vau terminal start: a command alone in a new terminal, no tab, its id answered", tr.code === 0 && !!started &&
      started[2] === JSON.stringify({ command: "npm test", name: "tests", cwd: "/tmp" }) && !calls.some((c) => c.startsWith("POST ui")) && tr.out.startsWith(`Started ${started[1]} running "npm test"`), [tr, calls])
    calls.length = 0
    tr = await term("end", { id: "claude-live1" })
    check("vau terminal end: ends it and closes its tabs", tr.code === 0 && calls.includes("DELETE terminals/claude-live1") &&
      calls.at(-1) === 'POST workspaces/close {"path":"view:terminal/claude-live1"}' && tr.out.includes("closed its tab"), [tr, calls])
    tr = await term("end")
    check("vau terminal end: without an id (no VAULTITE_TERMINAL) asks which", tr.code === 1 && tr.err.includes("which terminal"), tr)
    tr = await term("capture", { id: "claude-far@m1" })
    check("vau terminal: another machine's id goes to that machine", tr.code === 1 && /machine 'm1'/.test(tr.err), tr)
    // From the command line (the real routes: a session that isn't there is said, nothing starts): its words as the op's.
    tr = await vau("terminal", "send", "nosuch12", "npm", "test")
    check("vau terminal send: the id, then the rest of the words as the text", tr.code === 1 && tr.err.includes("no terminal session 'nosuch12'"), tr)
    tr = await execute(["terminal", "end"], { api: cliApi, env: { VAULTITE_TERMINAL: "nosuch2" }, stdin: async () => "" })
    check("vau terminal end: without an id, the terminal it runs in (VAULTITE_TERMINAL)", tr.code === 1 && tr.err.includes("no terminal 'nosuch2'"), tr)
    tr = await vau("terminal", "capture", "claude-far@m1")
    check("vau terminal capture: another machine's id, from the command line", tr.code === 1 && /machine 'm1'/.test(tr.err), tr)
    // vau terminal wait's exit code: the terminal's when it waited for its end (1 when it was lost with its terminal
    // server: how it ended is unknown), 124 when the time ran out.
    const { cli: termCli } = await import("../../../plugins/core/terminal/cli.ts")
    const code = termCli.ops!["terminal.wait"].code!
    check("vau terminal wait: exits with the terminal's code, 128 + a signal, 1 when it was lost, 124 on a timeout, 1 when it ended first",
      code({ met: "exit", exit: { code: 3, signal: 0 } }) === 3 && code({ met: "exit", exit: { code: 0, signal: 15 } }) === 143 && code({ met: null, timedOut: true }) === 124 &&
      code({ met: "exit", exit: { code: 0, signal: 0, lost: true } }) === 1 && code({ met: null, timedOut: false, exit: { code: 0, signal: 0 } }) === 1 && code({ met: "idle" }) === 0)
    // vau's --no-<switch> turns a switch off (vau terminal send --no-enter).
    const { entryOf } = await import("../../../core/ops.ts")
    let sentAs: Any = null
    const sendNo = await execute(["terminal", "send", "nosuch12", "hi", "--no-enter"], { env: {}, stdin: async () => "",
      api: async (_m: string, r: string, b?: unknown) => (r.startsWith("ops?") ? { status: 200, body: termPlugin.ops.map((o) => entryOf(o, "terminal")) } : (sentAs = b, { status: 200, body: "ok" })) })
    check("vau: --no-<switch> is the switch off", sendNo.code === 0 && sentAs?.enter === "false" && sentAs.text === "hi", [sendNo, sentAs])
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
      term.agentOf("claude-k3j2h1g0")?.profile === null && term.agentOf("resume-claude-0d1e2f3a-4444")?.resume === "0d1e2f3a-4444" &&
      JSON.stringify(term.agentOf("resume-claude_work-session_01AbC")) === JSON.stringify({ name: "claude", resume: "session_01AbC", profile: "work" }), term.agentOf("claude_work-k3j2h1g0"))
    check("terminal: @<machine> is another machine's", JSON.stringify(splitMachine("claude-k3j2@studio")) === JSON.stringify(["claude-k3j2", "studio"]) &&
      JSON.stringify(splitMachine("k3j2h1g0")) === JSON.stringify(["k3j2h1g0", ""]) && term.TERMINAL_ID.test("claude_work-k3@box-2") &&
      !term.TERMINAL_ID.test("a@B") && !term.TERMINAL_ID.test("a@b@c"), splitMachine("claude-k3j2@studio"))
    // An agent's questions on its screen: Claude Code's folder trust (before its hooks run) and permission, by their last lines.
    const cc = await import("../../../plugins/core/claude-code/plugin.ts")
    const asks = cc.plugin.services["agent-asks:claude"]()
    const showing = (text: string) => ({ capture: async () => ({ text, cols: 80, rows: 24, cursor: { x: 0, y: 0 }, alternate: false }) })
    const trust = await term.askOn(showing("Accessing workspace:\n\n /Users/sam/Notes\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm · Esc to cancel\n\n"), "t", asks)
    check("terminal: Claude Code's folder trust is a question, approved by choosing Yes in its menu (its default is No)", trust?.id === "trust" &&
      JSON.stringify(trust.approve) === JSON.stringify({ option: "Yes, I trust this folder" }) && JSON.stringify(trust.deny) === JSON.stringify({ option: "No, exit" }), trust)
    const imports = await term.askOn(showing(" Allow external CLAUDE.md file imports?\n External imports:\n   /Users/sam/rules.md\n\n ❯ No, disable external imports\n   Yes, allow external imports\n\n Enter to confirm · Esc to cancel"), "t", asks)
    check("terminal: its external imports prompt after it is one too, its choices its menu's words", imports?.id === "imports" &&
      JSON.stringify(imports.approve) === JSON.stringify({ option: "Yes, allow external imports" }), imports)
    const menu = " Accessing workspace:\n\n ❯ No, exit\n   Yes, I trust this folder\n\n Enter to confirm · Esc to cancel"
    check("terminal: a menu's cursor is read against the option to choose: rows below it, 0 on it, none when it isn't shown",
      term.menuAt(menu, "Yes, I trust this folder") === 1 && term.menuAt(menu, "No, exit") === 0 &&
      term.menuAt(menu.replace(" ❯ No", "   No").replace("   Yes", " ❯ Yes"), "No, exit") === -1 && term.menuAt(menu, "Yes, allow external imports") === null &&
      term.menuAt(menu.replace(" ❯ No", "   No"), "No, exit") === null && term.menuAt(" ❯ 1. Yes\n   2. No", "No") === 1, menu)
    const perm = await term.askOn(showing(" Bash command\n   rm -rf build\n Do you want to proceed?\n ❯ 1. Yes\n   2. No"), "t", asks)
    check("terminal: its permission dialog is one too, Yes first", perm?.id === "permission" && JSON.stringify(perm.approve) === JSON.stringify(["\r"]), perm)
    // A cloud session (session_...) continued here: claude --teleport, in a worktree beside a checkout of its repository.
    const cloudRun = await cc.plugin.services["agent:claude"]({ resume: "session_01AbCdEf", profile: null, context: "", state: null, prompt: "ignored" })
    check("terminal: a cloud session's terminal teleports it, no prompt", /claude --teleport '?session_01AbCdEf/.test(cloudRun.command) && !cloudRun.command.includes("--resume") && !cloudRun.command.includes("ignored"), cloudRun)
    {
      const tp = await import("../../../plugins/core/claude-code/teleport.ts")
      const { execFileSync } = await import("node:child_process")
      const { gitEnv } = await import("../../../core/gitenv.ts")
      const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "vau-teleport-")))
      const repo = path.join(base, "web"), git = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { stdio: "pipe", env: gitEnv() }).toString()
      fs.mkdirSync(repo)
      git(repo, "init", "-q"); git(repo, "-c", "user.email=a@b", "-c", "user.name=A", "commit", "-q", "--allow-empty", "-m", "x")
      git(repo, "remote", "add", "origin", "git@github.com:lighthouse/web.git")
      fs.writeFileSync(path.join(repo, "dirty.txt"), "the user's own change")
      const root = await tp.checkoutOf("lighthouse/web", [path.join(base, "nowhere"), repo])
      check("teleport: a checkout of the repository is found among the folders, by its remote", root === repo && await tp.checkoutOf("lighthouse/other", [repo]) === null, root)
      const wt = await tp.worktreeFor(repo, "session_01AbCdEf", "claude/fix-build")
      check("teleport: a new worktree beside it, named for the branch; the checkout untouched", wt === path.join(base, "web-fix-build") && fs.existsSync(path.join(wt, ".git")) &&
        fs.existsSync(path.join(repo, "dirty.txt")) && !fs.existsSync(path.join(wt, "dirty.txt")), wt)
      check("teleport: the same worktree again for that session's branch", await tp.worktreeFor(repo, "session_01AbCdEf", "claude/fix-build") === wt)
      git(wt, "checkout", "-q", "-b", "claude/fix-build")
      check("teleport: a worktree that has the branch is the one used", await tp.worktreeFor(repo, "session_09Zz", "claude/fix-build") === wt)
      // The op: in the folder named, its terminal named for the session, shown in a tab.
      const { checkParams, whoOf } = await import("../../../core/ops.ts")
      const said: string[] = []
      const ctx = { who: whoOf("cli", null), api: async (m: string, r: string, b?: unknown) => { said.push(`${m} ${r} ${b ? JSON.stringify(b) : ""}`.trim()); return {} },
        ui: async (b: unknown) => { said.push(`ui ${JSON.stringify(b)}`); return {} } }
      const top = cc.plugin.ops.find((o) => o.id === "claude-code.teleport")!
      const r = await top.run(checkParams(top, { session: "https://claude.ai/code/session_01AbCdEf?from=cli", cwd: wt, title: "Fix the build" }), ctx as never) as Any
      check("teleport op: its terminal starts in the folder, named, its tab opened", r.session === "session_01AbCdEf" && /^resume-claude(_\w+)?-session_01AbCdEf$/.test(r.id) &&
        said[0] === `POST terminals/${r.id} ${JSON.stringify({ cwd: wt })}` && said[1] === `POST terminals/${r.id}/name {"name":"Fix the build"}` &&
        said[2] === `ui {"action":"open","path":"view:terminal/${r.id}","newTab":true}`, [r, said])
      fs.rmSync(base, { recursive: true, force: true })
    }
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
      check("terminal: its agent's word that it waits blocks it, and no longer once it doesn't (at rest then)", before === null && blocked?.state === "blocked" &&
        blocked.kind === "question" && blocked.from === "agent" && blocked.agent === "claude" && state(id)?.state === "idle", [before, blocked, state(id)])
    }
    // Keys by name, as a terminal sends them (keys.ts).
    const { keyBytes, keysBytes } = await import("../../../plugins/core/terminal/keys.ts")
    check("terminal keys: tmux's names, modifiers, arrows in application cursor mode", keyBytes("Enter") === "\r" && keyBytes("C-c") === "\x03" && keyBytes("M-x") === "\x1bx" &&
      keyBytes("Up") === "\x1b[A" && keyBytes("Up", { appCursor: true }) === "\x1bOA" && keyBytes("C-Up") === "\x1b[1;5A" && keyBytes("S-Tab") === "\x1b[Z" &&
      keyBytes("F5") === "\x1b[15~" && keyBytes("F1") === "\x1bOP" && keyBytes("PageDown") === "\x1b[6~" && keyBytes("C-Space") === "\x00" && keyBytes("x") === "x" &&
      keyBytes("nope") === null && keysBytes(["Escape", "C-[", "BSpace"]) === "\x1b\x1b\x7f")
    // Vaultite's vau first on PATH after the user's startup files put another vau first (as Homebrew's shellenv does),
    // then QA's stand-in agents (VAULTITE_AGENT_BIN) before the user's own.
    const { execFileSync } = await import("node:child_process")
    const { SHELL_DIR, shellArgs, shellFiles } = await import("../../../plugins/core/terminal/launch.ts")
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
      // (and says where to get it, under the shell's error)
      let said = ""
      try { said = execFileSync(sh, ["-c", term.markMissing("no-such-agent-x1", path.join(home, "state-said"), sh, term.missingText("claude"))], { cwd: home, env, stdio: ["ignore", "pipe", "ignore"], timeout: 10_000 }).toString() } catch (e) { said = String((e as Any).stdout) }
      check(`terminal: ${path.basename(sh)} says where to get an agent that isn't installed`, said.trim() === "Claude Code isn't installed on this machine. Get it at https://claude.com/claude-code, then open it again.", said)
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
  // The terminal server up but not starting shells: each new terminal runs in this server instead, an error for Errors
  // (counted by kind), never an inbox message a terminal.
  {
    const keeper = ($.app.plugins.find((p) => p.id === "terminal")!.exports.kept as { backend: Any }).backend
    const was = { ready: keeper.ready, create: keeper.create }, logged: string[] = [], error = console.error
    keeper.ready = async () => true
    keeper.create = async () => { throw new Error("the terminal server didn't answer create") }
    console.error = (...a: unknown[]) => { logged.push(a.map(String).join(" ")) }
    const ids = ["kfal1b2c", "kfal3d4e"]
    try {
      for (const id of ids) await api("POST", `terminals/${id}`, { command: "sleep 20", cwd: tmp })
    } finally { Object.assign(keeper, was); console.error = error }
    const [, l] = await api("GET", "inbox/events")
    for (const id of ids) await api("DELETE", `terminals/${id}`)
    check("terminal: started while the terminal server can't: an error each in the log, no inbox message about them",
      logged.filter((x) => /keeper couldn't start a shell.*restarting the server ends it.*didn't answer create/.test(x)).length === 2 &&
      !l.events.some((e: Any) => ids.includes(e.terminal)), [logged, l.events.filter((e: Any) => ids.includes(e.terminal))])
  }

  // The terminal server lets go of a shell's pty once it ends (node-pty 1.1 kept both ends open on macOS: a keeper
  // running for days took the machine's ptys, and new terminals and tmux failed). (Windows: terminal-windows.ts.)
  if (process.platform !== "win32") {
    const { termdBackend } = await import("../../../plugins/core/terminal/backend.ts")
    const { execFileSync } = await import("node:child_process")
    const { waitFor } = await import("../lib.ts")
    const keeper = termdBackend(`test-${process.pid}`, { daemon: path.resolve(import.meta.dirname, "../../../plugins/core/terminal/termd/termd.ts") })
    const ptys = (pid: number) => process.platform === "linux"
      ? fs.readdirSync(`/proc/${pid}/fd`).filter((f) => { try { return /^\/dev\/(ptmx|pts\/)/.test(fs.readlinkSync(`/proc/${pid}/fd/${f}`)) } catch { return false } }).length
      : execFileSync("lsof", ["-p", String(pid)]).toString().split("\n").filter((l) => /\/dev\/(ptmx|ttys)|\(revoked\)/.test(l)).length
    const spec = { shell: "/bin/sh", run: null, cwd: tmp, env: { PATH: "/usr/bin:/bin", HOME: tmp }, ctx: {}, cols: 80, rows: 24, scrollback: 100 }
    // One at a time (a machine short of ptys still runs it), ended each way: killed, exiting, a spare taken then killed.
    const ways: [string, (id: string) => Promise<unknown>][] = [
      ["leak-kill", (id) => keeper.kill(id)],
      ["leak-exit", (id) => keeper.send(id, { text: "exit\r" })],
      ["leak-spare", async (id) => { await keeper.rename!(id, `${id}-taken`); await keeper.kill(`${id}-taken`) }],
    ]
    const seen: Record<string, unknown>[] = []
    // (ended even when a step throws: a keeper left behind holds its shells' ptys)
    const stop = () => { try { process.kill(Number(fs.readFileSync(`${keeper.files}.pid`, "utf8")), "SIGTERM") } catch { /* none */ } }
    const access: unknown[] = [await keeper.access(tmp)]
    // A shell of this process's own while the terminal server starts: on Linux it inherits that pty, and must let it go.
    const { createRequire } = await import("node:module")
    const own = (createRequire(import.meta.url)("node-pty") as typeof import("node-pty")).spawn("/bin/sh", [], { cwd: tmp, env: spec.env })
    try {
      for (const [id, end] of ways) {
        await keeper.create(id, spec, { spare: id === "leak-spare" })
        const pid = Number(fs.readFileSync(`${keeper.files}.pid`, "utf8"))
        const open = ptys(pid)
        // Ended only once its prompt is up: a hangup sent while the shell still starts could be lost on a slow machine.
        const ready = await waitFor(async () => (await keeper.capture(id, { format: "text", lines: 5 })).text.trim() !== "", 10_000, 50)
        await end(id)
        const ended = await waitFor(async () => (await keeper.list()).length === 0, 15_000, 100)
        const left = (await waitFor(() => ptys(pid) === 0, 5_000, 100)) ? 0 : ptys(pid)
        seen.push({ id, open, ready, ended, left })
      }
      access.push(await keeper.access(tmp), await keeper.access(path.join(tmp, "no-such-folder")))
    } finally { stop(); own.kill() }
    check("terminal: the terminal server lets go of a shell's pty once it ends", seen.every((s) => (s.open as number) >= 1 && s.ready && s.ended && s.left === 0), seen)
    // (Settings > Permissions: whether the terminal server itself may read the vault, which macOS can refuse it and not the app)
    check("terminal: the terminal server says whether it can read a folder, and never starts for that", JSON.stringify(access) ===
      JSON.stringify([null, { ok: true }, { ok: false, why: "the folder isn't there" }]), access)
  }

  if (process.platform !== "win32") {
    const { termdBackend } = await import("../../../plugins/core/terminal/backend.ts")
    const { pathToFileURL } = await import("node:url")
    const real = pathToFileURL(path.resolve(import.meta.dirname, "../../../plugins/core/terminal/termd/termd.ts")).href
    const slow = path.join(tmp, "slow-termd.mjs"), dead = path.join(tmp, "dead-termd.mjs")
    fs.writeFileSync(slow, `await new Promise((r) => setTimeout(r, 3200)); await import(${JSON.stringify(real)})\n`)
    fs.writeFileSync(dead, "process.exit(1)\n")
    const late = termdBackend(`test-slow-${process.pid}`, { daemon: slow }), gone = termdBackend(`test-dead-${process.pid}`, { daemon: dead })
    const up = await late.ready()
    if (up) process.kill(Number(fs.readFileSync(`${late.files}.pid`, "utf8")), "SIGTERM")
    const t0 = Date.now(), why = await gone.kill("x").then(() => "", (e: Error) => e.message), ms = Date.now() - t0
    check("terminal: a terminal server slow to start is waited for; one that ends as it starts fails at once, saying where its log is",
      up && /didn't start \(see .*test-dead-.*\.log\)/.test(why) && ms < 2500, [up, why, ms])
  }

  // The terminal server's core (host.ts) in this process: what it keeps of each terminal (meta, command, cwd), captures as
  // text, vt and html, keys by name, its events, and an ended one kept with how it ended.
  if (process.platform !== "win32") {
    const { localBackend } = await import("../../../plugins/core/terminal/backend.ts")
    const { waitFor } = await import("../lib.ts")
    const b = localBackend()
    const evs: { type: string; id: string; [k: string]: unknown }[] = []
    b.events!((ev) => evs.push(ev as never))
    check("terminal server: it says it draws pictures (an older one running on doesn't, so its Claude Code isn't told to)", (await b.pictures!()) === true)
    const spec = { shell: "/bin/sh", run: { command: "printf 'one\\n\\033[31mred\\033[0m\\n'; read x; echo \"got $x\"; exit 4" }, only: true, cwd: tmp,
      env: { PATH: "/usr/bin:/bin", HOME: tmp }, ctx: {}, cols: 40, rows: 6, scrollback: 50 }
    await b.create("cap1", spec, { command: "the test", meta: { name: "Capture test" } })
    await waitFor(async () => (await b.capture("cap1", { format: "text" })).text.includes("red"), 10_000, 50)
    const text = await b.capture("cap1", { format: "text" }), vt = await b.capture("cap1", { format: "vt" }), html = await b.capture("cap1", { format: "html" })
    const listed = (await b.list()).find((x) => x.id === "cap1")
    await b.setMeta!("cap1", { note: "Notes/Idea.md", name: null })
    const meta = (await b.list()).find((x) => x.id === "cap1")?.meta
    await b.send("cap1", { text: "hello" })
    await b.send("cap1", { keys: ["Enter"] })
    const ended = await waitFor(async () => (await b.list({ ended: true })).find((x) => x.id === "cap1")?.exit, 10_000, 50)
    const after = await b.capture("cap1", { format: "text", lines: 10 })
    check("terminal server: a terminal's text, vt (its colors) and html captures, its size and cursor", text.text === "one\nred" && /\x1b\[(?:0m\x1b\[)?(?:31|38;5;1)mred/.test(vt.text) &&
      /--vt-palette-1: #[0-9a-f]{6}/.test(html.text) && html.text.includes("color: var(--vt-palette-1);\">red<") && text.cols === 40 && text.rows === 6 && text.cursor.y === 2, [text, vt.text, html.text.slice(0, 80)])
    check("terminal server: it keeps what the app gives it (meta, what it runs, its folder)", listed?.command === "the test" && listed.meta?.name === "Capture test" && listed.cwd === tmp &&
      JSON.stringify(meta) === JSON.stringify({ note: "Notes/Idea.md" }), [listed, meta])
    check("terminal server: a command alone ends the terminal, its code kept, its screen still captured", (ended as { code: number })?.code === 4 &&
      after.ended === true && after.text.includes("got hello") && !(await b.list()).some((x) => x.id === "cap1"), [ended, after])
    check("terminal server: it tells what happens (started, meta, exited with how)", evs.map((e) => e.type).filter((t) => ["started", "meta", "exited"].includes(t)).join() === "started,meta,exited" &&
      (evs.find((e) => e.type === "exited")?.exit as { code: number })?.code === 4 && (evs[0].info as { command?: string })?.command === "the test", evs.map((e) => e.type))
    // (sent once its tty is raw (said as worked out, so not its command line), not after a guess: C-c ended a slow one)
    await b.create("keys1", { ...spec, run: { command: "stty raw -echo; echo raw-$((6 * 7)); dd bs=1 count=8 2>/dev/null | od -An -c; sleep 5" } })
    await waitFor(async () => /raw-42/.test((await b.capture("keys1", { format: "text" })).text) || null, 10_000, 50)
    await b.send("keys1", { keys: ["C-c", "Up", "Escape", "M-x", "Tab"] })
    const keyed = await waitFor(async () => { const t = (await b.capture("keys1", { format: "text" })).text; return /\\t/.test(t) ? t : null }, 5_000, 50)
    await b.kill("keys1")
    check("terminal server: keys by name go as their bytes", typeof keyed === "string" && /003\s+033\s+\[\s+A\s+033\s+033\s+x\s+\\t/.test(keyed), keyed)
    let bad = ""
    await b.create("keys2", { ...spec, run: { command: "sleep 5" } })
    try { await b.send("keys2", { keys: ["Hyper-Q"] }) } catch (e) { bad = (e as Error).message }
    await b.kill("keys2")
    check("terminal server: a key it doesn't know is refused, saying which", bad.includes("'Hyper-Q' isn't a key"), bad)
    // An end while nobody listened (the app's server away): told to the next to subscribe, once.
    const { host } = await import("../../../plugins/core/terminal/termd/host.ts")
    const h = host({ log: () => {}, pid: process.pid, file: "test" })
    const heard: Record<string, unknown>[][] = [[], []]
    const conns = heard.map((into) => h.connect({ session: null, ready: false, send: (m) => into.push(m as never), backlog: () => 0 }))
    conns[0].take({ op: "create", id: "away1", file: "/bin/sh", args: ["-c", "exit 5"], cwd: tmp, env: { PATH: "/usr/bin:/bin" }, re: 1 })
    await waitFor(() => { conns[0].take({ op: "list", ended: true, re: 2 }); return heard[0].some((m) => m.re === 2 && (m.ended as unknown[])?.length) }, 5_000, 50)
    conns[0].take({ op: "subscribe" })
    conns[1].take({ op: "subscribe" })
    const told = heard.map((l) => l.filter((m) => m.type === "exited").map((m) => (m.exit as { code: number }).code))
    check("terminal server: an end nobody heard is told to the next to subscribe, once", JSON.stringify(told) === "[[5],[]]", told)
    const answers: Record<string, unknown>[] = []
    const asker = h.connect({ session: null, ready: false, send: (m) => answers.push(m), backlog: () => 0 })
    asker.take({ op: "create", file: "/bin/sh", re: 1 })
    asker.take({ op: "kill", id: 5, re: 2 })
    asker.take({ op: "nope", re: 3 })
    asker.take({ op: "create", id: "huge1", file: "/bin/sh", args: ["-c", "sleep 5"], cols: -3, rows: 1e9, re: 4 })
    asker.take({ op: "kill", id: "huge1", re: 5 })
    const said = (re: number) => String(answers.find((m) => m.re === re)?.error ?? "")
    const huge = JSON.stringify(answers.find((m) => m.re === 4)?.info ?? {})
    check("terminal server: a request it can't read is answered with which field is wrong",
      said(1).startsWith("a create request this server can't read: id ") && /^a kill request .*: id .*expected string, received number/.test(said(2)) && said(3) === "unknown op 'nope'", answers)
    check("terminal server: a new terminal's size is kept in bounds, as a resize's", huge.includes('"cols":2,"rows":500'), huge)
    const { Failure } = await import("../../../plugins/core/terminal/termd/protocol.ts")
    const { Wire, termdClient } = await import("../../../plugins/core/terminal/wire.ts")
    let reply: (m: Record<string, unknown>) => void = () => {}
    const wire = new Wire({ write: (m) => queueMicrotask(() => reply({ re: m.re, error: "its files are gone", code: "retiring" })), onMessage: (fn) => { reply = fn },
      onClose: () => {}, close: () => {}, pause: () => {}, resume: () => {} })
    const retired = await wire.request("hello", {}).then(() => null, (e) => e)
    check("terminal server: a retiring server's refusal reaches its client as a code", retired instanceof Failure && retired.code === "retiring", retired)
    const blocked = { seen: true, status: { state: "blocked", kind: "question", msg: "Which one?", app: "claude" } }
    const info = { id: "a1", pid: 7, shell: "zsh", process: "vim", cwd: "", command: "", created: 1, activity: 2, title: "Notes", cols: 80, rows: 24, clients: 1, spare: false,
      meta: { name: "Notes" }, said: blocked, via: 99 }
    const replies = new Map<unknown, object>([
      ["list", { sessions: [info], ended: [{ ...info, id: "a2", pid: 0, exit: { code: 1, signal: 0, at: 5 } }] }],
      ["capture", { text: "$ ls", cols: 80, rows: 24, cursor: { x: 3, y: 1 }, alternate: false, input: { line: "$ ls", typed: "ls", suggested: "" }, ended: true }],
      ["snapshot", { data: "screen" }],
    ])
    let hear: (m: import("../../../plugins/core/terminal/wire.ts").Msg) => void = () => {}
    const fake = new Wire({ write: (m) => queueMicrotask(() => hear({ re: m.re, ...replies.get(m.op) })), onMessage: (fn) => { hear = fn },
      onClose: () => {}, close: () => {}, pause: () => {}, resume: () => {} })
    const client = termdClient({ name: "fake", label: "Fake", control: async () => fake, running: async () => fake, open: async () => fake })
    const events: unknown[] = []
    client.backend.events((ev) => events.push(ev))
    client.follow(fake)
    hear({ t: "event", type: "started", id: "a1", info })
    hear({ t: "event", type: "trouble", id: "", text: "slow" })
    const listedOnes = await client.backend.list({ ended: true })
    const captured = await client.backend.capture("a1", { format: "text" })
    const snap = await new Promise((ok) => fake.call("snapshot", {}, (m) => ok(m.data)))
    const listedOne = { id: "a1", pid: 7, process: "vim", created: 1, activity: 2, attached: 1, title: "Notes", meta: { name: "Notes" }, said: blocked, cols: 80, rows: 24, via: 99 }
    const { pid: _, ...noPid } = listedOne
    const got = JSON.parse(JSON.stringify([listedOnes, captured, snap, events]))
    check("terminal server: its answers and events reach the client as they were sent", isDeepStrictEqual(got, [
      [listedOne, { ...noPid, id: "a2", exit: { code: 1, signal: 0, at: 5 } }],
      { text: "$ ls", cols: 80, rows: 24, cursor: { x: 3, y: 1 }, alternate: false, input: { line: "$ ls", typed: "ls", suggested: "" }, ended: true }, "screen",
      [{ type: "started", id: "a1", info: listedOne }, { type: "trouble", id: "", text: "slow" }]]), got)
    replies.set("capture", { ...replies.get("capture"), cursor: { x: "3", y: 1 } })
    const unread = await client.backend.capture("a1", { format: "text" }).then(() => "", (e: Error) => e.message)
    check("terminal server: an answer its client can't read fails saying which field", unread.startsWith("the terminal server's answer to capture can't be read: cursor.x "), unread)
  }
  // termd runs detached and keeps its code until it holds no terminals: what it loads stays its own few files.
  {
    const { diskTree, graphOf } = await import("../../../core/update/closure.ts")
    const root = path.resolve(import.meta.dirname, "../../..")
    const loads = [...graphOf(diskTree(root)).reach("termd").files.keys()].filter((f) => !f.startsWith("node_modules/") && !/^package(-lock)?\.json$/.test(f)).sort()
    const own = ["core/exit.ts", "core/update/lease.ts", "plugins/core/terminal/claude-pictures/decode/cells.ts", "plugins/core/terminal/keys.ts", "plugins/core/terminal/lines.ts",
      "plugins/core/terminal/osc7501.ts", ...["adopt", "host", "kitty", "png", "protocol", "screen", "screenworker", "spawnhelper", "termd"].map((f) => `plugins/core/terminal/termd/${f}.ts`),
      "plugins/core/terminal/vt/ghostty-vt.wasm", "plugins/core/terminal/vt/load.ts", "plugins/core/terminal/vt/vt.ts"]
    check("terminal server: loads only its own files (one more is code a running one never updates: keep it compatible, then list it here)",
      JSON.stringify(loads) === JSON.stringify(own), loads.filter((f) => !own.includes(f)))
  }

  // Taking over an older terminal server's terminals (termd/adopt.ts): a stand-in for the keeper before it (protocol 1:
  // ptyd), whose shell is held through it from then on, screen, input, status and end alike.
  if (process.platform !== "win32") {
    const net = await import("node:net")
    const { host } = await import("../../../plugins/core/terminal/termd/host.ts")
    const { waitFor } = await import("../lib.ts")
    const old = path.join(tmp, "old-keeper.sock"), got: string[] = []
    let conn: import("node:net").Socket | null = null
    const oldServer = net.createServer((sock) => {
      sock.setEncoding("utf8")
      let buf = ""
      sock.on("data", (d: string) => {
        buf += d
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
          const re = (x: object) => sock.write(JSON.stringify({ re: m.re, ...x }) + "\n")
          if (m.op === "hello") re({ v: 1, pid: 4242 })
          else if (m.op === "list") re({ sessions: [{ id: "old1", pid: 99, process: "zsh", created: 1000, title: "Old one", cols: 30, rows: 5, said: { seen: true, status: { state: "working" } } },
            { id: "vauspare-x", spare: true, process: "zsh", created: 1 }] })
          else if (m.op === "attach") { conn = sock; re({ cols: 30, rows: 5 }); sock.write(JSON.stringify({ t: "data", d: "in the picture already" }) + "\n") }
          else if (m.op === "snapshot") { re({ data: "old screen\r\n$ " }); sock.write(JSON.stringify({ t: "data", d: "after" }) + "\n") }
          else if (m.op === "input") got.push(Buffer.from(m.b64, "base64").toString())
          else if (m.op === "kill") { got.push(`kill ${m.id}`); re({}) }
          else if (m.re !== undefined) re({})
        }
      })
    })
    await new Promise<void>((r) => oldServer.listen(old, r))
    const h = host({ log: () => {}, pid: process.pid, file: "test" })
    const msgs: Record<string, unknown>[] = []
    const c = h.connect({ session: null, ready: false, send: (m) => msgs.push(m as never), backlog: () => 0 })
    c.take({ op: "adopt", socket: old, scrollback: 100, re: 1 })
    const adopted = await waitFor(() => msgs.find((m) => m.re === 1), 5_000, 20) as { adopted?: string[] } | undefined
    await new Promise((r) => setTimeout(r, 100))
    c.take({ op: "capture", id: "old1", re: 2 })
    const cap = await waitFor(() => msgs.find((m) => m.re === 2), 2_000, 20) as { text?: string } | undefined
    c.take({ op: "input", id: "old1", b64: Buffer.from("ls\r").toString("base64") })
    c.take({ op: "list", re: 3 })
    const info = (msgs.find((m) => m.re === 3) as { sessions: { id: string; via?: number; said: unknown; title: string }[] }).sessions[0]
    c.take({ op: "subscribe" })
    conn!.write(JSON.stringify({ t: "exit", code: 2, signal: 0 }) + "\n")
    const exited = await waitFor(() => msgs.find((m) => m.type === "exited"), 2_000, 20) as { exit?: { code: number } } | undefined
    oldServer.close()
    check("terminal server: it takes over an older one's terminals (not its spares, which end), held through it", JSON.stringify(adopted?.adopted) === '["old1"]' &&
      got.includes("kill vauspare-x") && info.via === 4242 && info.title === "Old one" && JSON.stringify(info.said) === JSON.stringify({ seen: true, status: { state: "working" } }), [adopted, got, info])
    check("terminal server: an adopted terminal's screen is its picture then what came after, its input goes through, its end is told",
      cap?.text === "old screen\n$ after" && got.includes("ls\r") && exited?.exit?.code === 2, [cap, got, exited])
  }

  // Protocols 2 (termd with xterm.js), 3 (before pictures) and 4 (screens on its loop): its changes come as events once
  // subscribed, its picture is its serialize.
  for (const v of [2, 3, 4]) if (process.platform !== "win32") {
    const net = await import("node:net")
    const { host } = await import("../../../plugins/core/terminal/termd/host.ts")
    const { waitFor } = await import("../lib.ts")
    const old = path.join(tmp, `old-termd${v}.sock`), ops: string[] = []
    let ctl: import("node:net").Socket | null = null
    const oldServer = net.createServer((sock) => {
      sock.setEncoding("utf8")
      let buf = ""
      sock.on("data", (d: string) => {
        buf += d
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
          const re = (x: object) => sock.write(JSON.stringify({ re: m.re, ...x }) + "\n")
          ops.push(m.op)
          if (m.op === "hello") { ctl ??= sock; re({ v, pid: 4343 }) }
          else if (m.op === "list") re({ sessions: [{ id: "two1", pid: 98, process: "claude", created: 2000, title: "Two", cols: 40, rows: 6, said: { seen: true, status: null } }] })
          else if (m.op === "attach") re({ cols: 40, rows: 6 })
          else if (m.op === "snapshot") re({ data: "\x1b[1mtwo\x1b[0m screen\r\n\x1b[?2004h> " })
          else if (m.re !== undefined) re({})
        }
      })
    })
    await new Promise<void>((r) => oldServer.listen(old, r))
    const h = host({ log: () => {}, pid: process.pid, file: "test" })
    const msgs: Record<string, unknown>[] = []
    const c = h.connect({ session: null, ready: false, send: (m) => msgs.push(m as never), backlog: () => 0 })
    c.take({ op: "adopt", socket: old, scrollback: 100, re: 1 })
    const adopted = await waitFor(() => msgs.find((m) => m.re === 1), 5_000, 20) as { adopted?: string[] } | undefined
    ctl!.write(JSON.stringify({ t: "event", type: "status", id: "two1", said: { seen: true, status: { state: "blocked", kind: "permission" } } }) + "\n")
    ctl!.write(JSON.stringify({ t: "event", type: "title", id: "two1", title: "Two, renamed" }) + "\n")
    await new Promise((r) => setTimeout(r, 150))
    c.take({ op: "capture", id: "two1", re: 2 })
    c.take({ op: "list", re: 3 })
    const cap = await waitFor(() => msgs.find((m) => m.re === 2), 2_000, 20) as { text?: string } | undefined
    const info = (msgs.find((m) => m.re === 3) as { sessions: { said: unknown; title: string }[] }).sessions[0]
    const pasteOn = h.sessions.get("two1")?.term.mode(2004)
    oldServer.close()
    check(`terminal server: it takes over protocol ${v}'s terminals, their changes heard as events, their picture read (modes too)`, JSON.stringify(adopted?.adopted) === '["two1"]' &&
      ops.includes("subscribe") && !ops.includes("status") && cap?.text === "two screen\n>" && pasteOn === true && info.title === "Two, renamed" &&
      JSON.stringify(info.said) === JSON.stringify({ seen: true, status: { state: "blocked", kind: "permission" } }), [adopted, ops, cap, info, pasteOn])
  }

  if (process.platform !== "win32") {
    const { host } = await import("../../../plugins/core/terminal/termd/host.ts")
    const { HUNG } = await import("../../../plugins/core/terminal/termd/screen.ts")
    const { waitFor } = await import("../lib.ts")
    const h = host({ log: () => {}, pid: process.pid, file: "test" })
    const msgs: Record<string, unknown>[] = []
    const c = h.connect({ session: null, ready: false, send: (m) => msgs.push(m as never), backlog: () => 0 })
    c.take({ op: "subscribe" })
    c.take({ op: "create", id: "stuck1", file: "/bin/sh", args: ["-c", "printf 'before\\n'; read x; printf 'after\\n'; sleep 5"], cwd: tmp, env: { PATH: "/usr/bin:/bin" }, re: 1 })
    const s = h.sessions.get("stuck1")!
    await waitFor(() => { c.take({ op: "capture", id: "stuck1", re: 2 }); return /before/.test(String(msgs.findLast((m) => m.re === 2)?.text ?? "")) || null }, 5_000, 50)
    // (a capture asked while its screen has something it hasn't answered, then that taken as stuck)
    c.take({ op: "capture", id: "stuck1", re: 3 })
    const stuck = s.term.check(performance.now() + HUNG + 1)
    c.take({ op: "list", re: 4 })
    const listed = msgs.some((m) => m.re === 4)
    const failed = await waitFor(() => msgs.find((m) => m.re === 3), 2_000, 20) as { error?: string } | undefined
    const trouble = msgs.find((m) => m.type === "trouble") as { id?: string; text?: string } | undefined
    c.take({ op: "input", id: "stuck1", b64: Buffer.from("\r").toString("base64") })
    const after = await waitFor(async () => { c.take({ op: "capture", id: "stuck1", re: 5 }); await new Promise((r) => setTimeout(r, 50)); const t = String(msgs.findLast((m) => m.re === 5)?.text ?? ""); return /after/.test(t) ? t : null }, 5_000, 50)
    s.driver.kill()
    check("terminal server: a stuck screen is that terminal's alone (the server answers meanwhile), then it starts again blank, said as trouble",
      stuck && listed && /stuck/.test(failed?.error ?? "") && trouble?.id === "stuck1" && /started again blank/.test(trouble?.text ?? "") &&
      typeof after === "string" && !/before/.test(after), [stuck, listed, failed, trouble, after])

    c.take({ op: "create", id: "redraw1", file: "/bin/sh", args: ["-c", "trap 'echo \"drawn $(stty size)\"' WINCH; printf '\\033[?2004hready\\n'; while :; do sleep 0.05; done"],
      cwd: tmp, env: { PATH: "/usr/bin:/bin" }, cols: 80, rows: 24, re: 6 })
    const r = h.sessions.get("redraw1")!
    await waitFor(() => { c.take({ op: "capture", id: "redraw1", re: 7 }); return /ready/.test(String(msgs.findLast((m) => m.re === 7)?.text ?? "")) || null }, 5_000, 50)
    c.take({ op: "capture", id: "redraw1", re: 8 })
    r.term.check(performance.now() + HUNG + 1)
    const drawn = await waitFor(async () => { c.take({ op: "capture", id: "redraw1", re: 9 }); await new Promise((res) => setTimeout(res, 50)); const t = String(msgs.findLast((m) => m.re === 9)?.text ?? ""); return /drawn 24 80/.test(t) ? t : null }, 5_000, 50)
    const paste = r.term.mode(2004)
    r.driver.kill()
    check("terminal server: a screen started again blank has its program draw itself again, at its own size, its paste mode kept (a long text typed reaches it whole)",
      /drawn 24 80/.test(String(drawn)) && !/ready/.test(String(drawn)) && paste === true, [drawn, paste])
  }

  // A terminal server that stops answering (stuck): said once, its trouble told, what's asked then failing at once; heard
  // again, that ends. A slow answer alone (a busy machine's capture) isn't that, nor this server's own loop held up.
  if (process.platform !== "win32") {
    const net = await import("node:net")
    const { serverFiles, termdBackend } = await import("../../../plugins/core/terminal/backend.ts")
    const { waitFor } = await import("../lib.ts")
    const name = `test-stall-${process.pid}`, { socket, files } = serverFiles(name)
    let answering = true, ctl: import("node:net").Socket | null = null
    fs.writeFileSync(`${files}.pid`, "4747\n")
    const fake = net.createServer((sock) => {
      ctl ??= sock
      sock.setEncoding("utf8")
      let buf = ""
      sock.on("data", (d: string) => {
        buf += d
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
          if (!answering || m.re === undefined || m.op === "capture") continue
          sock.write(JSON.stringify({ re: m.re, ...(m.op === "list" ? { sessions: [] } : {}) }) + "\n")
        }
      })
    })
    await new Promise<void>((r) => fake.listen(socket, r))
    const said: string[] = []
    const keeper = termdBackend(name, { daemon: "/nonexistent", log: (...a) => said.push(a.join(" ")), probeMs: 800 })
    await keeper.list()

    let slow = ""
    await keeper.ask("capture", { id: "x1", format: "text" }, 600).catch((e: Error) => { slow = e.message })
    await new Promise((r) => setTimeout(r, 1200))
    const listed = await keeper.list().then(() => true, () => false)
    check("terminal server: one slow answer while it answers the rest is that request's error, not a stalled server",
      /didn.t answer capture in 1 s/.test(slow) && listed && keeper.trouble() === null && !said.some((l) => /didn't answer/.test(l)), [slow, listed, keeper.trouble(), said])

    answering = false
    const t0 = Date.now()
    const first = await keeper.list()
    const t1 = Date.now()
    await waitFor(() => keeper.trouble(), 5000, 20)
    const t2 = Date.now()
    let failedFast = ""
    await keeper.kill("x1").catch((e: Error) => { failedFast = e.message })
    const t3 = Date.now(), trouble = keeper.trouble()
    answering = true
    ctl!.write(JSON.stringify({ t: "event", type: "clients", id: "x1", clients: 0 }) + "\n")
    await new Promise((r) => setTimeout(r, 50))
    const cleared = keeper.trouble()
    fake.close(); ctl!.destroy()
    fs.rmSync(`${files}.pid`, { force: true })
    check("terminal server: one that stops answering even a probe is said once, its trouble told, what's asked then fails at once; heard again, that ends",
      first.length === 0 && t1 - t0 >= 4500 && t3 - t2 < 200 && /pid 4747\) hasn't answered since/.test(failedFast) && trouble?.pid === 4747 &&
      said.filter((l) => /didn't answer list in 5 s, nor a check in 1 s/.test(l)).length === 1 && cleared === null, [t1 - t0, t3 - t2, failedFast, trouble, said, cleared])

    const { spawn } = await import("node:child_process")
    const name2 = `test-busy-${process.pid}`, { socket: socket2 } = serverFiles(name2)
    const child = spawn(process.execPath, ["-e", `const net = require("node:net"); net.createServer((s) => { s.setEncoding("utf8"); let b = "";
      s.on("data", (d) => { b += d; for (let i = b.indexOf("\\n"); i >= 0; i = b.indexOf("\\n")) { const m = JSON.parse(b.slice(0, i)); b = b.slice(i + 1);
      if (m.re !== undefined) s.write(JSON.stringify({ re: m.re, sessions: [] }) + "\\n") } }) }).listen(process.argv[1], () => console.log("up"))`, socket2], { stdio: ["ignore", "pipe", "inherit"] })
    await new Promise((r) => child.stdout!.once("data", r))
    const said2: string[] = []
    const keeper2 = termdBackend(name2, { daemon: "/nonexistent", log: (...a) => said2.push(a.join(" ")), probeMs: 800 })
    await keeper2.list()
    const asked = keeper2.ask("list", {}, 300).then(() => "", (e: Error) => e.message)
    await new Promise((r) => setTimeout(r, 0))
    await new Promise<void>((r) => setImmediate(() => { let spins = 0; for (const until = Date.now() + 1500; Date.now() < until;) spins++; r() }))
    const missed = await asked
    child.kill()
    fs.rmSync(socket2, { force: true })
    check("terminal server: an answer that came while this server's loop was held up is read, not taken for no answer",
      missed === "" && keeper2.trouble() === null && said2.length === 0, [missed, said2])
  }

  // One it couldn't take over (its snapshot failed: too slow on a loaded machine) still runs there: it isn't told as
  // ended, and it's taken over when asked again. That server going away then ends it as lost, not as a clean exit.
  if (process.platform !== "win32") {
    const net = await import("node:net")
    const { host } = await import("../../../plugins/core/terminal/termd/host.ts")
    const { waitFor } = await import("../lib.ts")
    const old = path.join(tmp, "old-keeper2.sock"), socks = new Set<import("node:net").Socket>()
    let snapFails = true
    const oldServer = net.createServer((sock) => {
      socks.add(sock)
      sock.setEncoding("utf8")
      let buf = ""
      sock.on("data", (d: string) => {
        buf += d
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
          const re = (x: object) => sock.write(JSON.stringify({ re: m.re, ...x }) + "\n")
          if (m.op === "hello") re({ v: 1, pid: 4343 })
          else if (m.op === "list") re({ sessions: [{ id: "old2", pid: 98, process: "zsh", created: 1000, cols: 30, rows: 5 }] })
          else if (m.op === "attach") re({ cols: 30, rows: 5 })
          else if (m.op === "snapshot") re(snapFails ? { error: "too slow" } : { data: "old2 screen" })
          else if (m.re !== undefined) re({})
        }
      })
    })
    await new Promise<void>((r) => oldServer.listen(old, r))
    const h = host({ log: () => {}, pid: process.pid, file: "test" })
    const msgs: Record<string, unknown>[] = [], viewer: Record<string, unknown>[] = []
    const c = h.connect({ session: null, ready: false, send: (m) => msgs.push(m as never), backlog: () => 0 })
    c.take({ op: "subscribe" })
    c.take({ op: "adopt", socket: old, scrollback: 100, re: 1 })
    const first = await waitFor(() => msgs.find((m) => m.re === 1), 5_000, 20) as { adopted?: string[] } | undefined
    await new Promise((r) => setTimeout(r, 100))
    const endedThen = msgs.filter((m) => m.type === "exited"), heldThen = h.sessions.has("old2")
    snapFails = false
    c.take({ op: "adopt", socket: old, scrollback: 100, re: 2 })
    const again = await waitFor(() => msgs.find((m) => m.re === 2), 5_000, 20) as { adopted?: string[] } | undefined
    const v = h.connect({ session: null, ready: false, send: (m) => viewer.push(m as never), backlog: () => 0 })
    v.take({ op: "attach", id: "old2", re: 1 })
    await waitFor(() => viewer.find((m) => m.re === 1), 2_000, 20)
    oldServer.close()
    for (const sock of socks) sock.destroy()
    const lost = await waitFor(() => msgs.find((m) => m.type === "exited"), 2_000, 20) as { exit?: { code: number; lost?: boolean } } | undefined
    check("terminal server: one it couldn't take over isn't told as ended, and is taken over when asked again",
      JSON.stringify(first?.adopted) === "[]" && !endedThen.length && !heldThen && JSON.stringify(again?.adopted) === '["old2"]', [first, endedThen, heldThen, again])
    check("terminal server: one whose older server went away ends lost, its viewers told so", lost?.exit?.lost === true &&
      viewer.some((m) => m.t === "exit" && m.lost === true), [lost, viewer.filter((m) => m.t === "exit")])
  }

  // When the terminal server can't start, the server's own (localBackend) takes over the older one's terminals: listed.
  if (process.platform !== "win32") {
    const net = await import("node:net")
    const { localBackend } = await import("../../../plugins/core/terminal/backend.ts")
    const old = path.join(tmp, "old-keeper3.sock"), socks = new Set<import("node:net").Socket>()
    const oldServer = net.createServer((sock) => {
      socks.add(sock)
      sock.setEncoding("utf8")
      let buf = ""
      sock.on("data", (d: string) => {
        buf += d
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1)
          const re = (x: object) => sock.write(JSON.stringify({ re: m.re, ...x }) + "\n")
          if (m.op === "hello") re({ v: 1, pid: 4444 })
          else if (m.op === "list") re({ sessions: [{ id: "old3", pid: 97, process: "zsh", created: 1000, cols: 30, rows: 5 }] })
          else if (m.op === "attach") re({ cols: 30, rows: 5 })
          else if (m.op === "snapshot") re({ data: "old3 screen" })
          else if (m.re !== undefined) re({})
        }
      })
    })
    await new Promise<void>((r) => oldServer.listen(old, r))
    const asked: string[] = []
    const lb = localBackend({ oldServers: [{ socket: old, files: old }], adoptOld: async () => { asked.push("adopt?"); return true } })
    const none = await localBackend({ oldServers: [{ socket: old, files: old }], adoptOld: async () => false }).list()
    const all = await lb.list(), listed = all.map((x) => x.id)
    oldServer.close()
    for (const sock of socks) sock.destroy()
    check("terminal: when the terminal server can't start, this server takes over the older one's terminals (only then), listed as held through it",
      JSON.stringify(listed) === '["old3"]' && all[0]?.via === 4444 && all[0]?.pid === 97 && asked.length > 0 && none.length === 0, [all, asked, none])
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
    {
      // The keeper's newline JSON: every line whole, however it's cut (a long one in many pieces, several in one).
      const { lineReader } = await import("../../../plugins/core/terminal/lines.ts")
      const text = `{"a":1}\n{"b":"${"x".repeat(5000)}"}\n\n{"c":3}\n`, cuts: string[][] = []
      for (const size of [1, 7, 64, 4096, text.length]) {
        const got: string[] = [], read = lineReader((l) => got.push(l))
        for (let i = 0; i < text.length; i += size) read(text.slice(i, i + size))
        cuts.push(got)
      }
      check("keeper lines: each whole, however the stream is cut", cuts.every((g) => g.join("\n") + "\n" === text && g.length === 4), cuts.map((g) => g.length))
    }
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
    const { termdBackend } = await import("../../../plugins/core/terminal/backend.ts")
    const { waitFor } = await import("../lib.ts")
    const keeper = termdBackend(`test7501-${process.pid}`, { daemon: path.resolve(import.meta.dirname, "../../../plugins/core/terminal/termd/termd.ts") })
    const got = path.join(tmp, "probe-answer")
    const said: unknown[] = []
    keeper.events!((ev) => { if (ev.type === "status") said.push({ id: ev.id, ...ev.said }) })
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
    check("osc7501: the terminal server answers the probe before the primary DA after it", answer.startsWith(REPLY) && answer.slice(REPLY.length).startsWith("\x1b[?"), JSON.stringify(answer))
    const blockedSaid = { seen: true, status: { state: "blocked", kind: "question", msg: "Which port?" } }
    check("osc7501: the terminal server tells the app its records as they change (from the probe on: it speaks it), and lists them",
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

  // A terminal's agent state (state.ts): every source an event, one step saying what it is. Its program gone back to its
  // shell (quit, crashed, interrupted) ends what it said it worked on, unless it spoke after it was seen gone.
  {
    const { fresh, step, nowOf } = await import("../../../plugins/core/terminal/state.ts")
    const run = (evs: Parameters<typeof step>[1][]) => evs.reduce((t, ev, i) => step(t, ev, 1000 + i * 1000), fresh("claude"))
    const gone = run([{ type: "hooks", text: "working", at: 1 }, { type: "front", program: true, seen: 1500 }, { type: "front", program: false, seen: 2500 }])
    const spoke = run([{ type: "front", program: true, seen: 500 }, { type: "hooks", text: "working", at: 1 }, { type: "front", program: false, seen: 1500 }])
    check("terminal state: its program gone back to its shell is idle, whatever its hooks said; seen before it last spoke, it still works",
      nowOf(gone)?.state === "idle" && nowOf(gone)?.from === "shell" && nowOf(spoke)?.state === "working", [nowOf(gone), nowOf(spoke)])
    const starting = run([{ type: "start" }, { type: "front", program: false, seen: 1500 }])
    const spoken = step(starting, { type: "hooks", text: "working", at: 1 }, 5000), back = step(spoken, { type: "front", program: false, seen: 6000 }, 6000)
    check("terminal state: while its agent starts, its shell's prompt is its own; once it spoke, its program gone ends it",
      starting.starting && nowOf(starting) === null && !spoken.starting && nowOf(back)?.state === "idle", [starting, back])
    const early = run([{ type: "hooks", text: "working", at: 1 }, { type: "start" }])
    check("terminal state: its agent heard before its start is told, it isn't starting again", !early.starting && nowOf(early)?.state === "working", early)
    const asked = run([{ type: "osc", said: { seen: true, status: { state: "working" } } }, { type: "waits", kind: "question" }])
    const answered = step(asked, { type: "waits", kind: null }, 9000)
    check("terminal state: its agent's word that it waits blocks it over OSC 7501; no longer, its OSC 7501 says again",
      nowOf(asked)?.state === "blocked" && nowOf(asked)?.from === "agent" && nowOf(answered)?.state === "working", [nowOf(asked), nowOf(answered)])
    const ended = step(gone, { type: "exit", code: 0, signal: 0, lost: true }, 9000)
    check("terminal state: an end is final, its state none", ended.phase.state === "ended" && nowOf(ended) === null && step(ended, { type: "hooks", text: "working", at: 1 }, 9500) === ended, ended.phase)
  }

  // An agent's terminal no page lists (the phone asleep): its program going back to its shell is seen by the server
  // itself, so its state is idle and a wait for idle ends, whether OSC 7501 or its hooks' file said it worked.
  if (process.platform !== "win32") {
    const { waitFor } = await import("../lib.ts")
    const term = await import("../../../plugins/core/terminal/plugin.ts")
    const { stateFile } = await import("../../../plugins/core/terminal/backends.ts")
    const svc = term.plugin.services as Record<string, Any>
    const dir = fs.mkdtempSync(path.join(tmp, "agent-left-")), script = path.join(dir, "agent.sh")
    // (it says it works in OSC 7501 or not at all, then runs till its file is there)
    fs.writeFileSync(script, "[ \"$1\" = osc ] && printf '\\033]7501;state=working:app=standin\\033\\\\'\nwhile [ ! -e \"$2\" ]; do sleep 0.1; done\n")
    svc["agent:standin"] = async (a: Any) => ({ command: `${a.prompt === "hooks" ? `${a.state("working")}; ` : ""}sh ${script} ${a.prompt} ${path.join(dir, a.prompt)}` })
    await $.api("PATCH", "config/plugin/terminal", { shell: "/bin/sh" })
    const logged: string[] = [], log = console.log
    console.log = (...a: unknown[]) => { if (String(a[0]).startsWith("terminal: standin-")) logged.push(String(a[0])); else log(...a) }
    try {
      for (const how of ["osc", "hooks"]) {
        const id = `standin-left${how}`
        await $.api("POST", `terminals/${id}`, { prompt: how })
        const worked = await waitFor(() => svc["terminal:state"](id)?.state === "working", 15_000, 100)
        fs.writeFileSync(path.join(dir, how), "")
        const r = await svc["terminal:wait"](id, { for: ["idle"], timeout: 20 })
        const [, list] = await $.api("GET", "terminals/sessions")
        const row = list.sessions?.find((s: Any) => s.id === id)
        check(`terminal: an agent whose program went back to its shell, no page listing it, is idle and a wait for idle ends (${how === "osc" ? "OSC 7501" : "its hooks' file"} said it worked)`,
          !!worked && r.met === "idle" && row?.state === "idle" && row.busy === false && logged.filter((l) => l.includes(`${id} working`) && l.endsWith("-> idle (shell)")).length === 1,
          [worked, r, row, logged])
        if (how === "hooks") {
          fs.chmodSync(stateFile(id), 0o644)
          const again = await waitFor(() => svc["terminal:state"](id)?.state === "working", 1000, 50)
          check("terminal: its hooks' file read again with nothing new written doesn't make an agent back at its shell work again", !again, logged)
        }
        await $.api("DELETE", `terminals/${id}`)
      }
      const endedFile = path.join(term.plugin.localDir(), "ended.json")
      const kept = await waitFor(() => { try { return JSON.parse(fs.readFileSync(endedFile, "utf8")).includes("standin-leftosc") } catch { return false } }, 5000, 100)
      check("terminal: one ended for good is kept on this machine, so its tab put back after a restart closes rather than starting it again", !!kept)
    } finally {
      console.log = log
      delete svc["agent:standin"]
      await $.api("PATCH", "config/plugin/terminal", { shell: null })
    }
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
