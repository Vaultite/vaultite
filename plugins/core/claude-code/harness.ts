export type HarnessId = "claude" | "codex" | "antigravity" | "opencode"
export type Serve = { kind: "agent-sdk" | "app-server" | "acp" | "http"; argv: string[] }
export type Harness = { id: HarnessId; name: string; bin: string
  agent: string | null
  serve: Serve
  resume: (session: string, server?: string) => string[]
  chat: boolean }

export const HARNESSES: Record<HarnessId, Harness> = {
  claude: { id: "claude", name: "Claude Code", bin: "claude", agent: "claude", serve: { kind: "agent-sdk", argv: [] }, chat: true,
    resume: (s) => ["claude", "--resume", s] },
  codex: { id: "codex", name: "Codex", bin: "codex", agent: "codex", serve: { kind: "app-server", argv: ["codex", "app-server"] }, chat: false,
    resume: (s) => ["codex", "resume", s] },
  antigravity: { id: "antigravity", name: "Antigravity", bin: "agy", agent: null, serve: { kind: "acp", argv: ["agy", "--acp"] }, chat: false,
    resume: (s) => ["agy", "--resume", s] },
  opencode: { id: "opencode", name: "OpenCode", bin: "opencode", agent: "opencode", serve: { kind: "http", argv: ["opencode", "serve"] }, chat: false,
    resume: (s, server) => (server ? ["opencode", "attach", server, "--session", s] : ["opencode", "--session", s]) },
}
export const HARNESS_IDS: HarnessId[] = ["claude", "codex", "antigravity", "opencode"]
export const isHarness = (x: string): x is HarnessId => HARNESS_IDS.some((h) => h === x)

const SAFE = /^[\w@%+=:,./-]+$/
export const shellLine = (argv: string[]) => argv.map((a) => (SAFE.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`)).join(" ")
