import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { CODEX_DIR, api, app, check, fixtureNow } = $
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
