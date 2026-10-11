import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, cursorApi, cursorSeen, write } = $
  // Grok Bot (plugins/core/grok-bot): its week and requests from the fake Cursor API, read once with Cursor's plugin.
  {
    const conv = "9b9b9b9b-3333-4444-8555-666677778888"
    const before = cursorSeen.length
    let [c, u] = await api("GET", "grok-bot?days=30")
    check("grok bot: the account isn't read until the user allows it", c === 200 && !u.limits && !u.sessions.length && !u.total.tokens &&
      cursorSeen.length === before, [c, u?.limits, cursorSeen.length - before])
    write(".vaultite/plugins/grok-bot/data.json", JSON.stringify({ account: true }))
    ;[c, u] = await api("GET", "grok-bot?days=30")
    check("grok bot: one read of the account serves Cursor's plugin and this one (after Cursor's test: nothing asked again)",
      c === 200 && cursorSeen.length === before, cursorSeen.slice(before).map((s) => s.path))
    check("grok bot: its week from Cursor's dashboard, no plan of its own", u.plan === null &&
      u.limits?.windows.map((w: Any) => `${w.id}:${w.used}:${w.minutes}`).join() === "week:12:10080" && !!u.limits.windows[0].resets_at, [u?.plan, u?.limits])
    check("grok bot: only its own requests, its conversation a session", u.total.cost === 0.05 && u.total.tokens === 150 &&
      u.sessions.length === 1 && u.sessions[0].id === conv && u.sessions[0].title === "Conversation 9b9b9b9b" && u.sessions[0].model === "Grok Bot" &&
      u.sessions[0].active_min === 1 && !u.live.length, [u.total, u.sessions])
    check("grok bot: by model", u.models.map((m: Any) => m.name).join() === "Grok Bot,Grok Bot automation", u.models)
    let t: Any
    ;[c, t] = await api("GET", `grok-bot/session/${conv}`)
    check("grok bot session: when and with which model, no conversation (it stays in Grok Bot)", c === 200 && t.title === "Conversation 9b9b9b9b" &&
      t.model === "Grok Bot" && !!t.first && t.entries.length === 0, [c, t])
    ;[c] = await api("GET", "grok-bot/session/c0ffee00-1111-4222-8333-444455556666")
    check("grok bot session: Cursor's own chats aren't Grok Bot's", c === 404, c)
    const [, page] = await api("GET", "render?path=Dashboards/Grok Bot.md")
    check("grok bot: its page as text", typeof page === "string" && page.includes("This week: 12% used") && page.includes("Conversation 9b9b9b9b") &&
      page.includes("## Grok Bot by model") && !page.includes("### Now") && !page.includes("Claude"), String(page).slice(0, 800))
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/grok-bot/data.json"))
    cursorApi.close()
  }
}
