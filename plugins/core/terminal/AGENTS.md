## Terminal
A shell in a tab (desktop), started in the vault's folder on the machine the server runs on, to run a coding agent on
the vault: "Open Claude Code", "Open Codex" and the like (the Terminals panel's + too) start one, for each plugin that
brings an agent and is on. It keeps nothing in the vault but its settings (below).
- Shells keep running when the server restarts or the app quits: they live in Vaultite's own keeper (or in tmux, the
  setting `backend`, or in herdr with that plugin's `newTerminals`), and a tab put back gets its screen and history
  again. Only the tab that opened an agent starts it: a tab put back (a reload, the app reopened, another device)
  reattaches, and if that agent's session is gone it says so and offers a new one rather than starting it by itself.
- A shell open on two devices has the size of the last one used: going back to one (focusing its tab or window, a
  click, a key) gives it its size again.
- The sidebar's Terminals panel (also a tab, `view:terminals`) lists every running shell: click to open it, x to end
  it, right-click to copy its id or its agent's session id, or open that conversation. A terminal's tab shows the same
  name as its row (an agent's session name). In the desktop app it also lists Claude Code on the web's sessions under
  Cloud (with claude.ai signed in in the Browser; a click opens one in a web tab).
- With the Machines plugin on, other machines' shells are listed too, and `view:terminal/<id>@<machine>` is a shell on
  that machine ("Open a terminal or an agent on a machine…"). Workspaces save every terminal tab with its machine, so a
  tab made on one machine opens the same shell from the others (when that machine doesn't answer, the tab says so and
  keeps trying rather than starting a shell of its own). An agent in one of its accounts is
  `view:terminal/claude_<account>-<id>`.
- New terminals and agents (Open terminal, Open Claude Code, the Terminals panel's buttons) open at the workspace's
  default place: a machine and each agent's account ("Choose where terminals and agents open in this workspace…",
  `state["core:place"]`), else this machine when that one's away; ``⌃` `` is always this machine.
- A screenshot pasted into it is saved on the server's machine and its path pasted (Claude Code attaches it); it stays
  while the shell runs and 30 days after.
- Its shells have `VAULTITE=1`, `VAULTITE_URL`, `VAULTITE_VAULT`, `VAULTITE_CLIENT` (`desktop`, `iphone` or `web`),
  `VAULTITE_TERMINAL` (its id, for an agent started in it) and this app's `vau` first on PATH; an agent started from it
  is told it runs inside Vaultite where it takes that (Claude Code, OpenCode; the others read this file).
- `vau terminal` lists this machine's sessions (with an agent's own session id, when it says) and the tabs showing
  them, and opens, resumes (a Claude Code session by its title too), reads (`screen`), types into (`send`) and ends
  them; `vau terminal tidy` closes the tabs of agents' sessions that are gone.
- `vau terminal run <file>` (terminal.run) hands a file to an agent in a new terminal, told its path and to do what it
  asks (`prompt`, `agent`, `account`; `command`: a shell command instead), here or on another machine (`machine`).
  With the Inbox on it works alone in the background and ends with a report there. Dispatch's buttons and vault
  plugins' schedules (a note run each morning) start agents with it; the same run again while one still runs answers
  with that one (`again`: another).
- `vau terminal ask "<prompt>"` (terminal.ask) asks an agent something in a new terminal in the background (no tab;
  `agent`, `account`, `machine`, `model`, `files`, `open`): the app's Ask box ("Ask an agent in the background…") does it, then
  says so in a toast with Open. Images and files pasted or dropped in the box are saved as attachments when it asks and
  go as `files`: their full paths under the prompt, once another machine's copies are there (sameCopy, as terminal.run).
- A session ended for good (its tab's End session, its row's x, `vau terminal end`: an agent asked to close itself runs
  it without an id) closes its tabs on every device, as does exiting the shell left after an agent (exit, ⌃D); an
  agent's session that died or whose machine restarted keeps them, saying so, with Restart. Otherwise a shell ends only
  when its last tab closes at its prompt, never for being left alone: closing an agent's tab detaches it (it keeps
  running, listed in Terminals, its answer still reaching the Inbox), and opening it again attaches.
- An agent's tab and row keep its logo, with its state as a dot on the corner (sessions.ts dotOf): breathing while it
  works, yellow while it waits on the user, blue while its Inbox row is unread (the list's `needs`), red once it failed.
  Terminals lists the ones that need the user first.
- A session terminal.run started on a note (Dispatch) opens its tab beside that note's tab, in its tab group.
