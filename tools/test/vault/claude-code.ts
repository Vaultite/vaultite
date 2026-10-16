import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { CLAUDE_DIR, VAULT, api, check, fixtureNow, tmp, write, TOOLS } = $
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
    const [, cr] = await api("GET", "render?path=Dashboards/Claude.md")
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
    fs.rmSync(WORK, { recursive: true })
  }
}
