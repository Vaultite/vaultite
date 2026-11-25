import { KNOWN_AGENTS } from "./terminalids.ts"

const PROGRAMS: { id: string; bins: string[]; packages?: string[]; runs?: RegExp }[] = [
  { id: "claude-code", bins: ["claude"], packages: ["@anthropic-ai/claude-code"], runs: /(^|\/)claude(\s|$)|@anthropic-ai\/claude-code|claude-code/ },
  { id: "claude-app", bins: [], runs: /Claude\.app\/Contents\/MacOS\/Claude/ },
  { id: "codex", bins: ["codex"], packages: ["@openai/codex"], runs: /(^|\/)codex(\s|$)|@openai\/codex/ },
  { id: "cursor", bins: ["cursor-agent", "agent"], packages: ["cursor-agent"], runs: /(^|\/)cursor-agent(\s|$)|Cursor\.app/ },
  { id: "opencode", bins: ["opencode"], packages: ["opencode-ai"], runs: /(^|\/)opencode(\s|$)/ },
  { id: "openclaw", bins: ["openclaw"], packages: ["openclaw"], runs: /(^|\/)openclaw(\s|$)/ },
  { id: "hermes", bins: ["hermes", "hermes-agent"], runs: /(^|\/)hermes(\s|$)/ },
  { id: "antigravity", bins: ["agy", "antigravity"], runs: /Antigravity\.app/ },
  { id: "gemini", bins: ["gemini"], packages: ["@google/gemini-cli"], runs: /(^|\/)gemini(\s|$)|@google\/gemini-cli/ },
  { id: "copilot", bins: ["copilot"], packages: ["@github/copilot"] },
  { id: "amp", bins: ["amp"], packages: ["@sourcegraph/amp"] },
  { id: "aider", bins: ["aider"], packages: ["aider-chat"] },
  { id: "goose", bins: ["goose"] },
  { id: "qwen", bins: ["qwen"], packages: ["@qwen-code/qwen-code"] },
  { id: "kimi", bins: ["kimi"], packages: ["kimi-cli"] },
  { id: "droid", bins: ["droid"] },
  { id: "crush", bins: ["crush"], packages: ["@charmland/crush"] },
  { id: "kiro", bins: ["kiro-cli", "kiro"] },
  { id: "auggie", bins: ["auggie"], packages: ["@augmentcode/auggie"] },
]
const nameOf = (p?: { id: string }) => (p ? KNOWN_AGENTS.find((a) => a.id === p.id)?.terminal ?? p.id : null)
export const runsInTerminal = (id: string) => PROGRAMS.some((p) => p.id === id && !!p.bins.length)

export function terminalAgent(name: string): string | null {
  const n = name.toLowerCase(), bare = n.replace(/-cli$/, "")
  return nameOf(PROGRAMS.find((p) => p.bins.includes(n) || (!!p.bins.length && (p.id === n || p.id === bare))))
}

const RUNS_OTHERS = /^(?:node|nodejs|bun|bunx|deno|tsx|npm|npx|pnpm|pnpx|yarn|uv|uvx|pipx|ruby|python[\d.]*|caffeinate|sudo|doas|env|time|nice|nohup|direnv|op|script|mise|(?:-?(?:z|ba|da|fi|k)?sh))$/
export const runsOthers = (program: string) => RUNS_OTHERS.test(program)
const SUBCOMMANDS = new Set(["exec", "x", "run", "dlx", "tool", "--"])
const baseOf = (word: string) => word.replace(/^.*[\\/]/, "")
const programIn = (word: string) => baseOf(word).replace(/^-/, "").replace(/\.(?:exe|cmd)$/i, "")

function packageIn(word: string): string | null {
  const at = word.replace(/\\/g, "/")
  return nameOf(PROGRAMS.find((a) => a.packages?.some((p) => at === p || at.startsWith(`${p}@`) || at.includes(`/${p}/`))))
}

/** The agent a process is, by its command line ("node /usr/local/bin/gemini"), as a terminal names it, or null. */
export function agentOfCommand(command: string): string | null {
  const m = /^\s*(?:"([^"]*)"|(\S+))\s*(.*)$/s.exec(command)
  if (!m) return null
  const program = programIn(m[1] ?? m[2])
  const own = terminalAgent(program)
  if (own || !runsOthers(program)) return own
  const words = (m[3].match(/"[^"]*"|\S+/g) ?? []).map((w) => w.replace(/^"|"$/g, ""))
  if (words.includes("-c")) return null
  const given = words.find((w) => !w.startsWith("-") && !SUBCOMMANDS.has(w) && !/^\w+=/.test(w))
  return given ? packageIn(given) ?? terminalAgent(programIn(given)) : null
}

export function agentOfProcess(args: string) {
  const named = agentOfCommand(args), id = named ? null : PROGRAMS.find((p) => p.runs?.test(args))?.id
  return KNOWN_AGENTS.find((a) => (named ? (a.terminal ?? a.id) === named : a.id === id))
}
