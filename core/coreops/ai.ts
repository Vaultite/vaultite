// Use AI (`vau ai`): one switch over every plugin that's for AI (a manifest's `ai`), and the coding agents on this
// machine that Vaultite can run in its terminals (Settings > AI, the first run's AI page).
import fs from "node:fs"
import path from "node:path"
import type { App } from "../app.ts"
import { findBin, HOME } from "../agents.ts"
import type { Op } from "../ops.ts"
import { agentName, agentSite } from "../terminalids.ts"
import type { Any } from "./common.ts"
import { onOff, pluginList } from "./plugins.ts"

/** The coding agents Vaultite runs (each its plugin: the app's, or one from Vaultite's directory) and their command;
 *  where to get each is KNOWN_AGENTS'. */
export const CODING_AGENTS: { id: string; bin: string }[] = [
  { id: "claude-code", bin: "claude" },
  { id: "codex", bin: "codex" },
  { id: "cursor", bin: "cursor-agent" },
  { id: "opencode", bin: "opencode" },
  { id: "openclaw", bin: "openclaw" },
  { id: "hermes", bin: "hermes" },
]

/** Where its command is: on the server's PATH or where installers put it (findBin), their own folders too. */
function whereIs(a: { id: string; bin: string }) {
  const own = [".bun/bin", ".opencode/bin", ".claude/local"].map((d) => path.join(HOME, d, a.bin))
  const isFile = (p: string) => { try { return fs.statSync(p).isFile() } catch { return false } }
  return findBin(a.bin) ?? own.find(isFile) ?? (a.id === "hermes" && fs.existsSync(path.join(HOME, ".hermes", "hermes-agent")) ? path.join(HOME, ".hermes") : null)
}

export type CodingAgent = { id: string; name: string; path: string | null; site: string
  /** Its plugin here (the app's, or the vault's once installed); false: it's in Vaultite's directory, not installed. */
  plugin: boolean
  /** Its plugin is switched on (whatever Use AI says). */
  on: boolean }

export function aiOps(app: App): Op[] {
  return [{
    id: "ai.set",
    cli: "ai",
    summary: "Use AI or not: on (the default), off (no coding agents, companion or AI apps in the app), or as it is now.",
    help: `The app's Use AI switch (Settings > AI), plugins.json \`ai\`. Off, every plugin that's for AI (its manifest's
\`ai\`: Claude Code, Codex, the companion, cloud sessions, AI usage) is off whatever its own switch says, and the app shows
no agent buttons or AI items. Each plugin's own switch stays as it was: back on, they are too. Ops, MCP and vau don't
change, so an agent the user runs can still use the vault. Without a value, it says which it is.

  vau ai
  vau ai off
  vau ai on`,
    kind: "write",
    params: { on: { type: "string", enum: ["on", "off"], description: "on or off; left out: as it is now" } },
    args: ["on"],
    run: ({ on }) => {
      if (on !== undefined) app.vault.patchConfig("plugins", { ai: on === "off" ? false : null })
      const ps = pluginList(app), { own, aiOff } = onOff(ps, app.vault.config("plugins"))
      return { ai: !aiOff, kept: ps.filter((p) => p.ai && own(p)).map((p) => p.name) }
    },
    text: (r: Any) => (r.ai ? "AI is on." : `AI is off${r.kept.length ? `: ${r.kept.join(", ")} stay off until it's on again` : ""}.`),
    did: (p) => ({ action: "settings", text: p.on ? `Turned AI ${p.on}` : "Read whether AI is on" }),
  }, {
    id: "ai.agents",
    cli: "ai agents",
    summary: "The coding agents Vaultite can run in its terminals: which are on this machine (where), and whether their plugin is on.",
    help: `Claude Code, Codex, Cursor, OpenCode, OpenClaw and Hermes: each one's command on this machine (null: not
installed), its site, and its plugin (the app's, or one to install from Vaultite's plugins) and whether it's switched on.

  vau ai agents`,
    kind: "read",
    run: (): CodingAgent[] => {
      const ps = pluginList(app), { own } = onOff(ps, app.vault.config("plugins"))
      return CODING_AGENTS.map((a) => {
        const p = ps.find((x) => x.id === a.id)
        return { id: a.id, name: agentName(a.id) ?? a.id, path: whereIs(a), site: agentSite(a.id) ?? "", plugin: !!p, on: !!p && own(p) }
      })
    },
    text: (rows: CodingAgent[]) => rows.map((a) => `${a.path ? "found" : "  -  "}  ${a.name.padEnd(12)} ${a.path ?? a.site}` +
      (a.path ? (a.plugin ? (a.on ? "  (on)" : `  (off: vau plugin on ${a.id})`) : `  (its plugin: vau plugin install Vaultite/plugins/${a.id})`) : "")).join("\n"),
  }]
}
