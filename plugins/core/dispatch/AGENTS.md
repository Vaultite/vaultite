## Dispatch
Hands a note to a coding agent: each action is a button in a Markdown file's header, a palette command ("Dispatch to
Claude Code", ⌘⇧↩) and an item in the file's menus (an inbox result's too). It starts a new terminal on the server's
Mac: an agent given a prompt with the note's path (not its text: it reads the latest version and may edit it), or a
shell command typed into a new shell. An agent that reports to the inbox runs in the background (a toast offers "Open
session"; option-click the button to watch it); a command, or an agent with `report: false`, opens its tab in the
user's window. From outside the app: `vau dispatch <file>` (`--open` to open its tab anyway).

On another of the Machines that has this vault (the same `vault` id): `vau dispatch <file> --machine <id>`; in another
of the agent's accounts: `--account <id>` (personal). In the app: right-click (hold, on a phone) the header button, the
file menu's submenu, the palette's "Dispatch to Claude Code (<account>) on <machine>". The server
asked passes it to that machine's (both check it's the owner), once its copy of the file matches; the terminal there
opens here as `<id>@<machine>`, and a reply to its report resumes the session there.

The actions are `.vaultite/plugins/dispatch/data.json` (or its settings sheet), in the header's order:
`actions: [{id, label, icon, agent, prompt}]` or `{id, label, icon, command}`, each with `open` (true or false: its tab
opens, or not, whatever comes back). `agent` is an agent's name (claude,
codex, opencode, cursor; `claude_personal`: one of its accounts), `icon` a name (`claude`, `send`), `id` stays put (its
command is `dispatch:<id>`, for hotkeys.json). In `prompt` and `command`, `{path}` is the note's vault path, `{file}`
its full path, `{title}` its name, `{vault}` the vault's folder (shell-quoted in a command). With no `actions`, one:
Claude Code, prompt "Read the note {path} and do what it asks."

While the Inbox is on, an agent is also told to see it through and end with `vau inbox report`. That turn is its
last: once it ends, so does its terminal (and its tab). The user answers from the report in the inbox, and the reply
goes back to the session (resumed while its context is cached, else a new session reads the report: `vau inbox reply
--help`); that session's next report is added to the same file, so the note's whole exchange reads as one thread. `report: false` on an action: neither (the prompt as written, the terminal left running).
