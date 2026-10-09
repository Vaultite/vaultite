## Terminal
A shell in a tab (desktop), started in the vault's folder on the machine the server runs on, to run a coding agent on the
vault: "Open Claude Code", "Open Codex" and the like (the Terminals panel's + too) start one, for each plugin that brings
an agent and is on. Shells keep running when the server restarts or the app quits: they live in Vaultite's own
keeper (or in tmux, the setting `backend`, or in herdr with that plugin's `newTerminals`), and a tab put back gets its
screen and history again. Only the tab that opened an agent starts it: a tab put back (a reload, the app reopened, another device)
reattaches, and if that agent's session is gone it says so and offers a new one rather than starting it by itself. A
shell open on two devices has the size of the last one used: going back to one (focusing its tab or window, a click, a
key) gives it its size again. The sidebar's Terminals panel lists every running shell (click to open it, x to end it); it's also a tab,
`view:terminals`, and a terminal's tab shows the same name (an agent's session name) as its row. In the desktop app it
also lists Claude Code on the web's sessions under Cloud (with claude.ai signed in in the Web viewer; a click opens one
in a web tab). With the Machines
plugin on, other machines' shells are listed too, and a tab `view:terminal/<id>@<machine>` is a shell on that machine
("Open a terminal or an agent on a machine…"). New terminals and agents (Open terminal, Open Claude Code, the
Terminals panel's buttons) open at the workspace's default place: a machine and each agent's account ("Choose where new
terminals and agents open in this workspace…", `state["core:place"]`), else this machine when that one's away; ⌃` is
always this machine. Workspaces save every terminal tab with its machine, so a tab made on one
machine opens the same shell from the others (when that machine doesn't answer, the tab says so and keeps trying, rather
than starting a shell of its own); an agent in one of its accounts is `view:terminal/claude_<account>-<id>`. A screenshot pasted into it is saved on the server's machine and its path pasted (Claude Code attaches it). Its shells have
`VAULTITE=1`, `VAULTITE_URL`, `VAULTITE_VAULT`, `VAULTITE_CLIENT` (`desktop`, `iphone` or `web`), `VAULTITE_TERMINAL` (its id, for an agent started in it) and the `vau` CLI on PATH;
an agent started from it is told it runs inside Vaultite where it takes that (Claude Code, OpenCode; the others read this file).
From a terminal, `vau terminal` lists this machine's sessions and the tabs showing them, and opens, resumes (a Claude Code
session by its title too), reads (`screen`), types into (`send`) and ends them; `vau terminal tidy` closes the tabs of
agents' sessions that are gone. A session ended for good (its tab's End session, its row's x, `vau terminal end`: an
agent asked to close itself runs it without an id) closes its tabs, on every device; an agent's session that ends by
itself keeps them, saying so, with Restart. It has no files, blocks or settings in the vault besides
`.vaultite/plugins/terminal/data.json`: `{"allowUsers": ["someone@example.com"]}` lets more tailnet logins in through
Tailscale Serve (this machine's owner always may), `{"allowRemote": true}` lets anyone who reaches the app in (off by default).
