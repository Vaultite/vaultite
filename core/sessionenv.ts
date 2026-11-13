import path from "node:path"

/** A coding agent's own session: a Claude Code that inherits CLAUDECODE and CLAUDE_CODE_CHILD_SESSION takes itself for
 *  nested and saves no transcript, and `vau` takes the shell for that agent (VAULTITE_TOLD: `vau mcp`'s, mcp/cli.ts). */
const AGENT_SESSION = ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_PID", "CLAUDE_EFFORT", "AI_AGENT", "VAULTITE_TOLD"]
/** Whether variable `k` (=`v`) is a coding agent's own session's, which nothing it starts should inherit (Claude Code's
 *  tools also get GIT_EDITOR=true, so git never waits on an editor). */
export const agentSession = (k: string, v?: string) => AGENT_SESSION.includes(k) || (k.startsWith("CODEX_") && k !== "CODEX_HOME")
  || (k === "GIT_EDITOR" && v === "true")

/** Whether `k` is the server's own, which its terminals and agents' sessions never inherit: npm's, its address, Vaultite's
 *  (not a test run's marks), ELECTRON_RUN_AS_NODE (Electron apps would start as Node), tmux's, Node's compile cache. */
export const serversOwn = (k: string) => k.startsWith("npm_") || (k.startsWith("VAULTITE_") && !/^VAULTITE_TEST(_RUN|_HOME)?$/.test(k))
  || ["PORT", "HOST", "INIT_CWD", "TMUX", "TMUX_PANE", "ELECTRON_RUN_AS_NODE", "NODE_COMPILE_CACHE"].includes(k)

const ACCOUNT = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"]

const TERMINAL = ["VAULTITE", ...`URL VAULT CLIENT TERMINAL BIN AGENT_BIN ZDOTDIR USER_ZDOTDIR REMOTE RUN HOME HOME_AS PLUGIN_ID PLUGIN_DIR
  PLUGIN_STATE PLUGIN_EVENT ACTOR OP PARAMS_JSON SCHEDULE EVENT_JSON`.split(/\s+/).map((k) => `VAULTITE_${k}`)]

/** Changes `env` in place; `keepAccount`: the account was set on purpose. The names it dropped. */
export function asFromDock(env: Record<string, string | undefined>, keepAccount = false): string[] {
  const session = Object.keys(env).some((k) => agentSession(k)), terminal = env.VAULTITE === "1"
  if (!session && !terminal) return []
  const bins = terminal ? [env.VAULTITE_BIN, env.VAULTITE_AGENT_BIN].filter(Boolean) : []
  const dropped = Object.keys(env).filter((k) => (session && (agentSession(k, env[k]) || (!keepAccount && ACCOUNT.includes(k))))
    || (terminal && TERMINAL.includes(k)))
  for (const k of dropped) delete env[k]
  const PATH = Object.keys(env).find((k) => k.toUpperCase() === "PATH") // (Windows spells it Path)
  if (PATH && bins.length) env[PATH] = env[PATH]!.split(path.delimiter).filter((d) => !bins.includes(d)).join(path.delimiter)
  return dropped
}
