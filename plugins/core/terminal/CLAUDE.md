# Notes for `plugins/core/terminal/`

- **Shells outlive the server**: node-pty in a backend (`backend.ts`): the keeper (`ptyd.ts`, a detached process with a
  headless xterm per screen on `<run>/vaultite-ptyd1-vaultite-<port>.sock` (`core/runtime.ts`: `$TMPDIR`, Linux `$XDG_RUNTIME_DIR/vaultite`; under a systemd unit the keeper and tmux get their own scope, or a restart kills them), giving a returning page a snapshot), else
  tmux (`tmux -L vaultite-<port>`), else another plugin's (`terminal:backend`: the herdr vault plugin's, via `backendKit`), else the
  server's own children. Names follow the port, so a QA server's shells stay out of the live list.
- One shell has one size, the last device's; a view used again that doesn't match sends its own (Terminal.tsx `claim`;
  QA `termsize.mjs`). Agents' states are a file per terminal (`<run>/vaultite-terminal/states/<id>`); their context and
  cache come from each agent plugin's `agent-meters:<name>` (asked with Agent meters off too: its `session`, the agent's
  own id), drawn as Agent meters says (the service `terminal:meters`) as `meter`.
- **Agents**: id `<name>-<id>` starts agent `<name>`, `<name>_<account>-<id>` in an account, `resume-<name>-<session>`
  resumes, through the service `agent:<name>` of the plugin that brings it (AgentStart in core/codingagents.ts -> `{command, cwd}`; `context` is
  `context.md` plus the plugins' `forAgents`, shown word for word by `view:terminal-instructions` and `vau terminal instructions`). App side: `agents` in a definition, `openAgent`, `agentOfTerminal`.
- A tab opened from outside only attaches (a page starts only ids it minted), so `vau terminal open` starts the session
  first. A session ended for good (or a shell's clean exit) tells its sockets `ended` and its tabs close (`closeIt`) on
  every device, Workspaces or not; an agent's session that ends by itself (or after its report: `keepTabs`) keeps its
  tabs, saying "Session ended" with Restart, as VS Code does.
- The socket answers this machine, or through Tailscale Serve the owner or `allowUsers`; another Origin is refused.
- **The app's vau first on PATH** (`VAULTITE_BIN`: bin/, or under the desktop app a vau in LOCAL/bin running it): a
  login shell's files (path_helper, Homebrew) put theirs first, so shells start through `SHELL_DIR` (backend.ts: zsh's
  ZDOTDIR, bash's rcfile, fish's -C), which runs the user's files and then puts it first.
- Gotchas: node-pty's `spawn-helper` may lack its exec bit (fixed at start); a keeper whose checkout moved can't spawn,
  so it retires (`stale`); tmux takes PATH from the client that made the session (the rest per session, `-e`); shells drop
  `ELECTRON_RUN_AS_NODE`; whether a shell runs something is its tty's foreground group (`inFront`), not its name;
  `plugin.memo` keys on `fn.name` (anonymous functions share an entry).
- The panel's Cloud rows (`cloud.ts`) are Claude Code on the web's sessions, from the desktop app (`webPages.cloud`, electron/web.ts).
