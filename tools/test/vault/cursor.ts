import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, cursorApi, cursorSeen, write } = $
  // Cursor (plugins/core/cursor): chats from the fixture's IDE and CLI files, usage from the fake Cursor API.
  {
    const ide = "c0ffee00-1111-4222-8333-444455556666", cli = "5a5a5a5a-2222-4333-8444-555566667777"
    let [c, u] = await api("GET", "cursor?days=30")
    check("cursor: the account isn't read until the user allows it, chats are", c === 200 && !u.limits && cursorSeen.length === 0 && u.sessions.length === 2, [c, u?.limits, cursorSeen])
    write(".vaultite/plugins/cursor/data.json", JSON.stringify({ account: true }))
    ;[c, u] = await api("GET", "cursor?days=30")
    check("cursor: the plan and its allowances from Cursor's dashboard", c === 200 && u.plan?.name === "Pro" && u.plan.monthly === 20 &&
      u.limits?.windows.map((w: Any) => `${w.id}:${w.used}`).join() === "month:46.5,grok-bot:12" && !!u.limits.windows[0].resets_at, [c, u?.plan, u?.limits])
    check("cursor: usage totals from the metered requests (a request with no tokens is worth what it charged)",
      u.total.cost === 0.55 && u.total.tokens === 17250 && u.total.unpriced === 0 && u.total.cache_hit === 0.723, u.total)
    const ses = Object.fromEntries(u.sessions.map((s: Any) => [s.id, s]))
    check("cursor: the IDE's and the CLI's chats are sessions (no drafts, no empty chats), with their project from the folder",
      u.sessions.length === 2 && ses[ide]?.title === "Search box debounce" && ses[ide].project === "lighthouse" && ses[ide].cwd === "/Users/alice/lighthouse" &&
      ses[cli]?.title === "Flaky upload test" && ses[cli].project === "lighthouse", u.sessions)
    check("cursor: a chat gets its conversation's tokens, value, model and time working", ses[ide].cost === 0.2 && ses[ide].tokens === 13800 &&
      ses[ide].model === "Claude 4.5 Sonnet" && ses[ide].active_min === 2 && ses[cli].cost === 0.3 && ses[cli].model === "GPT-5", [ses[ide], ses[cli]])
    check("cursor: conversations not on this machine are a project of their own, not sessions",
      u.projects.map((p: Any) => `${p.name}:${p.sessions}`).join() === "lighthouse:2,Grok Bot:1" && !u.sessions.some((s: Any) => s.id.startsWith("9b9b")), u.projects)
    check("cursor: by model", u.models.map((m: Any) => m.name).join() === "GPT-5,Claude 4.5 Sonnet,Grok Bot,Grok Bot automation", u.models)
    check("cursor: days end today and count its conversations", u.days.length === 30 && u.days.at(-1).sessions >= 1 && u.days.reduce((a: number, d: Any) => a + d.tokens, 0) === 17250, u.days.at(-1))
    const posts = cursorSeen.filter((s) => s.path !== "/api/usage-summary")
    check("cursor: asks with the IDE's session as the dashboard's cookie, with an Origin on POSTs", cursorSeen.length >= 3 &&
      cursorSeen.every((s) => /^WorkosCursorSessionToken=user_ana%3A%3AeyJ[\w-]+\.[\w-]+\.[\w-]+$/.test(s.cookie)) &&
      posts.every((s) => s.origin === new URL(process.env.CURSOR_API_URL!).origin), cursorSeen.map((s) => s.path))
    check("cursor: the token never reaches an answer", !JSON.stringify(u).includes("eyJ"))
    const asked = cursorSeen.length
    await api("GET", "cursor?days=7")
    check("cursor: the account is kept in memory, not asked again on every request", cursorSeen.length === asked, cursorSeen.length)

    let t: Any
    ;[c, t] = await api("GET", `cursor/session/${ide}`)
    check("cursor session: an IDE chat's conversation, a tool call as one line with its result", c === 200 && t.title === "Search box debounce" &&
      t.cwd === "/Users/alice/lighthouse" && t.project === "lighthouse" && t.model === "Claude 4.5 Sonnet" &&
      t.entries.map((e: Any) => e.kind).join() === "user,tool,assistant" && t.entries[1].name === "read_file" && t.entries[1].summary === "src/search.ts" &&
      t.entries[1].result.includes("export function search") && t.entries[0].at === "2026-09-28T09:00:00.000Z", [c, t])
    ;[c, t] = await api("GET", `cursor/session/${cli}`)
    check("cursor session: a CLI chat's conversation in the order it was written, the prompt without Cursor's context",
      c === 200 && t.title === "Flaky upload test" && t.model === "GPT-5" && t.entries.map((e: Any) => e.kind).join() === "user,assistant,tool,assistant" &&
      t.entries[0].text === "Why does the upload test fail?" && t.entries[2].name === "Shell" && t.entries[2].summary === "npm test -- upload" &&
      t.entries[2].error === true && t.entries[2].result === "1 failing: upload retries", [c, t])
    ;[, t] = await api("GET", `cursor/session/${cli}?limit=2&before=3`)
    check("cursor session: pages", t.start === 1 && t.entries.length === 2 && t.total === 4 && t.entries[0].kind === "assistant", t)
    ;[c] = await api("GET", "cursor/session/9b9b9b9b-3333-4444-8555-666677778888")
    check("cursor session: a conversation that isn't on this machine is a 404", c === 404, c)
    ;[c] = await api("GET", "cursor/session/..%2F..%2Fetc")
    check("cursor session: not a path", c === 404, c)

    const agent = (await import("../../../core/plugins.ts")).service(app.plugins, "agent:cursor")!
    const [fresh, back, fromIde] = await Promise.all([agent({ resume: null, context: "x", state: null }), agent({ resume: cli, context: "x", state: null }),
      agent({ resume: ide, context: "x", state: null })])
    const gone = await agent({ resume: "0000aaaa-1111-4222-8333-444455556666", context: "x", state: null })
    check("cursor agent: a chat that isn't on this machine isn't resumed", gone.command.startsWith("printf") && !/(^|\s)agent(\s|$)/.test(gone.command.replace(/'.*'/, "")), gone)
    check("cursor agent: `agent`, resumed in its chat's folder; an IDE chat gets a new CLI chat in its folder",
      fresh.command === "agent" && !fresh.cwd && back.command === `agent --resume '${cli}'` && back.cwd === "/Users/alice/lighthouse" &&
      fromIde.command === "agent" && fromIde.cwd === "/Users/alice/lighthouse", [fresh, back, fromIde])
    const [, page] = await api("GET", "render?path=Dashboards/Cursor.md")
    check("cursor: its page as text", typeof page === "string" && page.includes("Included usage: 46.5% used") && page.includes("Search box debounce") &&
      page.includes("## Cursor by project") && page.includes("- Grok Bot: $0.05"), String(page).slice(0, 600))
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/cursor/data.json"))
    cursorApi.close()
  }
}
