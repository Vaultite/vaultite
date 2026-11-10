import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"
import { waitFor } from "../lib.ts"

export default async ($: VaultTest) => {
  const { CLAUDE_DIR, VAULT, api, check, fixtureNow, tmp, write, TOOLS } = $
  // Transcripts are read as they grow, a chunk at a time: a line longer than a chunk (a tool's whole output) is whole.
  {
    const { readLines } = await import("../../../core/agents.ts")
    const f = path.join(tmp, "long-lines.jsonl"), lines = ["a", "x".repeat(10_000), "", "b".repeat(37), "c".repeat(25_000)]
    fs.writeFileSync(f, lines.join("\n") + "\npartial")
    for (const chunk of [7, 4096, 1 << 22]) {
      const got: string[] = []
      const at = await readLines(f, 0, (b: Buffer) => { got.push(b.toString()) }, chunk)
      check(`transcripts: long lines read whole, a chunk of ${chunk} bytes`, JSON.stringify(got) === JSON.stringify(lines) && at === lines.join("\n").length + 1, [got.length, at])
    }
    // (a chat tab's hello and a state change's title read the same transcript at once)
    const { Transcript } = await import("../../../core/agents.ts")
    const said: string[] = [], t = new Transcript(f, () => ({ line: (l: string) => said.push(l), settle: () => {} }), ["a"])
    await Promise.all([t.read(), t.read(), t.read()])
    check("transcripts: reads at once feed each line once", said.length === 1, said.length)
  }
  // A scan kept on disk: a new server reads on from where the last stopped, and a scan of other code reads all again.
  {
    const { JsonlScan } = await import("../../../core/agents.ts")
    const dir = path.join(tmp, "kept-scan"), file = path.join(dir, "projects", "a.jsonl"), keep = path.join(dir, "scan.json")
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const row = (id: string) => JSON.stringify({ id, ts: Date.now() / 1000 }) + "\n"
    fs.writeFileSync(file, row("r1") + row("r2"))
    class Counted extends JsonlScan<{ ts: number }> {
      heard = 0
      protected line(l: Buffer) { this.heard++; const d = JSON.parse(l.toString()); this.resp.set(d.id, { ts: d.ts }) }
      protected extra() { return { heard: "before" } }
      protected restore(x: unknown) { this.restored = x }
      restored: unknown = null
      keepNow() { (this as unknown as { save(): void }).save() }
    }
    const first = new Counted(() => [path.join(dir, "projects")], () => keep)
    await first.refresh()
    first.keepNow()
    fs.appendFileSync(file, row("r3"))
    const next = new Counted(() => [path.join(dir, "projects")], () => keep)
    await next.refresh()
    check("kept scan: a restart reads only what was added, with what was read and its extras", next.heard === 1 && next.resp.size === 3 &&
      (next.restored as Any)?.heard === "before", [next.heard, next.resp.size, next.restored])
    class Other extends JsonlScan<{ ts: number }> { heard = 0; protected line() { this.heard++ } }
    const other = new Other(() => [path.join(dir, "projects")], () => keep)
    await other.refresh()
    check("kept scan: another scan's code reads every line again", other.heard === 3, other.heard)
  }
  // Claude Code: one session's conversation (plugins/core/claude-code/transcript.ts), from the fixture.
  {
    const sid = "0a1b2c3d-1111-4222-8333-444455556666"
    const tfile = path.join(CLAUDE_DIR, "projects", "-Users-sam-lighthouse", `${sid}.jsonl`)
    let [c, t] = await api("GET", `claude-code/session/${sid}`)
    check("claude session: found by id, with title, folder, model and times", c === 200 && t.title === "Upload test fix" &&
      t.cwd === "/Users/sam/lighthouse" && t.model === "Opus 5.5" && t.project === "lighthouse" && t.branch === "main" &&
      t.first === "2026-09-28T09:00:01.000Z" && t.last === "2026-09-28T09:01:01.000Z", [c, { ...t, entries: undefined }])
    const kinds = t.entries?.map((e: Any) => e.kind).join(",")
    check("claude session: what was said and each tool call, nothing else (thinking, meta, sidechain, attachments)",
      kinds === "user,assistant,tool,tool,assistant,user" && t.total === 6 && t.start === 0, kinds)
    check("claude session: system reminders left out, a slash command as a command", t.entries[0].text === "Fix the flaky upload test" &&
      t.entries[5].text === "`/review upload`", [t.entries[0].text, t.entries[5]?.text])
    const [bash, read] = [t.entries[2], t.entries[3]]
    check("claude session: a tool call is one line with its result", bash.name === "Bash" && bash.summary === "Run the upload tests" &&
      bash.error === true && bash.result === "1 failing: upload retries" && JSON.parse(bash.input).command === "npm test -- upload" &&
      read.summary === "/Users/sam/lighthouse/test/upload.test.ts" && read.result === "it('retries', ...)" && !read.error, [bash, read])
    ;[, t] = await api("GET", `claude-code/session/${sid}?limit=2`)
    check("claude session: a page is the newest entries, and says where it starts", t.start === 4 && t.entries.length === 2 &&
      t.entries[0].kind === "assistant", [t.start, t.entries?.length])
    ;[, t] = await api("GET", `claude-code/session/${sid}?limit=2&before=4`)
    check("claude session: earlier pages", t.start === 2 && t.entries[0].name === "Bash", [t.start])
    // What it waits on (agent-asking): its last tool call without a result, an AskUserQuestion or a plan; and the keys.
    {
      const { askingIn } = await import("../../../plugins/core/claude-code/transcript.ts")
      const ask = { type: "assistant", message: { content: [{ type: "tool_use", id: "tu1", name: "AskUserQuestion", input: { questions: [
        { question: "Which fruit?", header: "Fruit", options: [{ label: "Apple", description: "Red" }, { label: "Banana" }] },
        { question: "Toppings?", multiSelect: true, options: [{ label: "Cheese", description: "cheese" }, { label: "Basil" }, { label: "" }] }] } }] } }
      const answered = { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "tu1", content: "Apple" }] } }
      const lines = (...xs: unknown[]) => `{"partial\n${xs.map((x) => JSON.stringify(x)).join("\n")}\n`
      const a = askingIn(lines({ type: "user", message: { content: "Ask me" } }, ask)) as Any
      check("asking: an open AskUserQuestion, its questions and options (an empty one left out, a description saying only its label too)", a?.kind === "question" && a.questions.length === 2 &&
        a.questions[0].header === "Fruit" && a.questions[0].options[0].description === "Red" && !a.questions[0].multi &&
        a.questions[1].multi === true && a.questions[1].options.length === 2 && !a.questions[1].options[0].description, a)
      const plan = { type: "assistant", message: { content: [{ type: "tool_use", id: "tu2", name: "ExitPlanMode", input: { plan: "## Plan\n1. Do it" } }] } }
      const bash = { type: "assistant", message: { content: [{ type: "tool_use", id: "tu3", name: "Bash", input: { command: "ls" } }] } }
      check("asking: answered, a plan, another tool waiting, or a prompt after it",
        askingIn(lines(ask, answered)) === null && (askingIn(lines(plan)) as Any)?.plan === "## Plan\n1. Do it" &&
        askingIn(lines(ask, answered, bash)) === null && askingIn(lines(ask, { type: "user", message: { content: "Never mind" } })) === null)
      // Its background tasks: a call run in the background, or an agent launched async, runs until its notification.
      const { Conversation } = await import("../../../plugins/core/claude-code/transcript.ts")
      const cv = new Conversation(), feed = (x: unknown) => cv.line(JSON.stringify(x))
      feed({ type: "assistant", message: { content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "npm run build", run_in_background: true } }, { type: "tool_use", id: "a1", name: "Agent", input: { prompt: "x" } }] } })
      feed({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a1", content: "Async agent launched successfully.\nagentId: x" }] } })
      const both = cv.background.size
      feed({ type: "queue-operation", operation: "enqueue", content: "<task-notification>\n<task-id>t</task-id>\n<tool-use-id>b1</tool-use-id>\n<status>completed</status>\n</task-notification>" })
      check("transcript: background tasks run till their notification", both === 2 && cv.background.size === 1 && cv.background.has("a1"), [both, [...cv.background]])
      const keys = (await import("../../../plugins/core/claude-code/plugin.ts")).plugin.services["agent-pick:claude"] as (q: Any, c: Any) => string[]
      const one = [{ question: "Q", options: [{ label: "A" }, { label: "B" }, { label: "C" }] }]
      check("pick keys: a digit; typed: the one after the options, the text, Enter; several or a multi-select end with 1 on the review",
        keys(one, [[2]]).join("|") === "2" && keys(one, ["my own"]).join("|") === "4|my own|\r" &&
        keys([...one, { question: "M", multi: true, options: [{ label: "x" }, { label: "y" }] }], [[3], [1, 2]]).join("|") === "3|1|2|\t|1")
      // (as its picker took them, v2.1.317: a multi-select's digits toggle without moving the cursor, Tab leaves its text for Submit)
      const multi = { question: "M", multi: true, options: [{ label: "x" }, { label: "y" }, { label: "z" }] }
      check("pick keys: a multi-select's own answer is ↓ to its row past the options, the text, Tab, Enter; with picks or alone",
        keys([multi], [{ options: [1, 3], text: "Feta" }]).join("|") === "1|3|\x1b[B|\x1b[B|\x1b[B|Feta|\t|\r|1" &&
        keys([...one, multi], ["Kiwi", "Feta"]).join("|") === "4|Kiwi|\r|\x1b[B|\x1b[B|\x1b[B|Feta|\t|\r|1")
      check("pick keys: Chat about this is the one after Type something", keys(one, "chat").join("|") === "5" && keys([multi, ...one], "chat").join("|") === "5")
    }
    // Its other dialogs, read off its screen: a question and its options, wrapped lines joined; not a prompt or output.
    {
      const { dialogOn } = await import("../../../plugins/core/claude-code/dialog.ts")
      const reads = ["⏺ Read(/tmp/olx/dash/build.py)", "", "─".repeat(40), " Read outside the working directories", "",
        " Allow this read outside the working directories?", " ❯ 1. Yes, and keep allowing any reads outside the", "      working directories",
        "   2. No, and block reads outside the working directories from now on", "   3. No, and ask again next time", "", " Esc to cancel"].join("\n")
      const q = dialogOn(reads)
      check("dialog: a choice on screen is its question and options (closed: only those), a wrapped label whole", q?.question === "Allow this read outside the working directories?" && q.closed === true &&
        q.options.map((o) => o.label).join("|") === "Yes, and keep allowing any reads outside the working directories|No, and block reads outside the working directories from now on|No, and ask again next time", q)
      const limit = dialogOn(["You've hit your limit · resets 5pm", "", "│ ❯ 1. Stop and wait for limit to reset │", "│   2. Switch account                  │"].join("\n"))
      check("dialog: without a line asking, the nearest line of text is its question; box sides left out", limit?.question === "You've hit your limit · resets 5pm" &&
        limit.options[1].label === "Switch account", limit)
      const typed = ["⏺ Steps:", "  1. Build it", "  2. Ship it", "", "─".repeat(40), "❯ ", "─".repeat(40), "  ? for shortcuts"].join("\n")
      const answered = reads.split("\n").slice(0, 11).join("\n") + "\n\n⏺ Done.\n\n❯ thanks"
      check("dialog: a numbered list in its output, under the user's prompt or with none chosen, isn't one",
        dialogOn(typed) === null && dialogOn(answered) === null && dialogOn("Steps:\n  1. Build it\n  2. Ship it") === null)
      const term = (await import("../../../plugins/core/terminal/plugin.ts")).plugin
      const cc = (await import("../../../plugins/core/claude-code/plugin.ts")).plugin
      const was = term.services["terminal:screen"]
      term.services["terminal:screen"] = async () => reads
      const asking = cc.services["agent-asking:claude"] as (t: string, s?: string) => Promise<Any>
      const got = await asking("claude-dlg1", "no-such-session")
      term.services["terminal:screen"] = async () => " Bash command\n   rm -rf build\n Do you want to proceed?\n ❯ 1. Yes\n   2. No"
      const perm = await asking("claude-dlg1", "no-such-session")
      term.services["terminal:screen"] = was
      check("asking: a dialog its terminal shows is a question to pick from; its permission isn't (Approve and Deny answer it)",
        got?.kind === "question" && got.questions[0].options.length === 3 && perm === null, [got, perm])
      // What a running session's file says it waits on goes to its terminal, and that it no longer does.
      const { tellWaits } = await import("../../../plugins/core/claude-code/plugin.ts")
      const dir = path.join(CLAUDE_DIR, "sessions"), file = path.join(dir, `${process.pid}.json`), told: [string, string | null][] = []
      const was2 = { of: term.services["terminal:of"], waits: term.services["terminal:agent-waits"] }
      term.services["terminal:of"] = async (pid: number) => (pid === process.pid ? "claude-w1" : null)
      term.services["terminal:agent-waits"] = (t: string, k: string | null) => { told.push([t, k]) }
      fs.mkdirSync(dir, { recursive: true })
      const session = (status: string, waitingFor?: string) => fs.writeFileSync(file, JSON.stringify({ pid: process.pid, sessionId: "w1", cwd: "/Users/sam/lighthouse", status, ...(waitingFor ? { waitingFor } : {}) }))
      session("waiting", "input needed"); await tellWaits()
      session("waiting", "permission prompt"); await tellWaits()
      session("waiting", "permission prompt"); await tellWaits()
      session("busy"); await tellWaits()
      fs.rmSync(file); Object.assign(term.services, { "terminal:of": was2.of, "terminal:agent-waits": was2.waits })
      check("waits: a session waiting on a dialog or a permission tells its terminal once each, and when it works again",
        JSON.stringify(told) === JSON.stringify([["claude-w1", "question"], ["claude-w1", "permission"], ["claude-w1", null]]), told)
    }
    // A running session: lines appended are read on from where it stopped; a long output is cut.
    fs.appendFileSync(tfile, JSON.stringify({ type: "assistant", sessionId: sid, cwd: "/Users/sam/lighthouse", timestamp: "2026-09-28T09:02:00.000Z",
      message: { model: "claude-opus-5-5", id: "msg_9", role: "assistant", content: [{ type: "tool_use", id: "toolu_9", name: "Grep", input: { pattern: "retry", path: "src" } }] } }) + "\n" +
      JSON.stringify({ type: "user", sessionId: sid, timestamp: "2026-09-28T09:02:01.000Z", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "x".repeat(9000) }] } }) + "\n")
    ;[, t] = await api("GET", `claude-code/session/${sid}`)
    const g = t.entries.at(-1)
    check("claude session: a growing transcript is read on", t.total === 7 && g.name === "Grep" && g.summary === "retry in src" &&
      g.result.length < 4200 && g.result.includes("more characters"), [t.total, g?.summary, g?.result?.length])
    ;[c] = await api("GET", "claude-code/session/nope")
    check("claude session: an unknown session is a 404", c === 404, c)
    ;[c] = await api("GET", "claude-code/session/..%2F..%2Fetc")
    check("claude session: not a path", c === 404, c)
    // (the blocks count the last 30 days, and the fixture's session is older: a reply of today's)
    fs.appendFileSync(tfile, JSON.stringify({ type: "assistant", sessionId: sid, cwd: "/Users/sam/lighthouse", timestamp: new Date(fixtureNow() - 1000).toISOString(),
      requestId: "req_10", message: { model: "claude-opus-5-5", id: "msg_10", role: "assistant", content: [{ type: "text", text: "Fixed." }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + "\n")
    // (read once the transcripts' scan, throttled to one per 5 s, has the reply)
    const cr = String(await waitFor(async () => { const [, r] = await api("GET", "render?path=Dashboards/Claude.md"); return typeof r === "string" && r.includes("lighthouse") && r }, 8000, 250))
    check("the Claude page has projects and models as two blocks", typeof cr === "string" && cr.includes("## Claude Code by project") &&
      cr.includes("## Claude Code by model") && cr.includes("lighthouse"), String(cr).slice(0, 400))
    check("Claude Code's costs are labelled estimates at list prices", cr.includes("_Costs estimated at list prices._"), String(cr).slice(0, 600))
    const tpl = fs.readFileSync(path.join(TOOLS, "..", "plugins", "core", "claude-code", "pages", "Claude.md"), "utf8")
    check("the Claude page template has both blocks", tpl.includes("```block-agent-projects\nagent: claude-code\n```") && tpl.includes("```block-agent-models\nagent: claude-code\n```"), tpl)
  }

  // Claude Code accounts: a sibling of the config folder with sessions is an account; a private one's usage counts, but
  // not its titles, folders or conversations; Terminal starts Claude Code in an account (its profile).
  {
    const WORK = path.join(tmp, "claude-work")
    const sid = "0d1e2f3a-4444-4555-8666-777788889999"
    const at = new Date(fixtureNow() - 60_000).toISOString()
    fs.mkdirSync(path.join(WORK, "projects", "-Users-sam-acme"), { recursive: true })
    fs.writeFileSync(path.join(WORK, "projects", "-Users-sam-acme", `${sid}.jsonl`), [
      { type: "user", uuid: "w0", sessionId: sid, cwd: "/Users/sam/acme", timestamp: at, message: { role: "user", content: "Migrate the billing tables" } },
      { type: "assistant", uuid: "w1", sessionId: sid, cwd: "/Users/sam/acme", timestamp: at, requestId: "req_w1",
        message: { model: "claude-opus-5-5", id: "msg_w1", role: "assistant", content: [{ type: "text", text: "Done." }],
          usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: "ai-title", sessionId: sid, aiTitle: "Billing tables migration" },
    ].map((l) => JSON.stringify(l)).join("\n") + "\n")
    let [c, accts] = await api("GET", "claude-code/accounts")
    check("claude accounts: the config folder and a sibling with sessions", c === 200 &&
      JSON.stringify(accts.map((a: Any) => a.id)) === JSON.stringify(["default", "work"]) && accts[1].label === "Work", accts)
    let [, u] = await api("GET", "claude-code?days=7")
    let s = u.sessions?.find((x: Any) => x.id === sid)
    check("claude accounts: all of them at once, each session with its account", s?.account === "work" && s.accountLabel === "Work" &&
      s.title === "Billing tables migration" && s.project === "acme" && u.accounts?.length === 2 && Array.isArray(u.servers), [s, u.accounts])
    ;[, u] = await api("GET", "claude-code?days=7&account=default")
    check("claude accounts: one account", !u.sessions.some((x: Any) => x.id === sid) && u.accounts.length === 1, u.accounts)
    ;[c] = await api("GET", "claude-code?account=nope")
    check("claude accounts: an unknown one is a 404", c === 404, c)
    ;[c] = await api("GET", `claude-code/session/${sid}`)
    check("claude accounts: another account's conversation reads", c === 200, c)
    // `for: companion`: the accounts its chat and jobs run in first, saying for what, as its settings say now.
    const ids = (xs: Any[]) => JSON.stringify(xs?.map((a: Any) => [a.id, a.uses ?? null]))
    write(".vaultite/plugins/companion/data.json", JSON.stringify({ agent: "claude_work", jobs_agent: "claude" }))
    ;[, u] = await api("GET", "claude-code/limits?for=companion")
    check("claude accounts: for a plugin, the accounts it uses come first, saying for what",
      ids(u.accounts) === JSON.stringify([["work", ["Companion chat"]], ["default", ["Jobs"]]]), u.accounts)
    write(".vaultite/plugins/companion/data.json", JSON.stringify({ agent: "claude_work", jobs_agent: "claude_work" }))
    ;[, u] = await api("GET", "claude-code?days=7&for=companion")
    check("claude accounts: one account used for both says both, the other after it",
      ids(u.accounts) === JSON.stringify([["work", ["Companion chat", "Jobs"]], ["default", null]]), u.accounts)
    write(".vaultite/plugins/companion/data.json", JSON.stringify({ agent: "codex", jobs_agent: "codex", mode: "off" }))
    ;[, u] = await api("GET", "claude-code/limits?for=companion")
    check("claude accounts: a chat on another agent, or off, isn't said; jobs not on Claude Code run in its default",
      ids(u.accounts) === JSON.stringify([["default", ["Jobs"]], ["work", null]]), u.accounts)
    write(".vaultite/plugins/companion/data.json", JSON.stringify({ agent: "claude_work", jobs_agent: "claude" }))
    ;[, u] = await api("GET", "claude-code/limits")
    const [, plainU] = await api("GET", "claude-code/limits?for=nobody")
    check("claude accounts: without for, or for a plugin that runs none, they're as they were",
      ids(u.accounts) === JSON.stringify([["default", null], ["work", null]]) && ids(plainU.accounts) === ids(u.accounts), [u.accounts, plainU.accounts])
    // vau limits: each account's week left, most room first, from what its status line last said.
    const soon = Math.floor(fixtureNow() / 1000) + 3 * 86400
    fs.mkdirSync(path.join(WORK, "usage-snapshots"), { recursive: true })
    fs.writeFileSync(path.join(WORK, "usage-snapshots", `${sid}.json`), JSON.stringify({ rate_limits: {
      five_hour: { used_percentage: 12, resets_at: soon - 3 * 86400 + 3600 }, seven_day: { used_percentage: 37.5, resets_at: soon } } }))
    const [lc, lim] = await api("POST", "ops/claude-code.limits", { for: "companion" })
    const w = lim?.accounts?.find((a: Any) => a.id === "work"), left = (lim?.accounts ?? []).map((a: Any) => a.week_left ?? -1)
    check("vau limits: each account's week left and when it renews, most room first, and what a plugin runs on it",
      lc === 200 && w?.week_left === 62.5 && w.renews && !w.session_full && JSON.stringify(w.uses) === JSON.stringify(["Companion chat"]) &&
      lim.accounts.length === 2 && left.every((x: number, i: number) => !i || left[i - 1] >= x), lim)
    // (a test run never asks Claude Code itself: a QA server's would ask the user's real logins)
    const runs = fs.existsSync(path.join($.AGENTS_BIN, "claude.runs")) ? fs.readFileSync(path.join($.AGENTS_BIN, "claude.runs"), "utf8").trim().split("\n").filter(Boolean) : []
    const probes = runs.filter((r) => r.includes('"--input-format"') && r.includes('"--no-session-persistence"'))
    check("claude limits: a test run never runs claude to ask its usage", probes.length === 0, probes)
    const [, lt] = await api("POST", "ops/claude-code.limits?as=text", {})
    check("vau limits: as text, one line each", /^Work \(work\): 62\.5% of the week left, renews .+\(in 3 days\)$/m.test(String(lt)) &&
      String(lt).split("\n").length === 2, lt)
    write("Dashboards/Limits for.md", "```block-agent-limits\nagent: claude-code\nfor: companion\n```\n")
    const [, lr] = await api("GET", "render?path=Dashboards/Limits for.md")
    check("claude accounts: as text, for a plugin, its accounts first, saying for what",
      String(lr).indexOf("### Work (Companion chat)") >= 0 && String(lr).indexOf("### Work (Companion chat)") < String(lr).indexOf("### Default (Jobs)") , String(lr).slice(0, 400))
    fs.rmSync(path.join(VAULT, "Dashboards/Limits for.md"))
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/companion/data.json"))
    write(".vaultite/plugins/claude-code/data.json", JSON.stringify({ accounts: { work: { label: "Job", private: true }, default: { label: "Mine" } } }))
    ;[, u] = await api("GET", "claude-code?days=7")
    s = u.sessions.find((x: Any) => x.id === sid)
    check("claude accounts: a private one's sessions have no title or folder, its projects are one, named after it",
      s?.private === true && s.title === "" && s.cwd === "" && s.root === "" && s.project === "Job" && s.cost > 0 &&
      u.projects.some((p: Any) => p.name === "Job" && p.root === "") && !u.projects.some((p: Any) => p.name === "acme"), [s, u.projects])
    ;[c] = await api("GET", `claude-code/session/${sid}`)
    check("claude accounts: a private one's conversation isn't read", c === 404, c)
    const [, rendered] = await api("GET", "render?path=Dashboards/Claude.md")
    check("claude accounts: blocks as text say nothing of a private session", !String(rendered).includes("Billing") && !String(rendered).includes("acme"), String(rendered).slice(0, 300))
    const cc = await import("../../../plugins/core/claude-code/plugin.ts")
    const start = cc.plugin.services["agent:claude"]
    let run = await start({ resume: null, context: "", state: null, profile: "work" })
    check("claude accounts: a new session in an account runs with its folder", run.command.startsWith(`CLAUDE_CONFIG_DIR='${WORK}' claude`), run)
    run = await start({ resume: null, context: "", state: null, profile: null, model: "haiku", effort: "medium" })
    check("claude: a session can run another model, at another effort", run.command.includes("--model 'haiku' --effort 'medium'"), run)
    {
      // A model as people say it reaches --model as Claude Code takes it: an alias, or a full id; a provider's id as is.
      const { agentModel } = await import("../../../core/agents.ts")
      const ask = cc.plugin.services["agent-model-id:claude"]
      const cases: [string, string][] = [["Fable 5.2", "claude-fable-5-2"], ["fable-5.2", "claude-fable-5-2"], ["Opus 5.5", "claude-opus-5-5"], ["opus 55", "claude-opus-5-5"],
        ["Claude Sonnet 5.5", "claude-sonnet-5-5"], ["haiku 5.5", "claude-haiku-5-5"], ["Sonnet", "sonnet"], ["opus", "opus"], ["Fable", "fable"], ["sonnet [1m]", "sonnet[1m]"],
        ["claude-opus-5-5", "claude-opus-5-5"], ["claude-haiku-4-5-20251001", "claude-haiku-4-5-20251001"], ["claude-3-5-haiku", "claude-3-5-haiku"], ["opusplan", "opusplan"],
        ["us.anthropic.claude-opus-4-1-20250805-v1:0", "us.anthropic.claude-opus-4-1-20250805-v1:0"]]
      const wrong = cases.filter(([said, id]) => ask(said)?.id !== id).map(([said]) => [said, ask(said)])
      check("claude models: said as people say them, they reach --model by an alias or full id", !wrong.length, wrong)
      check("claude models: each reads by its name (Fable 5.2, not fable-5.2)", ask("fable-5.2").label === "Fable 5.2" && ask("opus").label === "Opus", [ask("fable-5.2"), ask("opus")])
      const refused = ["gpt 5", "gemini-3-pro", "claude", "o3"].filter((said) => !/isn't a model Claude Code runs: sonnet, opus, haiku, fable/.test(ask(said)?.error ?? ""))
      check("claude models: a name that's no Claude model is refused, saying what it takes", !refused.length, refused.map((s) => [s, ask(s)]))
      const thrown = await agentModel(cc.plugin, "claude", "gpt 5").then(() => null, (e: Error) => e.message)
      const codex = await agentModel(cc.plugin, "codex", "gpt-6.1-sol")
      check("agent models: one Claude Code can't run throws; another agent's (Codex's) passes as said", /isn't a model Claude Code runs/.test(thrown ?? "") && codex.id === "gpt-6.1-sol", [thrown, codex])
    }
    run = await start({ resume: sid, context: "", state: null, profile: null })
    check("claude accounts: resuming finds the session's account (a private one too) and its folder", run.command.startsWith(`CLAUDE_CONFIG_DIR='${WORK}' claude --resume`) &&
      run.cwd === "/Users/sam/acme", run)
    run = await start({ resume: "0000aaaa-1111-4222-8333-444455556666", context: "", state: null, profile: null })
    check("claude: a session that isn't on this machine isn't resumed (a note, then a plain shell)", !run.command.includes("claude") && run.command.startsWith("printf") &&
      run.command.includes("no Claude Code session 0000aaaa-1111-4222-8333-444455556666 on this machine"), run)
    write(".vaultite/plugins/claude-code/data.json", JSON.stringify({ accounts: { work: { hidden: true } } }))
    ;[, accts] = await api("GET", "claude-code/accounts")
    check("claude accounts: a hidden one isn't read", accts.length === 1 && accts[0].id === "default", accts)
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/claude-code/data.json"))
    const fresh = path.join(tmp, "claude-lab")
    fs.mkdirSync(fresh); fs.writeFileSync(path.join(fresh, ".claude.json"), "{}")
    ;[, accts] = await api("GET", "claude-code/accounts")
    check("claude accounts: a sibling signed in but with no sessions yet is one", accts.some((a: Any) => a.id === "lab"), accts)
    fs.rmSync(fresh, { recursive: true })
    // (an account's folder holds Claude Code's settings, whose hooks it runs: never one the vault's writers can write)
    fs.mkdirSync(path.join(VAULT, "Notes/.cc"), { recursive: true })
    write(".vaultite/plugins/claude-code/data.json", JSON.stringify({ accounts: { lab: { dir: path.join(VAULT, "Notes/.cc") }, kit: { dir: tmp } } }))
    ;[, accts] = await api("GET", "claude-code/accounts")
    check("claude accounts: a folder the settings name is one, but never in the vault", !accts.some((a: Any) => a.id === "lab") && accts.some((a: Any) => a.id === "kit"), accts)
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/claude-code/data.json"))
    fs.rmSync(path.join(VAULT, "Notes/.cc"), { recursive: true })
    fs.rmSync(WORK, { recursive: true })
  }
}
