import { findBin } from "../../../core/agents.ts"
import type { Plugin } from "../../../core/plugins.ts"
import { HARNESS_IDS, HARNESSES, shellLine } from "./harness.ts"

export function harnessOps(plugin: Plugin) {
  plugin.op({
    id: "claude-code.harnesses", cli: "chat harnesses", owner: "Claude Code's chat", kind: "read", lock: false,
    summary: "The coding agents a chat thread can run on (Claude Code, Codex, Antigravity, OpenCode): which are installed here, how each serves a structured session, and its terminal handoff.",
    run: () => ({ harnesses: HARNESS_IDS.map((id) => {
      const h = HARNESSES[id]
      return { id, name: h.name, installed: !!findBin(h.bin), serve: h.serve.kind, command: shellLine(h.serve.argv), chat: h.chat, handoff: shellLine(h.resume("<session>")) }
    }) }),
    text: (r) => r.harnesses.map((h) => `- ${h.name}: ${h.installed ? "installed" : "not installed"} · ${h.serve}${h.chat ? " · in the Thread view" : ""} · ${h.handoff}`).join("\n"),
  })
}
