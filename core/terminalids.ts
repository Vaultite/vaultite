// A terminal's id says what it runs: "<agent>-<random>", "<agent>_<profile>-…" (account), "resume-<agent>-<session>",
// then "@<machine>" when elsewhere; else a plain shell. Read and made only here; Node-free: the web imports it.

/** An agent as a terminal names it: its name ("claude"), or its name and one of its accounts ("claude_personal"). */
export const TERMINAL_AGENT = /^[a-z][a-z0-9]*(?:_[a-z0-9]{1,32})?$/
/** A model's or an effort's name as an agent takes it: sonnet[1m], gpt-6.1-sol, opencode/deepseek-v4.1-flash-free. */
export const MODEL_NAME = /^[\w.[\]/:-]{1,100}$/
const PROFILE = /^[a-z0-9]{1,32}$/

export type TerminalAgent = { agent: string; profile: string | null; resume: string | null; machine: string | null }

/** The agent terminal `id` runs, in which account, the session it resumes and the machine it's on; null: a shell. */
export function parseTerminal(id: string): TerminalAgent | null {
  const at = id.indexOf("@")
  const own = at < 0 ? id : id.slice(0, at), machine = at < 0 ? null : id.slice(at + 1)
  if (own.startsWith("resume-")) {
    const m = /^([a-z][a-z0-9]*)-([\w.-]{4,100})$/.exec(own.slice(7))
    return m ? { agent: m[1], profile: null, resume: m[2], machine } : null
  }
  const m = /^([a-z][a-z0-9]*)(?:_([a-z0-9]{1,32}))?-[\w-]+$/.exec(own)
  return m ? { agent: m[1], profile: m[2] ?? null, resume: null, machine } : null
}

/** Agent `name` in account `profile` as a terminal names it (no account, or one that can't be named: just `name`). */
export const agentIn = (name: string, profile?: string | null) => (profile && PROFILE.test(profile) ? `${name}_${profile}` : name)

/** A new terminal's id: 8 letters and digits, after `agent` (a name, or a name and account: TERMINAL_AGENT) when it runs one. */
export function newTerminalId(agent?: string | null) {
  const id = Array.from({ length: 8 }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("")
  return agent ? `${agent}-${id}` : id
}

/** The id of a terminal resuming agent `name`'s session `session`. */
export const resumeTerminalId = (name: string, session: string) => `resume-${name}-${session}`

/** The AI agents Vaultite tells apart, the first match winning: id (its plugin's), name, its name in a terminal, what its
 *  writes say they came from (default its id), how it calls itself (an MCP client's name) and its process's command. */
export const KNOWN_AGENTS: { id: string; name: string; terminal?: string; source?: string; said: RegExp; runs?: RegExp }[] = [
  { id: "claude-code", name: "Claude Code", terminal: "claude", source: "claude", said: /claude[-_ ]?code/i, runs: /(^|\/)claude(\s|$)|@anthropic-ai\/claude-code|claude-code/ },
  { id: "claude-app", name: "Claude", source: "claude", said: /claude/i, runs: /Claude\.app\/Contents\/MacOS\/Claude/ },
  { id: "codex", name: "Codex", said: /codex/i, runs: /(^|\/)codex(\s|$)|@openai\/codex/ },
  { id: "chatgpt", name: "ChatGPT", said: /chatgpt|openai/i },
  { id: "cursor", name: "Cursor", said: /cursor/i, runs: /(^|\/)cursor-agent(\s|$)|Cursor\.app/ },
  { id: "opencode", name: "OpenCode", said: /opencode/i, runs: /(^|\/)opencode(\s|$)/ },
  { id: "openclaw", name: "OpenClaw", said: /openclaw/i, runs: /(^|\/)openclaw(\s|$)/ },
  { id: "hermes", name: "Hermes", said: /hermes/i, runs: /(^|\/)hermes(\s|$)/ },
  { id: "gemini", name: "Gemini", said: /gemini/i, runs: /(^|\/)gemini(\s|$)|@google\/gemini-cli/ },
]

/** An agent's name by its id or its name in a terminal ("claude"), or null. */
export const agentName = (id: string) => KNOWN_AGENTS.find((a) => a.id === id || a.terminal === id)?.name ?? null
