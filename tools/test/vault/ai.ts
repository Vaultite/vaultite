import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, read, vault, write } = $
  // Use AI (core/coreops/ai.ts): off, the plugins for AI (a manifest's `ai`) are off whatever their own switches say,
  // the app's and the vault's; ops and MCP stay; back on, each is as its switch was.
  const conf = () => JSON.parse(read(".vaultite/plugins.json")) as Any
  const lists = () => { const c = conf(); return JSON.stringify([c.disabled ?? [], c.enabled ?? []]) }
  const ai = async (on?: "on" | "off") => { const { op, params, result } = await app.runOp("ai.set", on ? { on } : {}); await vault.synced(); return { r: result as Any, text: op.text!(result, params) } }
  write(".vaultite/plugins/qa-ai-tool/manifest.json", JSON.stringify({ id: "qa-ai-tool", name: "QA AI tool", description: "A made-up plugin for AI.", ai: true }))
  write(".vaultite/plugins/qa-plain-tool/manifest.json", JSON.stringify({ id: "qa-plain-tool", name: "QA plain tool", description: "A made-up plugin." }))
  await vault.synced(); await app.syncPlugins()
  await app.runOp("plugin.enable", { id: "qa-ai-tool" }); await app.runOp("plugin.enable", { id: "qa-plain-tool" })
  await vault.synced()
  const was = lists()
  check("ai: on by default", (await ai()).r.ai === true && !("ai" in conf()))

  let r = await ai("off")
  check("ai off: plugins.json says ai false, its lists as they were", conf().ai === false && lists() === was, conf())
  check("ai off: it says which stay off", r.text.startsWith("AI is off") && r.text.includes("Claude Code") && r.text.includes("Companion"), r.text)
  const off = vault.switchedOff()
  check("ai off: the app's plugins for AI are off (Claude Code, the companion, cloud sessions)", ["claude-code", "companion", "cloud-sessions"].every((id) => off.has(id)), [...off])
  check("ai off: what serves agents through ops stays on (MCP, inbox, terminal, review, provenance, agent files)",
    ["mcp", "inbox", "terminal", "review", "provenance", "agent-files"].every((id) => !off.has(id)), [...off])
  check("ai off: a vault plugin for AI is off too, another isn't", !app.vaultPlugins.enabled().has("qa-ai-tool") && app.vaultPlugins.enabled().has("qa-plain-tool"))
  const [, list] = await api("POST", "ops/plugin.list", {})
  const cc = (list as Any[]).find((p) => p.id === "claude-code")
  check("ai off: plugin.list has it off, still switched on, saying why", cc && !cc.on && cc.switchedOn && cc.aiOff, cc)
  const en = await app.runOp("plugin.enable", { id: "claude-code" })
  check("ai off: turning one on says it stays off while AI is", en.op.text!(en.result, en.params).includes("stays off while AI is off"), en.result)
  check("ai off: ops still answer, and MCP's tools are there", !!app.opNamed("note.create") && !!app.opNamed("search"))
  const [code, tools] = await api("POST", "mcp", { jsonrpc: "2.0", id: 1, method: "tools/list" })
  check("ai off: MCP lists its tools", code === 200 && (JSON.stringify(tools).includes("write_file")), [code, JSON.stringify(tools).slice(0, 300)])

  // A layout leaving the plugins for AI as they come (Standard's agents) leaves AI off: AI is the user's, not a layout's.
  const [, std] = await api("GET", "bundles/standard")
  check("ai off: Standard doesn't turn AI on", !(std as Any).plan.changes.some((c: Any) => c.id === "ai"), (std as Any).plan.changes)
  // A bundle that turns on a plugin for AI turns AI on too, saying so, and restoring puts it back off.
  const dir = path.join(VAULT, ".vaultite/bundles/qa-agents")
  fs.mkdirSync(dir, { recursive: true })
  const offOne = (list as Any[]).find((p) => p.ai && !p.switchedOn && p.tier === "core")?.id
  fs.writeFileSync(path.join(dir, "bundle.json"), JSON.stringify({ name: "QA agents", description: "An agent beside your notes." }))
  fs.writeFileSync(path.join(dir, "plugins.json"), JSON.stringify({ disabled: [], enabled: [offOne] }))
  let [, b] = await api("GET", "bundles/qa-agents")
  const change = (b as Any).plan.changes.find((c: Any) => c.id === "ai")
  check("bundle: one turning on a plugin for AI while AI is off says it turns AI on", !!change && /Turn on AI/.test(change.label), (b as Any).plan.changes)
  // (as one naming only plugins for AI switched on already does: AI is what keeps them off)
  fs.writeFileSync(path.join(dir, "plugins.json"), JSON.stringify({ disabled: [], enabled: ["claude-code"] }))
  ;[, b] = await api("GET", "bundles/qa-agents")
  check("...as does one naming only a plugin for AI that's switched on already", (b as Any).plan.changes.some((c: Any) => c.id === "ai"), (b as Any).plan.changes.slice(0, 3))
  fs.writeFileSync(path.join(dir, "plugins.json"), JSON.stringify({ disabled: [], enabled: [offOne] }))
  ;[, b] = await api("POST", "bundles/qa-agents/apply", {})
  await vault.synced()
  check(`bundle: applied, AI is on, and ${offOne} with it`, !("ai" in conf()) && !vault.switchedOff().has(offOne), [offOne, conf().ai])
  await api("POST", "bundles/restore", {})
  await vault.synced()
  check("bundle: restoring puts AI back off", conf().ai === false, conf())
  fs.rmSync(dir, { recursive: true, force: true })

  r = await ai("on")
  check("ai on: plugins.json without ai, its lists as they were", !("ai" in conf()) && lists() === was, conf())
  const back = vault.switchedOff()
  check("ai on: the plugins for AI are as their own switches say", !back.has("claude-code") && !back.has("companion") && app.vaultPlugins.enabled().has("qa-ai-tool"), [...back])
  const [, agents] = await api("POST", "ops/ai.agents", {})
  check("ai.agents: the coding agents, each with its site and whether its plugin is here", Array.isArray(agents) && (agents as Any[]).some((a) => a.id === "claude-code" && a.plugin && a.site.startsWith("https://"))
    && (agents as Any[]).some((a) => a.id === "openclaw" && !a.plugin), agents)

  await app.runOp("plugin.disable", { id: "qa-ai-tool" }); await app.runOp("plugin.disable", { id: "qa-plain-tool" })
  for (const id of ["qa-ai-tool", "qa-plain-tool"]) fs.rmSync(path.join(VAULT, ".vaultite/plugins", id), { recursive: true, force: true })
  await vault.synced()
}
