import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { CODEX_DIR, api, app, check, fixtureNow } = $
  // A Codex in a terminal: its session is the newest in its folder since it started, read as its turn ends (reads are 5 s
  // apart). It goes first: the usage sessions below can be dated ahead of the clock, and Windows (no folders) takes them.
  {
    const { processTable, service } = await import("../../../core/plugins.ts")
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-codex-")), work = path.join(dir, "beacon")
    fs.mkdirSync(work)
    // A process named codex that waits: named by argv0 (macOS kills a copy of sleep, and uutils' sleep, Ubuntu's, won't
    // run by another name); on Windows a copy of ping (a process's name there is its file's).
    const win = process.platform === "win32"
    if (win) fs.copyFileSync(path.join(process.env.SystemRoot || "C:\\Windows", "System32", "PING.EXE"), path.join(dir, "codex.exe"))
    const proc = win ? spawn(path.join(dir, "codex.exe"), ["-n", "300", "127.0.0.1"], { cwd: work, stdio: "ignore" })
      : spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { argv0: path.join(dir, "codex"), cwd: work, stdio: "ignore" })
    const term = app.plugins.find((p) => p.id === "terminal")!, was = term.services["terminal:of"]
    term.services["terminal:of"] = async (pid: number) => (pid === proc.pid ? "codex-b3ac0n01" : null)
    try {
      // (listed once the process table has it, then past Codex's 2 s memo of its processes; Windows' table is slow)
      const t0 = Date.now()
      let seen = false
      for (let i = 0; i < 30 && !(seen = (await processTable()).has(proc.pid!)); i++) await new Promise((r) => setTimeout(r, 1000))
      const waited = { seen, ms: Date.now() - t0, procs: (await processTable()).size }
      await new Promise((r) => setTimeout(r, 2100))
      const turn = service(app.plugins, "agent-turn:codex")!, meters = service(app.plugins, "agent-meters:codex")!
      const before = await turn("codex-b3ac0n01")
      const id = "3f3f3f3f-6666-4777-8888-999900001111", t = (ms: number) => new Date(Date.now() + ms).toISOString()
      const item = (type: string, text: string, ms: number) => ({ timestamp: t(ms), type: "event_msg", payload: { type: "item_completed", item: { type, content: [{ type: "text", text }] } } })
      const day = path.join(CODEX_DIR, "sessions", "today")
      fs.mkdirSync(day, { recursive: true })
      fs.writeFileSync(path.join(day, `rollout-2026-09-29T10-00-00-${id}.jsonl`), [
        { timestamp: t(0), ordinal: 0, type: "session_meta", payload: { id, cwd: fs.realpathSync(work), cli_version: "0.163.0", source: "vscode" } },
        item("UserMessage", "What is 2+2?", 10), item("AgentMessage", "2 + 2 = 4.", 20),
        { timestamp: t(30), type: "event_msg", payload: { type: "task_complete", last_agent_message: "2 + 2 = 4." } },
      ].map((d) => JSON.stringify(d)).join("\n") + "\n")
      const after = await turn("codex-b3ac0n01"), listed = await meters()
      check("codex: a terminal's session read as its first turn ends, its answer and title (agent-turn:codex), and listed by terminal",
        before === null && after?.session === id && after.text === "2 + 2 = 4." && after.prompt === "What is 2+2?" && after.final && after.title === "What is 2+2?" &&
        JSON.stringify(listed) === JSON.stringify([{ terminal: "codex-b3ac0n01", session: id }]), [before, after, listed, waited])
    } finally {
      term.services["terminal:of"] = was
      proc.kill()
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10 })
    }
  }

  // Codex: a session's conversation in both rollout shapes (plugins/core/codex/rollout.ts), and its tokens counted once.
  {
    const [a, b] = ["0b1c2d3e-2222-4333-8444-555566667777", "0c1d2e3f-3333-4444-8555-666677778888"]
    let [c, t] = await api("GET", `codex/session/${a}`)
    check("codex session: found by id, with title, folder, model and branch", c === 200 && t.title === "Fix the date parsing" &&
      t.cwd === "/Users/sam/lighthouse" && t.model === "GPT-6.1 Sol" && t.project === "lighthouse" && t.branch === "main", [c, { ...t, entries: undefined }])
    const kinds = t.entries?.map((e: Any) => e.kind + (e.name ? `:${e.name}` : "")).join(",")
    check("codex session: what was said, each command and edit, not the model's raw tool calls or instructions",
      kinds === "user,assistant,tool:Shell,tool:Edit,assistant", kinds)
    const [sh, ed] = [t.entries[2], t.entries[3]]
    check("codex session: a command is one line with its output", sh.summary === "npm test" && sh.result === "1 failing: dates" && sh.error === true &&
      ed.summary === "date.ts" && ed.input.includes("+parse(s, 'UTC')") && !ed.error, [sh, ed])
    ;[c, t] = await api("GET", `codex/session/${b}`)
    check("codex session, older shape: the request after an IDE's context, a named session, a shell call with its output",
      c === 200 && t.title === "Changelog" && t.entries[0].text.includes("Add a changelog") && t.entries[1].name === "Shell" &&
      t.entries[1].summary === "ls" && t.entries[1].result === "README.md" && t.entries[2].text === "Done." && t.model === "GPT-5.1 Codex",
      [t.title, t.entries])
    ;[c] = await api("GET", "codex/session/..%2F..%2Fetc")
    check("codex session: not a path", c === 404, c)
    {
      const agent = (await import("../../../core/plugins.ts")).service(app.plugins, "agent:codex")!
      const [back, gone] = await Promise.all([agent({ resume: a, context: "", state: null }), agent({ resume: "0000aaaa-1111-4222-8333-444455556666", context: "", state: null })])
      check("codex agent: a session on this machine is resumed; one that isn't, a note", back.command === `codex resume '${a}'` && gone.command.startsWith("printf") && gone.command.includes("no Codex session"), [back, gone])
      const how = await agent({ resume: null, context: "", state: null, model: "gpt-6-luna", effort: "high", prompt: "hi" })
      const allowed = await agent({ resume: null, context: "", state: null, allow: ["vau companion"] })
      check("codex agent: its model by -m, an effort by -c (it has no flag for one), commands to run unasked reach the app", how.command === `codex -m 'gpt-6-luna' -c 'model_reasoning_effort="high"' -- 'hi'` &&
        allowed.command === "codex -c 'sandbox_workspace_write.network_access=true'", [how.command, allowed.command])
      fs.writeFileSync(path.join(CODEX_DIR, "models_cache.json"), JSON.stringify({ models: [
        { slug: "gpt-6-luna", visibility: "list", priority: 5, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }] },
        { slug: "gpt-6.1-sol", visibility: "list", priority: 1, supported_reasoning_levels: [{ effort: "low" }, { effort: "medium" }, { effort: "high" }, { effort: "ultra" }] },
        { slug: "codex-auto-review", visibility: "hide", priority: 9, supported_reasoning_levels: [{ effort: "low" }] }] }))
      const models = (await import("../../../core/plugins.ts")).service(app.plugins, "agent-models:codex")!()
      fs.rmSync(path.join(CODEX_DIR, "models_cache.json"))
      check("codex agent: the models its picker lists, in its order, and the efforts all take", JSON.stringify(models) ===
        JSON.stringify({ models: [{ id: "gpt-6.1-sol", label: "GPT-6.1 Sol" }, { id: "gpt-6-luna", label: "GPT-6 Luna" }], efforts: ["low", "medium", "high"] }), models)
    }
    // Today's tokens: a session written now, and a fork of it replaying the same counts (counted once); the same total
    // again (a rate limit update) doesn't count.
    const now = fixtureNow()
    const at = (s: number) => new Date(now - 120000 + s * 1000).toISOString()
    const day = path.join(CODEX_DIR, "sessions", "today")
    fs.mkdirSync(day, { recursive: true })
    const src = fs.readFileSync(path.join(CODEX_DIR, "sessions", "2026", "09", "28", `rollout-2026-09-28T09-00-00-${a}.jsonl`), "utf8")
    const lines = src.trim().split("\n").map((l: string, i: number) => { const d = JSON.parse(l); d.timestamp = at(i); if (d.payload?.turn_id) d.payload.turn_id = "today-t1"; return d })
    const today = "1d1d1d1d-4444-4555-8666-777788889999"
    lines[0].payload.id = today
    fs.writeFileSync(path.join(day, `rollout-2026-09-29T09-00-00-${today}.jsonl`), lines.map((d: Any) => JSON.stringify(d)).join("\n") + "\n")
    const fork = "2e2e2e2e-5555-4666-8777-888899990000"
    fs.writeFileSync(path.join(day, `rollout-2026-09-29T09-00-01-${fork}.jsonl`), [JSON.stringify({ ...lines[0], payload: { ...lines[0].payload, id: fork } }),
      ...lines.slice(1).map((d: Any) => JSON.stringify(d))].join("\n") + "\n")
    await new Promise((r) => setTimeout(r, 5100)) // the scan reads new files at most every 5 s
    const [, u] = await api("GET", "codex?days=1")
    const d0 = u.days?.at(-1)
    check("codex usage: tokens counted once across a fork, the repeated total skipped, uncached input and cached priced apart",
      d0?.tokens === 2800 && Math.abs(d0.cost - 0.0042) < 1e-6 && u.models?.[0]?.name === "GPT-6.1 Sol" && u.total.cache_hit === 0.8, [d0, u.models, u.total])
    check("codex usage: a turn's time, the project, the plan and limits the sessions saw", d0?.active_min === 1 && u.projects?.[0]?.name === "lighthouse" &&
      u.plan?.name === "Plus" && u.limits?.windows?.map((w: Any) => w.label).join() === "Current session,This week", [d0, u.projects, u.plan, u.limits])
    const [, cr] = await api("GET", "render?path=Dashboards/Codex.md")
    check("the Codex page as text", typeof cr === "string" && cr.includes("## Codex by project") && cr.includes("lighthouse") &&
      cr.includes("## Codex plan limits"), String(cr).slice(0, 400))
  }

  {
    const [c, ins] = await api("GET", "terminals/instructions")
    check("terminal: what agents are told, word for word: inside Vaultite, then the plugins' lines", c === 200 && ins.text.startsWith("You're running in a terminal inside Vaultite") &&
      ins.text.includes("- `.vaultite/AGENTS.md` is the vault's rules"), [c, ins])
  }
}
