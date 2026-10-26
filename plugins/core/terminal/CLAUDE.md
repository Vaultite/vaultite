# Notes for `plugins/core/terminal/`

- Shells outlive the server: the keeper (`ptyd.ts`, a detached process with a headless xterm per screen, giving a
  returning page a snapshot), else tmux (`tmux -L vaultite-<port>`), else another plugin's `terminal:backend`, else the
  server's own children. Names follow the port (backendName), so a QA server's shells stay out of the live list, and an
  app serving no port (a test's, `npm run check`'s) never reaches them. Under a systemd unit the keeper and tmux need
  their own scope, or a restart kills them.
- One shell has one size, the last device's; a view used again that doesn't match sends its own.
- A terminal's state (the list's `state`, the service "inbox:state") comes from OSC 7501 (`osc7501.ts`) when its
  program speaks it, else its agent's hooks, else a question its agent declares seen on its screen. Its agent's own
  word that it waits ("terminal:agent-waits": Claude Code's session file) blocks it whatever those say: Claude Code
  has dialogs no hook tells. A blocked report without a kind (Codex's, which never probes) waits for that question on
  screen: Approve and Deny need its words.
- OSC 7501 is answered where the pty is held (the keeper, the server's own shells), in stream order: the probe's
  answer must reach the program before the primary DA answer after it (Claude Code takes a DA answer first as "not
  spoken here"). tmux answers DA itself and drops the OSC, so agents there stay on hooks; a keeper an older build
  started speaks it only once restarted.
- Terminal ids: `<name>-<id>` starts agent `<name>`, `<name>_<account>-<id>` in an account, `resume-<name>-<session>`
  resumes, through the service `agent:<name>` of the plugin that brings it.
- A tab opened from outside only attaches (a page starts only ids it minted), so `vau terminal open` starts the session
  first.
- The socket answers this machine, or through Tailscale Serve the owner or `allowUsers`; another Origin is refused.
- Shells start through `SHELL_DIR` (backend.ts), which runs the user's login files and then puts the app's `vau` first
  on PATH (path_helper and Homebrew would put theirs first).
- Gotchas: node-pty's `spawn-helper` may lack its exec bit (fixed at start); a keeper whose checkout moved can't spawn,
  so it retires; tmux takes PATH from the client that made the session; shells drop `ELECTRON_RUN_AS_NODE`; whether a
  shell runs something is its tty's foreground group (`inFront`), not its name.
