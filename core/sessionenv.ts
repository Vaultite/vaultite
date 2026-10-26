// What a coding agent's session and a Vaultite terminal leave in the environment of what they start: the terminal's
// shells never inherit it from the server, nor the desktop app from whoever opened it (electron/dockenv.ts).
import path from "node:path"

/** A coding agent's own session: a Claude Code that inherits CLAUDECODE and CLAUDE_CODE_CHILD_SESSION takes itself for
 *  nested and saves no transcript, and `vau` takes the shell for that agent. */
const AGENT_SESSION = ["CLAUDECODE", "CLAUDE_CODE_CHILD_SESSION", "CLAUDE_CODE_SESSION_ID", "CLAUDE_CODE_SESSION_ATTENDED",
  "CLAUDE_CODE_ENTRYPOINT", "CLAUDE_CODE_EXECPATH", "CLAUDE_CODE_MESSAGING_SOCKET", "CLAUDE_CODE_MESSAGING_TOKEN", "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_PID", "CLAUDE_EFFORT", "AI_AGENT"]
/** Whether variable `k` (=`v`) is a coding agent's own session's, which nothing it starts should inherit (Claude Code's
 *  tools also get GIT_EDITOR=true, so git never waits on an editor). */
export const agentSession = (k: string, v?: string) => AGENT_SESSION.includes(k) || (k.startsWith("CODEX_") && k !== "CODEX_HOME")
  || (k === "GIT_EDITOR" && v === "true")

/** Which account the session's agent runs in: set per account by whoever started it (its launcher, an alias). */
const ACCOUNT = ["CLAUDE_CONFIG_DIR", "CODEX_HOME"]

/** What a Vaultite terminal tells its shell (plugins/core/terminal: context, backend's startup script) and a plugin's
 *  command (core/hooks.ts). */
const TERMINAL = ["VAULTITE", "VAULTITE_URL", "VAULTITE_VAULT", "VAULTITE_CLIENT", "VAULTITE_TERMINAL", "VAULTITE_BIN",
  "VAULTITE_AGENT_BIN", "VAULTITE_ZDOTDIR", "VAULTITE_USER_ZDOTDIR", "VAULTITE_REMOTE", "VAULTITE_RUN",
  "VAULTITE_PLUGIN_ID", "VAULTITE_PLUGIN_DIR", "VAULTITE_PLUGIN_STATE"]

/** `env`, in place, as if opened from the Dock when an agent's session or a Vaultite terminal started it: their variables,
 *  vau's folders on PATH and the session's account (`keepAccount`: set on purpose) dropped. The names it dropped. */
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
