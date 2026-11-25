import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { agentOfCommand, terminalAgent } from "../../../core/agentprograms.ts"
import { fresh, nowOf, step } from "../../../plugins/core/terminal/state.ts"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  programs($.check)
  switches($.check)
  replies($.check, (await import("../../../plugins/core/inbox/plugin.ts")).typable)
  if (process.platform !== "win32") await inShells($)
}

function programs(check: VaultTest["check"]) {
  const is: [string, string | null][] = [
    ["agy", "antigravity"], ["/opt/homebrew/bin/agy --continue", "antigravity"], ["claude --resume x", "claude"], ["C:\\x\\claude.exe", "claude"],
    ["node /usr/local/bin/gemini", "gemini"], ["node --max-old-space-size=8192 /x/node_modules/@google/gemini-cli/dist/index.js", "gemini"],
    ['"C:\\Program Files\\nodejs\\node.exe" C:\\x\\node_modules\\@openai\\codex\\bin\\codex.js', "codex"], ["npm exec @openai/codex", "codex"],
    ["npx -y @sourcegraph/amp@latest", "amp"], ["python3 /home/alice/.local/bin/aider", "aider"], ["env FOO=1 claude", "claude"], ["caffeinate -i codex", "codex"],
    ["vim claude", null], ["tail -f /var/log/codex", null], ["python agent.py", null], ["-zsh", null], ["zsh -l -i -c 'claude; exec zsh -l'", null], ["", null],
  ]
  const wrong = is.flatMap(([line, agent]) => { const got = agentOfCommand(line); return got === agent ? [] : [[line, got]] })
  check("terminal agents: a process is an agent's by its program, or the script or package it runs, never by an argument", !wrong.length, wrong)
  check("terminal agents: an agent's OSC 7501 app is it by its id or its program", terminalAgent("claude-code") === "claude" && terminalAgent("agy") === "antigravity" &&
    terminalAgent("gemini-cli") === "gemini" && terminalAgent("claude-app") === null && terminalAgent("zsh") === null)
}

function switches(check: VaultTest["check"]) {
  const run = (evs: Parameters<typeof step>[1][]) => evs.reduce((t, ev, i) => step(t, ev, 1000 + i * 1000), fresh("claude"))
  const front = (agent: string | null, seen: number) => ({ type: "front" as const, program: agent !== null, agent, seen })
  const word = (state: "working" | "idle", app?: string) => ({ type: "osc" as const, said: { seen: true, status: { state, app } } })
  const hooked = run([{ type: "hooks", text: "waiting:permission", at: 1 }, front("claude", 1500), front("antigravity", 2500)])
  check("terminal agents: another agent in front has none of what the one before said", nowOf(hooked)?.agent === "antigravity" && nowOf(hooked)?.state === "idle" && !nowOf(hooked)?.kind, nowOf(hooked))
  const late = step(hooked, { type: "hooks", text: "working", at: 9 }, 9000)
  check("terminal agents: hooks of the agent it was started with say nothing once another runs in it", late === hooked, nowOf(late))
  const spoke = run([word("idle", "claude-code"), front("claude", 1500), front(null, 3500), word("working", "antigravity")])
  check("terminal agents: a program that says who it is, is, before anything looks", nowOf(spoke)?.agent === "antigravity" && nowOf(spoke)?.state === "working", nowOf(spoke))
  const kept = run([word("working", "claude-code"), front("claude", 1500), word("working", "antigravity"), front("antigravity", 2500)])
  const stale = run([word("working", "claude-code"), front("claude", 1500), front("antigravity", 2500)])
  check("terminal agents: an agent swapped in between looks keeps its own word, not the last one's", nowOf(kept)?.state === "working" && nowOf(stale)?.state === "idle" &&
    nowOf(stale)?.agent === "antigravity", [nowOf(kept), nowOf(stale)])
  const back = run([front("claude", 500), front("antigravity", 1500), front("claude", 2500), { type: "hooks", text: "working", at: 5 }])
  check("terminal agents: its own agent run again is heard again", nowOf(back)?.agent === "claude" && nowOf(back)?.state === "working", nowOf(back))
}

function replies(check: VaultTest["check"], typable: typeof import("../../../plugins/core/inbox/plugin.ts").typable) {
  const list = [{ id: "claude-a1b2c3d4", agent: "antigravity", busy: true }]
  check("terminal agents: a reply to an agent's session is never typed to another agent run in its terminal since", !typable(list, "claude")("claude-a1b2c3d4") &&
    !typable(list, "claude_work")("claude-a1b2c3d4") && typable(list, "antigravity")("claude-a1b2c3d4"))
}

async function inShells($: VaultTest) {
  const { check } = $
  const { waitFor } = await import("../lib.ts")
  const term = await import("../../../plugins/core/terminal/plugin.ts")
  const svc = term.plugin.services
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vau-agents-"))
  const program = (name: string, says: string) => { fs.writeFileSync(path.join(dir, name), `#!/bin/sh\nprintf '${says}'\nread x\n`, { mode: 0o755 }); return path.join(dir, name) }
  const standin = program("standin", "\\033]0;Fix the parser\\007\\033]7501;state=idle:app=standin\\033\\\\"), agy = program("agy", "\\033]7501;state=working\\033\\\\")
  svc["agent:standin"] = async () => ({ command: standin })
  await $.api("PATCH", "config/plugin/terminal", { shell: "/bin/sh" })
  const id = "standin-front1", type = (to: string, text: string) => $.api("POST", `terminals/${to}/send`, { text, enter: true, shell: true })
  const row = async (to: string): Promise<Any> => { const [, l] = await $.api("GET", "terminals/sessions"); return l.sessions?.find((s: Any) => s.id === to) }
  const until = (to: string, ok: (r: Any) => boolean) => waitFor(async () => { const r = await row(to); return r && ok(r) ? r : null }, 15_000, 200)
  try {
    await $.api("POST", `terminals/${id}`, {})
    const own = await until(id, (r) => r.agent === "standin" && r.title === "Fix the parser")
    await type(id, "")
    const left = await until(id, (r) => !r.busy)
    await type(id, agy)
    const other = await until(id, (r) => r.agent === "antigravity" && r.state === "working")
    check("terminal agents: another agent run in an agent's shell is listed as itself, with its own state and title; at the prompt, none", !!own && left?.agent === null &&
      !!other && other.title === undefined && other.process === "agy", [own, left, other, await row(id)])
    const now = svc["terminal:state"](id)
    check("terminal agents: it's who is told of (its state, what runs vau there)", now?.agent === "antigravity" && svc["terminal:agent"](id) === "antigravity", now)
    await type(id, "")
    await until(id, (r) => !r.busy)
    await type(id, "sleep 30")
    const plain = await until(id, (r) => r.process === "sleep")
    check("terminal agents: a plain program run after it is no agent", plain?.agent === null, plain)
    await $.api("POST", "terminals/front2", {})
    await type("front2", agy)
    check("terminal agents: an agent run in a plain shell is listed as itself", !!await until("front2", (r) => r.agent === "antigravity"), await row("front2"))
  } finally {
    for (const t of [id, "front2"]) await $.api("DELETE", `terminals/${t}`)
    delete svc["agent:standin"]
    await $.api("PATCH", "config/plugin/terminal", { shell: null })
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
