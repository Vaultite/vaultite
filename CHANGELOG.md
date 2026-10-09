# Changelog

What changed in Vaultite, newest first: one line per change, as it stands now (a change undone or redone before a
release is written once, as it ended up). Versions follow [semantic versioning](https://semver.org); the plugin API has
its own number (`API_VERSION` in `core/version.ts`). The details are in git history and in `vau docs`.

## Unreleased

- **Publish** (a Vaultite plugin, off by default): notes and folders as public pages on your Vaultite Cloud site, from a
  note's or folder's menu, the palette or `vau publish`, with links between them and their images; Published lists
  them. Needs a Publish plan, bought in the browser.
- **A busy day in a calendar stays small**: a query's month shows a day's first three files and "N more" to open the
  rest. The sandbox's files were edited over the weeks before, not all just now, and one made before (desktop, the
  web demo's saved copy) is made again.
- **Web demo opens on a bundle**: `?bundle=<id>` starts it on that bundle, and the page around it (vaultite.com's
  picker) switches bundles live; what needs a machine stays off whichever is applied.
- **Lines between sidebar panels**: Settings > Appearance (or the palette's Toggle lines between sidebar panels) draws
  a line between the sidebars' panels; off by default.
- **Properties start folded**: in reading and editing, a note's Properties are one line until you open them; a file
  whose Properties you open keeps them open on that device.
- **Plugins' pages are built in**: they live in `.vaultite/pages`, update with their plugin, and never land among your
  files; Copy to my vault (the page's bar, its menu) makes one yours to change, its pins and links following. A vault
  with unchanged copies from before is asked once whether to use the built-in ones. A new vault's Start here note and
  its AGENTS.md and CLAUDE.md lines come only when you tick "Start with example pages".
- **Plugins ask before writing on their own**: what a plugin writes outside `.vaultite/` by itself (Activity's day
  recaps, Agent files' pointer lines) needs your yes once ("Activity wants to write a recap of each day into
  Recaps/"), kept in its settings under Writes on its own; anything else is refused and logged. What you or your agents
  ask for never asks.

## 0.2.0 (2026-10-09)

The first public release: the source on GitHub, signed and notarized Mac builds, Linux's AppImage and .deb, and a
nightly. Plugin API 3.

- **Agents**: Claude Code and others in the app's terminals, their state and usage at a glance; a note dispatched to
  an agent on any of your machines.
- **From another Markdown app**: an Obsidian vault opens as it is, with its settings, themes and many of its plugins.
- **Apps**: an iPhone app, the desktop app on Linux, day recaps, lessons, and Vaultite Nightly beside Vaultite.
- **Files**: no size limits, and the app writes only what you changed.

### Agents
- **Agents see everything, a page at a time**: read, render, query, search and list take `offset` and `limit`, and
  every cut answer says so and gives the next offset (a long query cell ends in "…"). `edit_file` (`vau edit`) changes
  just the text it names; writing a page back whole is refused, so a long file's end can't be dropped.
- **Coding agents' usage over any range**: a usage block's `days` goes past 30, as far back as the tool's data.
- **Writing plugins from ChatGPT or claude.ai**: an app on the internet writes a vault plugin's code without asking each
  time; it runs only once you allow it, and that request says what it discloses and which files changed.
- **Secrets from any device**: `vau secret "<what>"` asks for a password or a key file in a hidden field on whatever
  device you're on (the phone too, through another machine), and hands it only to the command it's piped into.
- **Shorter dispatch in a file's menu**: with one action it reads "Dispatch" (and where it runs), like the menu's other
  verbs; several still name theirs.
- **Context ring on 1M sessions**: a Claude Code session with a 1M context no longer shows red near 200k when its status
  line writes to `~/.claude` under another account.
- **A default place per workspace**: pick the machine and account new terminals, agents (Open Claude Code, ⌘J) and
  dispatches open at there (right-click the dispatch button, Default in <workspace>, or "Choose where new terminals and
  agents open"); the button shows where, and a machine that's away gives way to this one. ⌃` opens a terminal here.
  ⌘⇧↩ works again with a single account.
- **No double dispatch**: while a note's session runs, its dispatch button wears a dot and dispatching it again opens
  that session; "Dispatch again" starts another.
- **Terminals panel**: a session from another workspace shows that workspace's name before its context ring, so every
  ring lines up at the row's edge.
- **Claude Code on the web in the Terminals panel**: the desktop app lists your claude.ai/code sessions under Cloud
  (working, waiting on you or idle, and since when; a click opens one in a web tab), read with the Web viewer's
  claude.ai login once you've opened claude.ai in it since the app started, never on launch alone (every 5 seconds
  while one works or waits, else 15; the tab needn't stay open). A session finishing or needing you is in the Inbox
  again.
- **Terminals show their agent's state**, as Claude Code's agent view does: an agent's icon keeps its colour while it
  works, turns yellow with a dot while it waits on you, and grey once idle; the Terminals panel lists the waiting ones
  first, then working, idle and plain shells, and holds still while the pointer is over it. Another machine's terminal
  has its name on its icon ("M4"); "detached" is in its tooltip, not on its row. The tooltip shows in the open
  sidebar too, with the account it runs in when its agent has several.
- **Agent meters** (a plugin, off until turned on): a Claude Code terminal's context used, as a ring that fills up, a
  percent or tokens beside its name, and its prompt cache's time left while idle: its icon keeps its colour only as far
  as the cache lasts, draining from the top, or an inner ring.
- **Dispatch in the background**: dispatching a note no longer opens the agent's terminal; a toast offers "Open
  session" (option-click the button to watch it), and its report comes to your inbox. `open` on an action changes it.
- **A report is a thread**: replying to an agent's report and its next report stay in the same file, back in your
  inbox, so a whole exchange reads as one conversation. Its `updated` property says when its latest report came, and the
  inbox sorts by it. Each dispatch action has an "Open its terminal" switch in its settings.
- **`vau open` a web address**: `vau open https://...` (and a notification's button) opens it in a web tab, not a
  missing file.
- **Dispatch to another machine or account**: a note goes to Claude Code on another of your Machines (your laptop,
  from the phone) or in another of its accounts: right-click or hold the header button (each account on each machine,
  the button's own checked), the file menu's submenu, the palette's "Dispatch to Claude Code (Personal) on ...", or
  `vau dispatch <file> --machine <id> --account <id>`. The button names the account it uses. Its terminal opens in your window, and replying to its report resumes it there.
  Only machines with this vault are offered (each says its vault's id); one with a vault of its own is refused.
- **Reports you read at a glance**: an agent's report says in its title what kind of work it was and where it stands
  ("Feature done · ...", "Fix needs you · ...", "Research stuck · ..."), and every result an agent leaves in the
  inbox (`vau inbox report`, `inbox_add`) starts with a short plain-language "In short" box, which is also what the
  push says.
- **Quieter inbox**: an agent's turn ending ("Claude Code finished") no longer toasts or pushes, since it may still be
  working; its report says when the work is done. Waiting for you and permission asks still notify; the Inbox's
  setting "Agents' finished turns" brings them back.
- **A file's actions**: operations say which kind of file they act on (a person's timeline, a book's progress, ticking a
  routine), so they show in that file's menus, in the palette (⌘. lists everything a plugin can do with the open file,
  asking for what's missing), in `vau actions <file>` and MCP's `actions`; vault plugins' ops can say it too (`action`).
- **Agents ask you to pick**: `vau choose` (MCP's `choose`) shows a list in your window's palette, searchable like the
  quick switcher, on the Mac, in a browser or on the phone, and gives the agent what you picked; lines piped in work
  like dmenu (`ls Notes | vau choose --prompt "Which one?"`), with `--other` for something typed that isn't listed.
- **Reports you answer from the inbox**: an agent handed a task to do alone (a voice note's front door) sees it through
  and ends with `vau inbox report`, a result with what it did, its open questions and screenshots. Its reply box sends
  your answer back into that session (its terminal, or the session resumed), keeps it in the report with when and its lines, and marks it done:
  it shows at once as sending, and the report stays open (into the archive). A report's header says when it came. A reply sent from another machine's app
  goes through the app on the machine the session runs on; Open session opens it there. What you type in the box is
  kept on the device until it's sent, so a failed send or a redrawn report doesn't lose it. A voice note reaches its agent whole (it starts
  with it, rather than having it typed in as it opens; its file's path set apart from what was said). The agent names the note for what it's about and archives it when it's
  done (`vau inbox done`, which also names a result anew), and a reply that resumes an ended session is its first message.
  A dispatched agent is told to end with a report too, and its terminal ends (tab and all) when the turn that reported
  does, so nothing is left to close by hand. A reply resumes the session while its prompt cache lasts (Claude Code: an
  hour or five minutes after its last response, read from its transcript); later it starts a new session told to read
  the report, rather than send the whole old conversation again. The reply box says which, and offers the other.
- **Operations are the API**: everything an agent, script or plugin can do is one operation, served as
  `POST /api/ops/<id>`, `vau <id>`, MCP and the docs (`vau ops`, `vau docs api`).
- **Agent skills**: `skills/` has two, the vault's rules and how to write a vault plugin, for any agent and for a vault
  without the app: `npx skills add Vaultite/vaultite`, or in Claude Code `/plugin marketplace add Vaultite/vaultite`.
- **MCP server**: `vau mcp` (stdio) or `POST /api/mcp`. It has tools to search, read, render, query, write notes and
  logs, clip, remember a fact, open a file, see today, the calendar and routines, tick a routine, edit a file, follow
  links and history; `ops`/`call` run any operation, and `events_wait` waits for an event.
- **Your vault in Claude, ChatGPT, Grok Bot and Muse**: MCP on a public address (behind a tunnel) that claude.ai adds as a
  custom connector, ChatGPT as a custom MCP server plugin, and Grok Bot and Muse when asked in a chat. Connections has
  Set up Claude, ChatGPT, Grok Bot and Muse, each a sheet of a few short steps with the address one click away and the
  field for the code that signing in shows (the app then shows under Connected, shimmering, till it finishes signing
  in), where you also disconnect an app.
- **Photos from ChatGPT and Claude go in the vault**: `upload_file` (`vau upload`) saves a photo or file into
  Attachments/ and embeds it in a note or log. ChatGPT hands over the chat's photo; claude.ai's code sandbox PUTs it to
  a one-time link (allow your vault's address in its network settings). Inbox notes an AI app sends are labelled AI, and a log another AI corrects by its id stays one log.
- `vau command` and `ui.command` say when the command couldn't run in your window (it needs a note open there) instead
  of answering "Sent"; `vau commands` lists the window's palette commands and which can run now.
- **`vau` alone in a terminal is a prompt**: Tab completes commands, flags and values (choices, the vault's paths, command
  ids), with history. On any command `--copy` also puts the output on the clipboard, `--count` and `--paths` print how
  many a list holds or its files one a line, and `-` as a value reads stdin (a note's body is read when piped in).
  Errors exit non-zero on stderr, and `vau ... | head` or a stdin left open no longer breaks or hangs it.
- **Dev tools for agents testing the app**: `vau dev screenshot|dom|console|eval` look at your open window (a
  screenshot in the desktop app, its HTML, its console, JS run in it); only you on the Mac, never an app on the internet.
- ChatGPT and Claude can hand a note to Claude Code on your Mac (`dispatch.run`), each time after your yes on the phone.
  They get every tool, `ops` and `call` too, except terminals and the screen; what can run code on your Mac (a plugin
  turned on, settings, bundles, a palette command) waits for your Approve on the phone or in the Inbox.
- **Vaultite Cloud**: sign in at cloud.vaultite.com/connect, type its code in Connections (or `vau cloud sign-in <code>`),
  and your vault's MCP server answers at `https://<you>.vaultite.app/mcp`, with no tunnel of your own: this Mac keeps
  the connection.
- **Events**: `vau events`, `GET /api/events/stream` and `events.wait` report file changes, writes, inbox events and
  plugins' own events, so one agent can wait for another.
- **Inbox**: when an agent finishes or needs you, you get a toast, a Mac notification and a badge. Results to read
  later go in `Inbox/` (`vau notify`, `vau inbox`); Done moves one into `Inbox/.archive/`, out of the way. It shows only what needs
  you: read events leave the panel and the block, and fold under Read on the Inbox page (the setting Show read events
  brings back the last day's, greyed). Sessions on
  claude.ai/code and notifications from web pages arrive here too. One inbox on all your machines: every app (the Mac
  app with its own server, the iPhone, a browser) shows each machine's events (Machines), live, and reading or
  dismissing one anywhere does it on the machine that keeps it.
- **Which app**: an agent in a terminal knows whether you opened it in the Mac app, the iPhone app or a browser
  (`VAULTITE_CLIENT`: `desktop`, `iphone` or `web`).
- **The vault's rules are `.vaultite/AGENTS.md`**, short: the app's rules, a line from each plugin that's on, and your
  own rules under their heading at the end, which the app keeps when it rewrites the rest; formats are read on demand
  with `vau docs <topic>`. The Agent files plugin writes it: turned off, the app stops and takes its part out. The app
  no longer writes the vault's AGENTS.md or CLAUDE.md; Agent files can add a one-line pointer to them, and vaults set
  up by older versions are moved over once.
- What every agent is told up front comes from the plugins that are on (a line each in their manifest), the same in
  the rules, MCP's instructions (`vau mcp.instructions`) and a terminal agent's context: no fixed list naming folders
  or files that may not be there.
- The prompt a voice note hands the front-door agent is an Inbox setting (Voice note prompt).
- **`vau` drives the app**: `vau terminal open|resume|screen|send|end|tidy`, `vau workspace close`, `vau panels`,
  `vau pin`, `vau context`.
- **Coding agents**: Codex, OpenCode and Cursor plugins sit beside Claude Code, with plan limits, live sessions, usage
  by project and model, and conversations. Claude Code supports several accounts (one can be private). Everything is on
  one Agents page. New herdr plugin.
- **OpenClaw**: a plugin for OpenClaw, the personal AI agent: its sessions running now, usage by day, folder and model,
  each conversation, its agents' memory and its scheduled jobs, read from its own files on the machine the server runs
  on; `vau openclaw connect` gives it the vault's tools.
- **Hermes**: a plugin for Nous Research's Hermes Agent, in its main home and each profile: live sessions, usage by
  project and model, conversations, its memory and scheduled jobs; `vau hermes connect` gives it the vault's tools.
- **Provenance**: an `origin: human | reviewed | mixed | ai` label on any file, shown in its header. Notes made by
  agents are labelled `ai`; yours stay unlabelled (no label is yours, and the header shows none) unless you turn on Label
  your notes. Images, videos, PDFs and other files get the same label and menu, kept in a list so your
  photos are never rewritten (`vau origin`, `vau origin set`); files agents upload are labelled `ai` there, their
  bytes as they came, and images from ChatGPT or Gemini that carry the IPTC "made by AI" mark show as `ai`.
- **Dispatch**: the Claude button in a note's header (or ⌘⇧↩, "Dispatch to Claude Code") starts Claude Code in a new
  terminal, told to read the note and do what it asks; from the phone too. Add your own actions: another agent or
  prompt, or a shell command (`vau dispatch`).
- **Token limits**: every Markdown file has one, and the files agents load at startup (CLAUDE.md, AGENTS.md, ME.md,
  skills) a stricter one. The status bar's token count turns amber near it and red over it, the file tree marks what's
  over, the Agent context panel lists them and what each CLAUDE.md loads with its imports, and `vau size` tells agents.
  A file's own `max_tokens` wins. It only warns.
- **Where a block's data comes from**: right-click a block to see the files, settings and live sources it reads
  (`GET /api/blocks/sources`; `nth` picks one of two alike); the file it's in is "This file's properties", which opens them.
- **Web clipper** (`vau clip`, MCP `clip`) and **AI import**: ChatGPT and Claude exports become notes, and what they
  remembered is reviewed before it reaches `ME.md`.
- **Vault plugins without code**: a manifest can declare operations, event hooks, startup commands and a schedule that
  run scripts in any language (`vau docs vault-plugins`).
- **Schedules**: a plugin runs a command or any operation on a timer (`every`, `at`), on one machine; a note handed to
  Claude each morning is `dispatch.run` on a schedule (`vau schedule list`, `vau schedule run`).
- **Middleware over operations**: `plugin.around` rewrites an operation's parameters or answer, or refuses it.
- The desktop app can serve DevTools to agents on the Mac (`debugPort`, off by default).

### Apps
- **Vaultite Nightly**: main built each night as an app of its own (a grey icon, its own data), installed beside
  Vaultite and updating itself from one nightly to the next. A failed update you asked for says why in a line, with
  Show log, instead of the build's output.
- **Voice notes are never lost**: the watch stops a recording at 2 hours; a long one, or one the phone can't transcribe
  or send, goes to the server as audio (kept when it can't be transcribed), waiting on the phone until it can; one past
  1,500 words stays in the inbox instead of starting the front-door agent.
- **A web page in another browser's tab**: plugins add buttons to the Web viewer's bar and its tab's menu; the
  BrowserOS plugin (Vaultite/plugins) opens the page in BrowserOS's own window, shown in a tab by App windows, where
  passkeys work.
- **Web demo**: the whole app in a browser, nothing to install, on the sample vault (`npm run build:demo`, static
  files for any host): edits stay in that browser until Reset; terminals, agents and connectors need the app.
- **Web tabs show their sites' icons**: a page's own icon on its tab and in Web pages, kept for when its page isn't
  loaded yet; the globe for a site with none or one that can't be drawn.
- **Day recaps**: what you did each day, kept in the vault for good (`Recaps/<date>.md`, plain Markdown): notes made
  and changed with the text you changed, tasks done or dropped (checkboxes and the Tasks plugin's, one moved from a
  file to another, a recurring one), captures (bookmarks synced, clipped pages, transcripts), logs, and an agent's
  session as one line. A timeline block (`recap`, in a daily note that day's), the Activity page's Days tab with a
  grid of days, and `vau recap`.
- **Coming from another Markdown app**: opening its vault offers to run its plugins here, all in one click or
  each as it is or with Vaultite's own (agents can read what those draw), never both, in one row on the Plugins page
  with a line to swap them; Browse finds that app's plugins, with what's known to work here (or isn't needed:
  Vaultite does it), offering Vaultite's own first where there is one; one first runs once you allow it, and its code
  changing asks again. Notes' links in its own URI scheme (open, new, search) work here, and those a plugin registers
  (Advanced URI's) reach it.
- **Lessons**: an agent teaches you a note, a PR or a topic as a lesson (`type: lesson`), drawn one step at a time:
  each step's question (multiple choice with a why for each answer, recall then reveal, or putting steps in order; one
  that opens a step is a guess first) opens the next, right or wrong, and the file keeps where you are. Cards files
  (`type: cards`, a heading per card, ==highlights== as cloze cards) and a finished lesson's recall questions come back
  for review when you're about to forget them (FSRS, kept in the plugin's reviews.json, never in the file), mixed
  across files, with keys (Space, 1 to 4). `cards.due` and `cards.review` let an agent quiz you anywhere; the
  Learning page's `lessons` block lists them.
- **App windows** (off by default, desktop app on a Mac): other apps' windows in tabs, one window a tab, the app's own
  window kept behind a see-through tab; ⌃⌘P opens the palette from any app while one is open. Turned on with the vault
  open, its tab has Reopen window. Tabs and the picker show each app's own icon; a tab's menu has Close <app> window,
  and closing a tab closes a window the app made for it (none was free) rather than leaving it empty behind. A window
  on another desktop isn't followed there when its tab is chosen, nor replaced by a new empty one: the tab offers Go to
  it or Use a window here.
  Picture in picture and other floating windows no longer open a tab stuck on Opening. The picker lists windows
  already in a tab first, marked In a tab.
  An app coming in front with a tab's window (a link opened in it, ⌘Tab, its Dock icon) shows that tab. Going back
  to an app's tab never shows the desktop through it: the window stays behind the window while its tab is hidden
  (when nothing would show it), and the tab turns see-through only once the window is in place.
- **Phone tabs like a browser's**: drag the bottom bar up and the page shrinks after your finger into the tab list;
  pull a page down from its top for New note, the command palette or Close tab (go left or right to pick). The tab list's top
  line is Chrome's: search the tabs, the workspace in the middle (its menu; swipe the list sideways for the next one),
  More (select tabs, close others, close all). The list opens and closes like Chrome's and Safari's: the page's
  picture flies between the page and its card on a spring while the other cards settle around it, with no blank
  patches; a new tab grows out of the + with the list left as it was; closing a tab shrinks it away and the others
  close up without the list jumping.
  A drag cut short by the app switcher or another app (the bar, a drawer, a sheet, a card) no longer leaves the page
  shrunk with gaps at its sides, or a drawer half out: it settles when you come back.
- **iPhone app** (`ios/`, Capacitor): opens your Mac's Vaultite over the tailnet, remembers servers, and adds Vaultite
  to the share sheet. Widgets and controls (iOS 26): a voice note (also on the Action button), a new note, your daily
  note, search; your routines' week like Today's (today's ticked from the widget), or today's as icons; agents waiting,
  approved or denied from the widget. Record a voice note for your inbox (the palette) opens the same voice note there,
  and records one on a computer, transcribed on your Mac. Voice notes are yours, like notes you write.
- **Health and Learning fit anyone's**: Health's `workouts` block draws any workout area (`area:`), with lifts or the
  top grade when its logs have them; Learning's default areas are reading and study (any subject). Apple Health imports
  every workout kind into the area named like it, else Workouts.
- **Finance** (community plugin): a Spending page of spending, income and bills from a CSV of your transactions, with
  a range and account filter, in your currency.
- **Icons**: `icon:` takes any of Lucide's ~1,850 icons or an emoji, on pages and routines (a routine without one shows
  its area's). "Search icons" finds them by name or by what they're about; "Change icon of current file" sets one.
- **Phones get a layout of their own**: the sidebars are drawers, a header has the file's menu, a flat bottom bar docked
  to the screen's edge, and the tab list is a grid of previews. Sheets (the tab list, colour schemes, details) fill the
  screen and close with Done at the bottom right; the tab list has new tab and the count beside it, and the workspaces
  as squares at the top (hold one to rename, duplicate or delete it). A blank tab looks like the desktop's. Tabs move like a browser's: the page shrinks into its
  card as the tab list opens and grows back out of the card you pick, a new tab grows out of its +, and the bar has
  Back and Forward, which slide the page; a swipe in from the left or right edge always opens that sidebar. Search and
  the command palette scroll their results, not the page, even after the page was scrolled; dragging the results puts
  the keyboard away, as iOS's own search lists do. In the iPhone app the tab
  list's cards are real pictures of each tab, as it was when you left it.
- **Holding is right-click on phones and tablets**: a finger held still opens the same menu a right-click does (tabs,
  files, the sidebar's panels, blocks, a blank tab's sections and buttons), with a tap from the phone. Text in a note
  still selects as before; the app's own menus, drawers and bars no longer do. Hold and then move to drag, as with a
  mouse: files into folders, pinned pages, a drawer's panels, a board's cards. Swipe a file sideways for Move and
  Delete, an Inbox result for Done and File to, an event for Read and Dismiss. Hold a card in the tab list for its menu, or move it to reorder.
- **Select several at once**, as in Finder: ⌘-click adds a row, ⇧-click a run, ⇧↑ ⇧↓ and ⌘A from the keyboard, Esc lets
  go, in the file tree, the tab bar and Tabs panel, Pinned, the Inbox and a blank tab's recent files. A right-click on
  them acts on all of them with one toast and one Undo (open, move, pin, archive, copy paths, delete; close, pin or
  split tabs; unpin pages; Done, file, read or dismiss in the Inbox), and dragging one drags them all (into a folder, a
  pane, Pinned). On a phone, Select in a row's menu, then tap; a bar at the bottom has Actions and Done, and the tab
  list's cards select the same way. ⌘-click in those lists no longer opens a new tab: a middle-click or ⌘↵ does.
- **Tab groups on phones**, like Chrome's: drop a tab card on another to group them, on a group to join it, or on +
  to take it out. A group is a pane, so on a computer it's a split, and a split shows on the phone as a group.
- **Haptics on phones**: picking up and dropping in the tab list and sorted lists, a tick as an item passes another,
  ticking a checkbox or routine, switches and segmented controls, the read / edit toggle and a drawer settling.
- **Desktop app**: a real menu bar, and the **Web viewer** (web pages in tabs, logins kept per workspace, a Web pages
  panel, Save to vault; right-click an image to save it to the vault, download, copy it or its address). Any dropped file opens in a tab. A crashed page reloads itself. Signed builds keep their
  permissions across updates. Downloaded releases (a notarized dmg, for Apple silicon or Intel Macs, macOS 13 or
  later) update themselves: a new version downloads in the background, then a toast offers Restart to update (quitting
  installs it too). New icon, and you can set your own Dock icon.
- **Errors**: the errors the app and the server hit, kept on the server's Mac for 30 days (an Errors page, `vau
  errors`). That includes when the app stopped, which is sent after you reload, a block that failed, and the server's
  own errors and crashes, each with its stack, device and request. A new kind of error shows a toast. The server's
  log has the date and time on every line.
- **Machines**: one vault across many computers. Any machine's terminals and agents can be reached from any device; click or right-click a machine to open one.
- **Screen sharing**: another computer's screen (VNC) in a tab, whole or a single app. It stays connected in the
  background, has a phone trackpad mode, and is faster.
- **Terminals**: shells survive restarts without tmux (Vaultite runs its own keeper) and scroll like a real terminal.
  Phones get a row of extra keys. Closing a tab leaves what runs in it running.

### Setup and look
- **Tooltips only say what you can't see**: a sidebar row, an inbox item, an outline heading or a links item cut off
  shows its whole name on hover, in the open sidebar as in the rail; one that fits shows none.
- **Folder settings pick a folder**: a plugin's folder (Clipper's, Templates', Activity's capture folders and the rest)
  opens a fuzzy list of the vault's folders; one typed that isn't there is made, and one set that's missing shows red.
- **Settings opens sheets, never unfolds**: Plugin settings and Fonts open in a sheet like Keyboard shortcuts, so the
  page never shifts; Setup links to the Plugins page in a plain row like the others; a palette (a font picker) works
  over a sheet.
- **Everything from the keyboard**: Tab passes a list (the file tree, a panel's rows) as one stop and comes back to
  the row it was on; F6 and ⇧F6 move between the sidebars and panes; ⇧F10 (or the menu key) opens the menu of what has
  the keyboard, a row or the editor at its cursor; the sidebar and split edges resize with the arrows (Enter resets);
  Tab closes a menu, the palette keeps it in its field, and links in sheets take Tab and Enter.
- **A dock in the phone's drawer**: hold the Buttons panel's heading, Put in the dock, and its buttons are icons at the
  drawer's bottom, at your thumb, instead of somewhere down the scroll; hold one for its name and menu, or drag to
  reorder (`vau panels dock buttons`).
- **The desktop app on Linux**: an AppImage and a .deb (`npm run release:linux`; the .deb sets up Ubuntu's AppArmor
  profile for the sandbox), or `npm run app:install` from a checkout, which updates itself from main; Linux menus
  (Ctrl keys, Settings and Quit in File), Open with and `vaultite <file>`, and the app quits with its last window.
- **Line width for snippets**: a note's widest line is the CSS variable `--line-width` (700px), so a CSS snippet or a
  plugin can widen or narrow notes (`:root { --line-width: 900px; }`); ⌘+ zoom still scales it.
- **Self-hosted on Linux**: `vau service install --vault <folder>` keeps the server running as a systemd user unit
  (lingering, for a VPS) or a launchd agent on a Mac; the README says how to run it on a server, the Self-hosted bundle
  is for any always-on machine with its agents on, and the app says "this machine" rather than "this Mac".
- **At home on Linux**: the desktop app keeps the window's own title bar (no gap for the Mac's traffic lights), keys
  and tooltips say Ctrl+O rather than ⌘O and follow your hotkeys, defaults that Linux desktops take are moved there
  (back and forward Alt+←/→, workspaces Alt+1–5, file actions also Alt+Enter), Show in folder opens the file manager,
  Ctrl+Shift+C/V copy and paste in the terminal, Shift drags files in to move them, a middle click on a link no longer
  pastes, Linux fonts are in the stacks, and Mac-only features (Dock icon, App windows, Look up) stay out of the way.
- **Ambient status bar**: the status bar shows plugins' small items whatever is open, a click from their page: today's
  routines done, agents working or waiting on you, the inbox's new, Claude's plan limits. Right-click it to choose
  them (appearance `statusBar`); plugins add theirs with `ambient`.
- **A vault plugin runs only once this Mac allowed it**: turning one on here allows it as its files are; one turned on
  by sync, a shared vault or a bundle, or whose files changed since, waits on the Plugins page with what changed, what
  it says it does and Allow (`vau plugin allow`). One made with `vau plugin new` here reloads as it's edited. Plugins on before stay allowed.
- **Plugins from GitHub**: the Plugins page's Browse lists the plugin directory (repositories with the topic
  vaultite-plugin) by stars, newest or last updated, with each one's version and what it says it does, and installs
  or updates one (`vau plugin install owner/name`, `update`, `uninstall`, `search`). Where each came from is kept in
  `.vaultite/plugins-lock.json`; a version the directory blocks doesn't load. One repository can hold several plugins
  (`vau plugin install owner/name/folder`, tagged `<folder>/v1.2.0`), and a directory can be a private repository's
  (plugins.json's `index`: `owner/name/index.json`, read with git).
- **Allow all**: when several vault plugins wait to be allowed on this machine (turned on on another one), the Plugins
  page allows them in one go, after saying what each does beyond the vault.
- **Your plugins from another app, here**: the sheet of Vaults from other apps (and `vau other-apps plugins`) lists the plugins
  the vault had on in its other app, each with what stands in for it here, to turn on or install in a click; a plugin
  says which it replaces in its manifest (`replaces`).
- An emoji in a property (an `icon:` picked in the app) is written as it is, not as `"\U0001F4A1"`.
- **Rename a tag everywhere**: right-click a tag in the Tags panel (or Rename in its sheet, `vau tags rename`): every
  file's frontmatter tags and #tags change, nested tags too, merging into one that exists.
- **Writing a plugin**: `vau docs plugin-api` lists every method, key, name and service the plugin API has, written
  from the code; a plugin that can't be installed says why; `usePluginSettings` reads and writes a plugin's settings from its frontend; a plugin installed from a folder
  takes its edits with `vau plugin update <id> --apply` and keeps running, and `.vaultiteignore` leaves its tests out.
- **Tabs in the sidebar, the tab bar optional**: the Tabs panel lists the open tabs pane by pane (show, close, drag,
  their menu); with the tab bar off (Settings > Appearance, "Toggle tab bar", a tab's or the bar's right-click,
  `vau appearance tabBar false`) each pane's bar shows only what's on screen.
- **Tabs from your other devices**: under your own tabs, the Tabs panel lists what each of your other devices has open
  (the iPhone app, the Mac app on each machine, each browser), the latest first; a click opens it here. Each device keeps
  its own tabs; right-click a device to forget it.
- **A plugin's sheet says where it's kept**, with Open: a vault plugin's folder (shown in the file tree), or a built-in
  or community plugin's settings file once it has one.
- **Set up Vaultite**, the desktop app's first launch (again from the Vaultite menu or the palette), is one screen: a
  new vault (iCloud Drive when it's there) or a folder you have (another app's vault: none of its files change), and it
  opens; or Try the playground first (the sandbox). `vau`, the CLI, is installed without Node. Another machine's server is in
  Manage vaults: Connect to another Mac.
- **A new vault starts minimal**, notes and links with a terminal for your coding agent: Minimal's plugins (files, search,
  links, the graph, tags, a terminal, Claude Code), Gruvbox, the plugins' pages kept out of your files, and a pinned Start here note
  on what to try first. An empty one also points agents started in it at the vault's rules (a line in CLAUDE.md and
  AGENTS.md). More is a bundle or a plugin away; a vault still offered the bundles that skips them (Start with Minimal)
  starts from Minimal too.
- **Bundles**: apply a whole setup at once (Minimal, Life OS, Agents, and more behind a More… card), preview it, undo
  it, save your own and share it (`vau bundle`). One that pins nothing leaves the plugins' pages unpinned.
- Menu items that only open a page or window (Hotkeys, Bundles, Set up Vaultite, Manage vaults) lose their "…".
- **Sandbox vault**: a made-up vault dated as of today (`vau sandbox <folder>`, Help > Open sandbox vault).
- **Workspaces are desks**: each has its own tabs, panels, pinned pages, open folders and recent files.
- **Sidebars**: one file (`.vaultite/sidebars.json`) with a plain stack of panels per side, plus a right sidebar.
  Panels fit what they draw and can be dragged onto a pane as a tab. Its right-click menu lists the panels shown;
  the hidden ones and the other sidebar's are under More. Web pages' heading has + (open an address), Pinned's pins the
  file on screen.
- **A new tab is yours to arrange** (`.vaultite/newtab.json`, `vau newtab`, or right-click a blank tab): show, hide and
  reorder its sections (buttons, recent files, running terminals) and make any palette command one of its buttons.
- **Commands have icons**: in the command palette and on a new tab's buttons (a microphone for voice notes and
  recording); a command without one has its plugin's. Right-click a button for Change icon (newtab.json's `icons`).
- **Turn plugins on from the command palette**: type an off plugin's name ("workspaces") and Turn on Workspaces comes
  after the commands, with what it needs (Undo in its toast); "turn off" or "disable" and a name turns one off, saying
  what goes with it. "Turn on" alone lists every plugin that's off. Not the vault's own plugins: they run code.
- **File icons in the quick switcher too**, and File icons (Settings, or Toggle file icons in the command palette) hides
  them everywhere: the tree, tabs, search, the quick switcher and the phone's tabs. Set up Vaultite's icon is a play button.
- **Each plugin's settings open in their own sheet**; Settings keeps only the app's own, without descriptions under
  each row. Plugins are grouped by category, one name per row, with no intro text (descriptions are in each one's sheet).
  Search in Settings finds both: the app's rows, and any plugin's setting, which opens its sheet there.
- **Appearance**: Gruvbox is the default (the old colours are Classic); new Amethyst and Paper schemes; separate text
  sizes for notes and terminals; notes are narrower (700px).
- **Folders are yours**: a file's kind comes from its `type:` alone, never its folder, so moving People/ or Dashboards/
  breaks nothing. A folder brought in without types (another app's People/) stays plain notes until `vau type People
  --apply` gives each file its line; `vau type` and `vau context` list such files.
- **Archive any file**: it moves into a hidden `.archive/` folder next to it (out of other tools' way, links
  following) with `archived: true`, and is left out of lists; "Show archived files" in the file tree shows them (showing
  hidden files doesn't), else an archived file shows there only while it's the open file. Files archived before stay put until `vau archive tidy` (or the palette's "Move archived files into archive folders").

### Editor and files
- **Database views and bases show every row**, like Obsidian (no cap at 500), drawn as you scroll; a database view
  without `limit` lists every match (it was 50).
- **Nothing is cut off with no way to see the rest**: the search tab lists every file, more as you scroll, with the
  totals right; "N more in this file" shows them, and a line opens the file there, the match selected. The quick
  switcher lists more as you scroll, matches text from two letters, and ends with the search tab. Every unlinked
  mention, as you scroll. Books' Up next and Finished, an embedded spreadsheet's rows and older cloud sessions have
  Show all; embeds nest 20 deep (a loop is still caught), and HTML pages and notebook output are never clipped. Tabs
  synced between devices keep every tab and its whole name. Export to PDF waits for every image, saying how many are
  left when it's slow. A tab whose editor was put away keeps its undo history and selection.
- **Obsidian's settings as defaults**: daily notes follow `.obsidian/daily-notes.json` (folder, name format, template)
  and are found by their name, so none is made twice; the templates folder follows `templates.json`, the attachment
  folder `attachmentFolderPath`, excluded files `userIgnoreFilters`. Set one in Vaultite and it wins; `.obsidian/` is
  never written.
- **Excluded files**: a File explorer setting, one path or /regex/ per line; they stay files you open, but search, the
  graph and unlinked mentions leave them out and the quick switcher lists them last.
- **Attachment folder**: a File explorer setting (a folder, the top, beside the note, or a folder beside it).
- **Each kind's folder in its settings**: People, Notes, Logs, Daily notes, Dashboards and the rest show where new ones
  go (where most are, until you pick one), and keep to it.
- **Daily notes**: their name format and template are Today's settings; "Open today's daily note" and `vau daily` make
  one from the template.
- **Editor settings** (Settings > Editor, `.vaultite/editor.json`, as Obsidian's): spellcheck, indent with a tab
  (the default) or spaces for a note not indented yet (one that is keeps its own, as VS Code does), auto-pair brackets and Markdown (typing `*` over a selection wraps it), readable line length,
  and Properties in document (visible, hidden or source). A vault's `.obsidian/app.json` sets the ones you haven't.
- **Live preview shows only the Markdown under the cursor**: the link, bold span or embed you're in, not its whole line;
  bullets and checkboxes stay drawn while you type their line.
- **Properties while reading**: shown above the text in reading view too, and open unless you fold them.
- **⌘E switches only the tab in front**: each tab keeps its own view, as in Obsidian; a new one starts in the last you
  picked.
- **Aliases link to their file**: choosing an alias after `[[` writes `[[File|Alias]]`.
- **Editing keys over the phone's keyboard**: while you write a note, a row of undo, redo, link, task, indent, bold,
  italic, highlight, bullet list and photo sits above the keyboard, like the terminal's keys; pick them in Editing commands'
  settings.
- **Bug recorder** (a plugin, off until turned on): keeps the window's last minutes in memory (keys, clicks, scrolling
  and whether the app or you moved it, edits, files changing, commands, warnings); Report a bug saves them as a note
  with your description and a screenshot. An editor's trace names who moved its cursor when the app did.
- **Folders show every file**, as Obsidian's do, drawn as you scroll so a folder of thousands opens at once. Files per
  folder in the Files settings shows a folder's first ones, then Show N more; the open file always shows.
- **Blocks are views you edit in place**: clicking a block keeps it drawn; hover for its bar (its name, Options, its
  menu, `</>` for its Markdown, with Done and what's wrong under it). Options is a form from the block's declaration,
  and a person's context, place, to-do and contact are changed right in the card; on a dashboard too, where right-click,
  Options opens the form in place instead of the source. Right-click no longer flickers.
- **Live data's folders open**: a block's menu lists the folders its live data is read from (Claude Code's account
  folders, `~/.codex`, Cursor's), each opening in Finder.
- **Duplicates don't take the original's names**: a copy leaves out `aliases`, `name`, `id` and `ext_id`, and a file
  whose alias another file has says where [[that alias]] goes, with Remove the alias.
- **Images in notes**: drawn on their line beside its number, `|300` sets the width and their corner drags it, buttons
  open them and show their Markdown. `![](x.png)` images too.
- **Every embed has a menu**: right-click an image, audio, video, PDF, table or embedded note (hold its header on a
  phone) to copy, open, download, rename, move, copy its path, reveal, reset its size, remove the embed or delete the
  file; only what fits its kind.
- **Right-click in a note**: Add link, Format, Paragraph and Insert menus (with their keys), Cut, Copy,
  Paste, Paste as plain text, Select all, and Search for the selection; in the Mac app also Look up, Search the web and
  Add to dictionary. New commands: Toggle inline math, Clear formatting, Toggle task list, Insert footnote, Paste as
  plain text, Search for selected text. Phones keep the system's menu.
- **Renaming or moving a file or folder updates every link to it**: embeds (`![[x.png|300]]`), Markdown
  links, links in frontmatter, a moved note's own links; `vau move` does it for agents.
- `[[` and `![[` suggest any file in the vault (images, PDFs), by name with its extension.
- **Add photo**: from a note's … menu on a phone (its photos or the camera), `/photo`, Insert ▸ Photo or the palette;
  saved as an attachment and embedded, like a pasted image.
- A file dropped anywhere on a note is saved as an attachment and embedded; a file opened from outside the vault has
  Copy to vault (its tab's menu, its path bar's button, or right-click on it, an image or PDF too).
- An image, PDF or other file in its own tab has a menu on right-click: Copy image, Open in default app, Download,
  Rename, Move, Copy path, Reveal, Delete.
- Every way of making a note (⌘N, the tree, the switcher's ⇧Enter, a link, a template) puts it in one place: the top of
  the vault, unless its other app's settings say otherwise.
- **Shorter file menus**: Open in new tab, New note, Rename and Copy path do the common thing on click and keep the
  rest in a submenu (Open to the right; Canvas, Database; Change icon; from the system root, Copy link). More is last,
  before Delete.
- ⌘Z undoes a property removed, added, renamed or changed, a header chip and a command on the open note (Change icon,
  Archive, a label), in the same history as the text.
- Vim: visual block (Ctrl+V, then I, A or c) edits every line.
- Graph blocks and the Local graph get a Fit button once moved, and can be panned in the editor.
- Word, Excel, PowerPoint and e-books open read-only, and search and AIs can read their text. iPhone photos (HEIC)
  open too.
- **Bases** (`.base` files). Database views gain formulas, summaries and a map, and `this`: the note a view is
  in (the one embedding it, when embedded), so one view embedded anywhere lists what's related to that note
  (`where: "file.links contains this"`, `project = this`).
- **Canvases**: edit cards in place, snapping, copy and paste, link previews, and the board fills
  its tab.
- **Vim** (a plugin, off by default) in the editor and across the app: leader key, vimrc, link hints. Any command can
  be bound to a key sequence, with a hint of the next keys.
- Find and replace, folding, page preview on hover, an All properties panel (rename or retype a property everywhere),
  properties as chips in file headers, and a token count.
- **Property types for the whole vault** (`.vaultite/types.json`, and another app's types.json): a date,
  number, checkbox, list... picks the property's input (set it from the icon before its name), notes a value that
  isn't one, and sorts database views by it.
- Search understands operators (`path:`, `tag:`, `OR`, `-word`) and shows why each result matched.
- Audio recorder, Slides, and Export to PDF / Print. Recordings are transcribed on the Mac with Apple's on-device speech
  recognition (macOS 26), as the iPhone does: nothing to install, a language's model fetched the first time. Whisper is
  optional (the setting Transcriber). A voice note the Mac can't transcribe lands in the inbox as the recording, saying
  why, never lost.
- Add to a `## Timeline` from the app. Back returns to the page you came from, and tabs come back scrolled where you
  left them. Lists work with the keyboard.
- **Reopen closed tab** (⌘⇧T in the desktop app, the command palette on the web): the tabs you closed come back one
  by one, where they were, with their history.
- **Pinned tabs and tabs by number**: a pinned tab keeps what it shows (what's opened from it opens
  beside it) and stays open through ⌘W and Close others; ⌘1–⌘8 go to a pane's nth tab and ⌘9 to its last (desktop app).
- **Note composer, Random note, Unique note creator**: move a selection into another note (a link
  left in its place) or merge a note into another (with Undo), open a note at random, make a note named by the minute.
- **Pop-out windows**: Move current tab to new window (or Open…, or a tab's menu) puts a tab in a
  window of its own, with its history and tabs of its own and no sidebars; closing its last tab closes it. Move to main
  window (a tab's menu, the palette), or a tab or pane dragged out and let go over the main window, puts it back there.
- **Stacked tabs** (Toggle stacked tabs, a tab's or spine's menu, or the tab bar's right-click): a
  pane's tabs side by side, sliding over each other with their titles on spines.
- **Pinned headings and searches**: Pin current heading (the one the cursor is under) and Pin
  current search put them in Pinned, where a click opens the note at that heading or the search (`vau pin
  "Notes/Idea.md#Plan"`, `vau pin "search:tag:#book"`).
- **The usual editing keys**: ⌘K makes a Markdown link (the quick switcher is ⌘O), ⌘L a task and ticks it, ⌘D
  deletes the line, ⌘/ a comment, ⌘G opens the graph; commands for highlight, strikethrough, code, headings, lists,
  quotes, moving lines, and callouts, tables, code and math blocks (the Editing commands plugin), and Insert current
  date / time (Templates, in its date and time formats). The app's keys now win over the editor's, so any can be
  rebound.
- New note makes a plain `Untitled.md`. The file tree can make a new canvas, drawing, database or base. File menus
  are shorter and grouped.
- Links can run a command: `[Open Claude Code](vaultite://command/terminal:claude-split)`.
- The file tree no longer opens folders to reveal the open file; File explorer's Reveal the open file turns it back
  on. On a phone it opens the folders but leaves the drawer at its top.
- **Recent files** panel: the files you opened lately in the workspace, or the vault's recently changed ones (a
  toggle in its heading). Hidden until you show it from the sidebar's menu; also a tab. Lists 50 (a setting), then Show more.
- **Any sidebar panel can be on a new tab**: right-click a blank tab, Sections, or `vau newtab show "recent files"`.
- **Activity filters**: the panel's heading filters by who (you, agents, the CLI...) and what (changes, opens,
  commands, settings), kept per workspace; the Activity tab has the same as chips, and `vau activity --action`.
- **New tab**: every section has its title (the buttons too); drag a section by its title, or a button, to reorder.

### Speed
- The app loads less up front, redraws less and gets only what changed (`/api/state?since=`). Pages no longer jump
  while they load.
- The server listens at once, caches what it computes and compresses responses (with ETags). `npm run build` takes
  about 3 s (TypeScript 7).
- Swipe actions and quick taps (Done, Dismiss, Delete, a routine's tick, a card's rating) answer at once, with a tap
  you feel: the row slides away before the server answers, and comes back with why if it fails. A note deleted from
  any device closes its open tabs; one archived or moved (Done in the Inbox, Archive) keeps them, at its new place.

### Changed
- **The app writes only what you changed**: a save rewrites only the properties it changed, keeps a cleared one empty
  (as Obsidian does), adds `type:` only to a new file and renames a file only when its title changed; a change it can't
  apply as a small edit is a conflict, never a rewrite of the whole file. Opening or syncing the vault never writes: a
  note gets its id and dates when it's made or edited in the app.
- **Duplicate copies the file as it is**, as Obsidian does, and new names count from 1 everywhere ("Untitled 1", "Name
  1"), as in Obsidian.
- **Clipping a page again**: the web viewer's Save to vault opens the note it made before and offers Update, which
  clips the page as it is now into that note (`vau clip <url> --update`).
- **Logs keep emoji in file names, and make new areas**: a log's file is named with its title as written (only what a
  file name can't hold goes), and a log for an area that isn't in the settings yet adds it instead of being refused.
- **Photos named as in Obsidian**: a photo from the camera or a nameless pasted image is "Pasted image
  YYYYMMDDHHmmss", whatever its format.
- **A machine you remove stays removed**: a server adds itself to Machines once, and no longer comes back after you
  take it off the list.
- **Map pins stay out of your files**: a person's or your own place is looked up when you enter it or the People map
  needs it, and kept in the app's cache, never written as `coordinates`; a place that isn't found has no pin instead of
  a guess, and the map starts on the whole world, then fits the pins.
- **Nothing is cut or thrown away behind your back**:
  - AI import keeps every chat (one message is enough), every image whatever its size, and attachments, project files,
    tool results and memories whole; an attachment too long to read inline becomes a text file in Attachments/.
  - Inbox events keep their whole title and body (an event that leads nowhere opens in place); unread ones stay until
    you read or dismiss them, and only read ones go after Days to keep (the last 200).
  - Voice notes keep their recording above what was said, from the watch, the phone (with the app updated) or the app
    (Keep voice notes' audio, in the Inbox's settings). A tap under 0.7 s says "Too short, not saved".
  - Terminals never end for being left alone: a shell ends when its last tab closes at its prompt, or when you end it.
    What's pasted into one stays while it runs and 30 days after; Scrollback is one setting every backend keeps, all of
    it shown again when you come back.
  - The trash is emptied of what's been there 30 days, like Recently deleted, once a day by one machine; restore works
    until then.
  - Agent files deletes a root AGENTS.md or CLAUDE.md only when it made it for its line; yours stay, even empty.
- **Nothing personal leaves without a yes**: Cursor's usage is read from your Cursor account only once you allow it
  (asked in its plan card, kept in Cursor's settings); Activity no longer records what agents and scripts read unless
  Record reads is on, and its description says how it names who called.
- **Updates on your terms** (desktop app): Settings, Updates is Automatic (it restarts into a new version while you're
  away, with nothing unsaved), Notify (the default: ready in the background, then Restart to update) or Off. A new
  build of the page reloads by itself only when nothing would be lost; while you type or have unsaved edits, it says
  "A new version of Vaultite is ready" with Reload.
- **Web pages ask, like a browser**: a site that wants the camera, microphone, location and the like asks once (Allow,
  Don't allow, remembered for the site; signing out of it forgets); pages you left are kept rather than reloaded
  (the oldest end only when the Mac runs short of memory), and a page's notifications past six a minute wait their
  turn instead of being dropped.
- **Fewer interruptions**: the phone gets a push only for what waits on you (an agent asking, a report on work you
  sent; Inbox settings, Phone notifications); an error toasts once per kind while the server runs, the rest only
  listed in Errors; the cards reminder comes only once you've reviewed cards.
- **What agents in terminals are told**, word for word: Show what agents in terminals are told (the palette, Terminal's
  settings) or `vau terminal instructions`.
- The iPhone's share sheet takes photos and files: they go to the inbox in a note with the text shared with them,
  saved in the attachments folder.
- Desktop: ⌃⌘P opens the palette from another app only while an app window's tab shows (App windows), no longer
  whenever one is open; the menu bar lists every command, and files from outside the vault are remembered however many
  you've opened, so restored tabs keep working.
- **Links resolve as in Obsidian**: when several files share a name, the one closest to the linking file wins (not
  whichever came first), `[[Work/Idea]]` finds any …/Work/Idea, and `[[` writes the shortest path that finds the file.
  A first name alone (`[[Alice]]` for Alice Park) or a path that isn't there no longer goes somewhere silently: a click
  asks "Did you mean" (add an alias to make it a link).
- **Every link and image renders, as in Obsidian**: `[x](Note)`, `[pdf](files/a.pdf)` and links to other apps
  (`obsidian://`, `zotero://`, `tel:`, `file://`) are links on every surface and the desktop app opens them; raw HTML
  (`<br>`, `<sub>`, `<kbd>`, `<span class>`, `<img>`, `<details>`, an https `<iframe>` such as a video, sandboxed) is
  drawn, made safe; vault images show in embeds and anywhere Markdown is drawn; `![[Note]]` in the middle of a line is
  an embed. Web pages asking to open another app ask you first. A #tag clicked without the Tags plugin searches for
  it. Links in query, base and log cells go to the file closest to their row's.
- **Any folder can be a vault**: Manage vaults on the web opens folders outside the home folder and on external drives
  (only hidden and system folders are refused), and a vault asked for that isn't there (a typo, a drive not connected)
  is made only once you say so, in the desktop app and the server alike. Managing vaults on the web answers only this
  machine's owner.
- **Graph as in Obsidian**: the whole graph shows files with no links, and a local graph goes 1 link out by default (up
  to 5; the Local graph panel follows the setting).
- **Kinds and relations of your own**: a timeline takes any kind of a word or two (Other in Add: coffee, game night) and
  a person any relation (colleague); the known ones keep their icons and groups, and nothing is flagged.
- **Bases list every file Obsidian sees**: templates and archived files too, but none in a hidden folder (`.archive/`);
  a database view still hides archived files, and says how many ("3 archived hidden").
- **Archived means archived: true or yes**: another value (a date, maybe) no longer hides a file.
- **Token count flags only agent files**: CLAUDE.md, AGENTS.md, ME.md, skills and the rest keep their limits; an
  ordinary note has none unless you set one.
- **Costs say they're estimates**: Claude Code's, Codex's and Cursor's are labelled estimated at list prices, in the
  app and in what agents read.
- **Keyboard shortcuts on any window**: Settings shows them on narrow windows, iPads and phones (with a keyboard) too.
- **Built-in is the core; the rest are Vaultite plugins**: the Plugins page lists the app's essential plugins under
  Built-in and its other ones (Today, People, Logs, Projects, the format viewers...) apart as Vaultite plugins, off
  until turned on, by hand or by a bundle (Life OS, Everything; Minimal is the core). Vim is built in again, off until
  turned on, its init.vim kept.
- The app's text no longer names other apps: their vaults, settings and plugins are described as such
  (`vau other-apps`, `vau docs from-other-apps`); the plugin that runs Obsidian's plugins, and its Browse tab, still say
  Obsidian.
- **A kind's blocks are drawn, not written**: a person's profile, a log's fields (and its area's blocks, a workout's
  sets), a book's and a project's card are drawn on top of each of its files without a fence, so new files hold only
  what's theirs and a kind's view can change for every file at once. A fence of one still places it (changing its
  options or source writes one); `vau blocks tidy` takes the old ones out. Blocks are read one way everywhere (a
  ```` ~~~block-x ```` or a word after the name included, none inside another code fence).
- Done on the inbox result you're reading (its Done anywhere: the sidebar, a phone's swipe, the file menu) opens the
  next one to review in its tab, rather than closing the tab.
- The API answers only this app's own pages: another site's page, or one reaching the server under another site's name (DNS
  rebinding), is refused; a reverse proxy's own domain goes in `VAULTITE_HOSTS`.
- Plugins for one kind of life or one tool (Work, Finance, Hevy, Apple Health, Reddit, GitHub, Code stats, Excalidraw,
  Vim, Screen sharing, Tailscale, herdr) aren't part of the app anymore: install them from Vaultite's plugins
  (`vau plugin install`; Hevy's and Apple Health's imports are now `vau hevy import` and `vau apple-health import`).
  The coding agents, Health and Learning are built in, and the Plugins page has two groups, Built-in and Vault plugins.
  Dock icon is off until you turn it on.
- The lists you show or hide in a menu work one way: the sidebar's panels (Panels ▸), the pinned pages (Pinned pages ▸)
  and a new tab's sections and buttons list what's shown, ticked, and the rest under More ▸. Every row ticks or
  unticks with the menu left open, so you can add or hide several at once, and keeps its place until the menu closes
  (unticked and ticked again, it's back where it was). Two pages of one name say their folders.
- An app update never changes your pages (Today, Health...): a page with a newer version says Update available, with
  See changes, Update (the old one stays in file history) and Dismiss; `vau dashboard updates` does the same.
- Made-up names in docs and examples are generic (Alice Park, Bob Lee); a shorter README. The docs name other apps only
  where the app reads their files or formats.
- Each workspace is its own file, `.vaultite/plugins/workspaces/<n>.json`, so computers and phones on different
  workspaces never write the same file through iCloud. The old list in `data.json` is copied over by itself.
- Your own file, `ME.md`, is the Me plugin's: its setting puts it anywhere in the vault (moving it in the app updates
  the setting), and with Me off nothing asks for it. `Me.md` from before still works.
- Health, Learning and Work are community plugins. Logs has no areas of its own: they come from the plugins that are
  on.
- CSV, HTML, Vaults from other apps, Pinned, Dashboards and Terminal are now plugins you can turn off. The Plugins page
  calls the app's plugins Built-in.
- Renamed keys (the old ones are still read): a book's `added` is now `created`; a journal entry is a note tagged
  `journal`; notes' `pinned` is no longer read.
- Opening a vault never changes your files: plain Markdown notes (another app's) no longer get an `id` and dates written
  into them; only notes in Vaultite's format (`type: note`) do.
- `vau`: settings edits merge through the server; plain `vau` writes `source: cli`; `vau files` and `vau search`
  print a Markdown list; `vau terminal` replaces `ls`; `vau clip --html -` reads stdin.

### Fixed
- **An agent's ended session keeps its tab**: when Claude Code or another agent's session ends by itself (it exited,
  died, or finished after its report), its tab stays with "Session ended" and Restart, as in VS Code, instead of closing
  in every workspace. End session and closing the tab still end it for good.
- **Properties keep what you typed**: "007", "1.50" or "1e3" in a number field stays that text, not 7 or 1.5; editing a
  date and time keeps its seconds and offset; only times a kind keeps itself (a note's created and updated) show locked
  in local time, not every `created`, `updated` or `added`.
- **Timeline view only in people**: a `## Timeline` heading in a note stays the Markdown you wrote; only a person's file
  draws it as a timeline.
- **Edits survive a closed window**: what you typed, at any size, stays on the device until the server has it; a
  window closed or killed mid-save offers it back (Restore them) the next time the file opens. A big note's last save
  no longer fails as the window closes.
- **JSON saves as you type it**: a .json file (comments, a half-done edit), a notebook or a canvas source is saved as
  it is, with a note while it isn't valid JSON; a plugin's settings file that doesn't parse keeps working from its last
  good copy.
- **Paste keeps the text**: cells copied from Excel, Numbers or Word paste as their text, as in Obsidian, not as a
  picture of them; a picture alone is still attached. Also in canvases and terminals.
- **Names with odd characters**: a [[link]] or a new note named with `:`, `?` and the like makes a note named as the
  app names files (`:` a dash, the others spaces) with the name as typed as its alias, so the link finds it (no more
  "A B 1"); "/" makes folders. A rename to such a name is refused, saying which characters.
- **Approvals show all they ask**: an app's request for your yes opens whole in a scrolling box (Approve in a row or on
  the phone's notification only when it shows all of it), and a vault plugin waiting to be allowed lists every changed
  file, with the exact count.
- **Bundles keep images and fonts**: a bundle's files that aren't text are saved, applied, exported and imported as
  their bytes; one that can't be read is listed saying why instead of vanishing (up to 64 MB, any number of files); and
  applying one never lowers a number you set, like how many days File history keeps.
- **Big files open and edit at any size**: a file over 1 MB (an Excalidraw drawing with images, a long note) no longer
  opens read-only, nor one over 8 MB as a card; typing in a 16 MB note is as quick as in a short one.
- **No size limits**: File history keeps files of any size (one growing past 1 MB is no longer taken for deleted) and
  its diff is right at any size; search reads every text file whole, however many (an embedded image's base64 aside);
  books, web pages, sheets and CSVs give all their text; the graph reads links from files of any size; a PDF's page
  count at any size; uploads (the app's, `POST /api/ops/file.upload` with the file as the body, MCP upload links, a
  file pasted into a terminal) stream with no cap; a web image saved to the vault says why when it can't be.
- **More size limits gone**: a voice note for the inbox streams at any length (no base64); token counts for files over
  4 MB; an HTML page's saved state over 2 MB; clipping a page over 8 MB (it was cut short when fetched); the editor sees a
  frontmatter of any size. Excalidraw's interface font loads (it was a 404).
- **iPhone: voice notes and shares at any size**: the watch's and the phone's recordings, and files shared to Vaultite,
  go to the server as they are (streamed from disk), never as base64 in JSON.
- **Agent hooks reach a server on its own address**: with `HOST` set to one address, the inbox's and Activity's hooks
  post there instead of to 127.0.0.1, which nothing answered.
- **iPhone: never a blank screen**: a server's page that doesn't load (unreachable, or reloaded after iOS ended the page
  in the background) goes back to the first screen, saying why, with the server's buttons to try again. Also: Hermes
  messages with an image show again; File history keeps a version rewritten within a millisecond; `vau` piped into a
  reader that stops ends quietly; a rules file iCloud is still downloading is fetched instead of logged.
- **Replying keeps your place**: sending a reply from an agent's report no longer jumps it back to the top when it
  moves into the archive; a file moved or renamed while open stays scrolled where it was.
- **The desktop app recovers instead of closing**: a vault whose server crashes gets a new one on its port and its
  page reconnects; a hung page offers Wait or Reload, one that keeps crashing says so with Reload (pop-outs too);
  another machine's window retries until its server answers; an update is swapped in whole or not at all, and a
  stalled one stops; App windows' calls give up on an app that hangs; dropping files copies the rest when one fails.
- **The server stays up when one part fails**: a plugin's failed promise, socket handler or file fill, a plugin that
  can't load, a settings file that isn't an object, or a folder linked back up the vault is logged (and in Errors), not
  the server ended or its vault left unread; uploads and File history's copies are whole or not there, a request over
  256 MB is refused, a terminal client that stopped reading is dropped (it reconnects), the public MCP listener retries
  its port, and the log says when something holds the vault over 30 s.
- **A broken part fails alone**: a plugin's background work, status bar, file bar or note-top item, new-tab section,
  sheet or tab title that throws no longer stops the app; a failing command or menu item says so in a toast; settings
  of the wrong shape and malformed saved tabs fall back to defaults; a hung request can't freeze live updates; the
  crash screen offers Reload with vault plugins off.
- **⌘E keeps the cursor**: back from reading, the cursor is where it was (when it's in sight), on a dashboard too,
  whose editor is made anew; typing no longer lands at the top of the file. A new editor never starts in the hidden
  frontmatter. Each editor's changes, cursor jumps and view switches are traced in memory (`vau dev eval
  __vauTrace.editor`), without the text.
- **The server running out of memory with two machines**: machines that follow each other's inbox no longer send it
  back and forth (17 times a second, the whole list each time) until a slow socket's backlog filled the heap.
- **Linux**: restarting `vau service`'s systemd unit no longer ends every terminal and agent (the keeper and tmux get a
  scope of their own); idle shells read as idle, not "/bin/bash"; Open in its app and Show in file manager work (gio,
  FileManager1); sockets and run scripts in a private runtime folder, not the shared /tmp; the vault watcher skips .git
  and node_modules and says when inotify runs out; Activity names callers with ss; HEIC with ImageMagick 6 or vips;
  an agent's session in a folder with accents is found and linked to its terminal.
- A table drawn in a note aligns its columns as its separator row says (`:-:`, `--:`), and one inside a callout is
  drawn as a table.
- A table too wide for a phone scrolls sideways instead of breaking its words a letter per line.
- Two devices on one workspace showing different files no longer rewrite its recent files back and forth, each putting
  its own first.
- An embed of a file that arrives after the note is open (made by an agent, synced, just dropped in) draws it, instead of
  "No file ... in the vault" until the note is opened again.
- A block in a note follows a change made to the note elsewhere (a review list's count could stay as it was).
- A vault plugin's status bar item shows as soon as its code arrives, not only after the bar's choices change.
- Vault plugins' editor extensions work: their CodeMirror imports are the app's own copy, not a second one the editor
  refused.
- On iPhone, the tabs list no longer stops the app when a tab shows a Claude Code (or Codex, Cursor, OpenCode)
  session read back.
- A phone's pinned tiles keep their names on the screen: a long one wraps to two lines instead of running off the left.
- On iPhone, scroll bars are whole again: the sidebar's headings (and other sticky bars) no longer cut through them.
- Desktop app in full screen: the sidebar toggle and the tabs no longer leave room for the window buttons, which full
  screen hides (the toggle sits at the window's edge, the folded sidebar's tabs right after it).
- A terminal that exits cleanly closes its tab on every device, also one that was away (a phone's tab put back later).
- An agent's news from another machine opens its session on that machine on a phone, not an empty one here.
- The pinned pages' menu ticks follow each click (a page unpinned from it showed ticked still).
- Phones: typing in a field (a search, a rename, a note's small text) no longer zooms the whole app in and leaves it
  zoomed.
- A tab, sidebar panel, header item or sheet that fails to draw fails alone: the error shows in its place, with Try
  again and Close tab, instead of "Vaultite stopped" (whose reload opened the same tab again). A part of the app that
  didn't load while the server restarted or updated reconnects and reloads once it answers, and "Vaultite stopped"
  offers Reload with a new tab (leading with it when it stopped again right after a reload).
- Closing a terminal's tab while a script runs in it (`mo`, which is bash) keeps it running, named by its script,
  instead of ending it as a shell at its prompt.
- Dispatch runs an action's shell command only once you said yes to it on this Mac (it shows the command first), and
  the desktop app shows a vault file that would run (an app, a script) in Finder instead of opening it.
- Desktop app: an error nothing caught in the app's main process goes to Errors (a toast the first time) instead of
  Electron's "A JavaScript error occurred in the main process" box.
- `vau remember` (and MCP's `remember`) makes your file when there's none yet, instead of failing.
- The server no longer stops at start when a vault plugin's file is still in iCloud: that plugin waits until it's there.
- Desktop app: clicking the palette's backdrop near the top of the window closes it instead of grabbing the window.
- Phones: holding a block drawn in a note opens its menu in the editor too.
- Phones: the tab list's bar shows its new tab button and Inbox as it opens, and a note's read / edit toggle shows in
  the header as a tab opens, instead of only after the animation.
- A key the app adds to a header (`origin`) goes after the last value, keeping the header's blank lines.
- Desktop app: a file (a screenshot) dropped on a terminal goes to the terminal, its path typed, instead of opening in a tab.
- ⇧↩ in a terminal is a new line in Claude Code's prompt, rather than sending it.
- A blank tab's menu offers the buttons' items only on the buttons, and not once they're hidden.
- A blank tab's sections all share one text size, row height and left edge (a panel's, the buttons, recent files,
  Pinned's tiles, terminals), with even room between them; a terminal's state no longer squeezes its name. The tabs
  that show a panel (Pinned pages, Recent files, Terminals, Tags, Outline, Links) are drawn the same way, a size up on phones.
- The status bar's word, character and token counts keep their width as you type, and line numbers stay still while you
  type in a note zoomed to another text size; no stray column at the left edge on narrow windows.
- Phones: a menu's More (and other submenus) opens in place, with Back; sheets close with Done, which asks before
  discarding a form you've typed in.
- Workspaces, tabs and pins no longer vanish or fail to save for a few seconds after a change while iCloud uploads
  the settings file: the app keeps what it last read, and a save it couldn't make is retried. A file another device
  changed in iCloud is downloaded when it can't be read, instead of staying unreadable.
- Pasting a big image into a terminal no longer stops the server. `vau --url` now acts on that server's vault. Clicks
  at the top of the desktop window land where you click. A terminal fits its view again after another device used it.
  Shells shown only in another workspace keep running. Blank tabs don't stay behind. The keyboard comes back after a
  sheet or the palette. On phones the page under a palette, menu, drawer or dialog no longer scrolls, and the right
  sidebar slides in from the right after the left one was open. Deleting the
  same name twice in a second keeps both copies in the trash. A double tap on the terminal's ⌃C key keeps the
  keyboard up. Terminals survive a restart after Vaultite's folder is moved or renamed (the keeper started from the
  old folder makes way for a new one); a terminal that has to run in the server says so, since a restart ends it.
  An open page no longer stops when the app is rebuilt under it: the last days' files are kept, and a page that still
  misses one reloads into the new version.

### Plugin API 3
- `plugin.onCreateFile(fn)` gets the new file read-only, as `{ size, head(n), tail(n) }` (an upload can be any size),
  and can no longer change its bytes; `diffLines` (app and server) diffs lines fast at any size; an op with `input`
  takes bytes.
- **A plugin's icon is its manifest's `icon`**, its one source (definePlugin has no `icon`): a Lucide name, one a plugin
  adds (`claude`, `github`) or a brand's mark as an SVG file, so Browse shows each plugin as it looks once installed.
- `webPageActions` adds buttons to a web page's bar and its tab's menu; `appWindows.open(bundle, url)` opens a web
  address in an app and answers the window it's in, for a `view:app/<bundle>:<wid>` tab.
- `newTab` takes only sections by name (the old function form is gone); `parseTerminal(id)` reads which agent, account,
  session and machine a terminal id names.
- A plugin takes an error as its own by `preventDefault()` in its window listener (the app then doesn't report it), and the
  desktop app answers a page's native open, save and message dialogs while it waits (`dialogSync`).
- `schemeLink` takes links of another app's scheme clicked in the app (`zotero://…`); `takeSchemeLink(url)` offers one.
- `fileFormat(path)` draws one Markdown file a plugin's own way, decided as it opens (a hosted plugin's board or
  drawing), embeds included; `openView(…, { focus: false })` opens a view in a split without moving the focus.
- `editorMenu` adds a plugin's items to a text editor's right-click menu; `commandList` is every command, for a plugin
  keeping the app's keys first; editing commands act before `runCommandById` returns (once the editor has loaded them).
- `fileRows` lets a plugin draw into the file tree's rows (classes, attributes, a style, elements around the name), and
  `noteTop` draws under a note's properties.
- A host's `browse` offers a source on the Plugins page's Browse, its `trust` says what its plugins can do; a
  manifest's `replaces` makes opt-in plugins standing in for the same one alternatives, never both on (`standingIn`).
- **Hosted plugins** (`hostPlugins`): a plugin can run others (another app's plugins), each
  listed on the Plugins page in its host's group with its own switch, settings sheet, approval and Uninstall, and drawn like
  any plugin (commands, panels, tabs, fences, status items), redrawing what it adds as it comes. On a phone, `revealPanel`
  opens the drawer the panel is in.
- `markdownHtml` and `hydrateMarkdown` draw Markdown as the app does into a plugin's own elements, and
  `onMarkdownDrawn` hears each element Markdown was drawn into (embeds, previews, callouts and tables in the editor);
  `menuShowing` says whether the app's menu is open; an embed's `![[link]]` is marked `data-wiki-embed`.
- `formatDate` and `parseDate` (moment.js-style formats, weeks from any first day, names read back strictly or
  loosely) on both sides, `@vaultite` and core/plugins.ts: Templates, Templater and Periodic notes share them.
- `fileIcons` gives files and folders icons and colours (the tree, tabs, lists; a file's own `icon:` wins) and
  `folderMenu` adds to a folder's menu in the file tree; a note's `tint:` colours its icon without an `icon:` too.
- A vault plugin's `editor` extensions share the app's CodeMirror (`@codemirror/*`, `@lezer/highlight`), like React,
  so they work in the editor; a plugin that has them says `apiVersion: 3`.
- `usePluginSettings`, `useSheetGuard` (a form in a sheet asks before its unsaved input is lost) and the `SettingDecl`
  type from `@vaultite`.
- `check_plugins` leaves out what a plugin's `.vaultiteignore` keeps out of installs (its tests can import Node).
- A fence a plugin draws in its own language (```tasks) no longer gets "its options should be `key: value` lines" under
  it while editing.
- A vault plugin's `import()`s are chunks of their own, loaded when used (`api/plugins/<id>/<version>/<file>`), so a
  big package no longer slows every start (Excalidraw: 160 KB at start instead of 7.9 MB).
- A manifest's `replaces`: other apps' plugins it stands in for, by app.
- The Templates plugin's service `template:expand`: a plugin expands a template's text as a note is made from it or it's
  inserted (Templater's `<% %>`), and may move the note; `ui.choose` with no items and `other` asks for text.
- A vault plugin's screen-size and state variants the app doesn't have (`md:-m-1`) win over the app's plain classes on
  its own elements, as they would in the app (they were silently under them).
- A manifest's `userFiles`: files a plugin writes as the user's own (Vim's init.vim), not a new version to allow.
- A manifest's `marks`: frontmatter keys that type a file without `type:` (`{"kanban-plugin": "kanban"}`), so a plugin
  draws files another app's plugin made.
- A manifest's `disclosures.network` can say `"*"`: any host its settings name (a sync's own server).
- `plugin.every(name, null)` removes a job, for a schedule its settings set.
- A vault plugin's modules that its `index.tsx` doesn't import run on the server and may use Node, like `plugin.ts`.
- **Inline code as text**: a plugin's service `inline-code` reads inline code (Dataview's `` `= this.file.name` ``) as text
  for agents, as `fence:<lang>` does a code fence.
- File history lists versions other plugins keep of a file beside its own (the service `versions:<source>`: Git's
  commits), to compare and restore the same way.
- `fileMenu(path)`, a file's menu as its tab shows it, for a plugin's own list of files; `moveManyInto(paths, folder)`,
  a drop into a folder with one Undo.

### Plugin API 2
- An app plugin with a backend can be `offByDefault` too: the server keeps its ops, services, hooks, jobs and pages off
  until it's in plugins.json's `enabled`. `plugin.isOff()` and `vault.switchedOff()` say what's off, `enabled` counted.
- **Breaking (views)**: a view's `icon` is only an icon; one picked per tab is `iconFor(arg)`.
- **Breaking (sidebars)**: the `panels` provider is now `sidebarSetup` over `sidebars.json`'s shape. `panelSetup`,
  `savedPanelSetup`, `storedPanelSetup` and `panelsChanged` are now `sidebars`, `savedSidebars`, `vaultSidebars` and
  `sidebarsChanged`. plugins.json's old panel keys are gone (vaults are migrated once).
- `newTab` is sections by name (`{ title, sort, hidden, only, heading, render }`), arranged by newtab.json; the older
  function form still works as one section. Commands take an `icon` and a `label` for when they're buttons.
- Lists select like the app's own (`useSelectable`, `selectClick`, `rowMenu`, `useSelected` from `@vaultite`), and a
  `fileMenu` item with `many(paths)` is offered for several files at once. `SwipeRow` is exported.
- A block's ctx has `setProperty` (absent when the file can't change), and kit's `Editable` shows a value it changes in
  place.
- Manifests declare `blocks` (checked, suggested in the editor, listed for AIs), `settings` (a sheet with no React),
  `category`, `offByDefault`, `live` and `reads`; `settingsSearch` lists what a settings panel has, for Settings'
  search. Plugins add operations with `plugin.op` and call them with
  `op(id, params)`.
- Many additions (formats and fences, editor extensions, status and file-bar items, workspace and device state,
  machines, agents, `onCreate`, `onMove`, `onServerError`, `onAppError`): `web/src/api.ts` and `core/plugins.ts`. **Breaking**: `PinnedPages`, `ClaudeIcon`,
  `GitHubIcon` and the plugin types are no longer re-exported from `@vaultite` (import them from their plugin:
  `@plugins/core/<id>/types`). A vault plugin's `index.tsx` gets the app's CodeMirror (an `editor` extension works) and
  can import a package's stylesheet.
- Manifests say `version`, `author`, `repo`, `fundingUrl` and `disclosures` (checked; shown before a plugin is
  allowed); `plugin.allows` / `plugin.allow` keep this Mac's yes to a command a setting names.
- `startDrag(e, item, { touch: true })`: a finger drags it too, once held. `edgeScroller` (exported) also scrolls a
  box sideways (`"x"`).

## 0.1.0 (2026-09-29)

The first versioned release. Plugin API 1.

- **Vault as the only store**: every person, note, log, book, project, routine and page is a Markdown file; the server
  indexes them in memory, watches the folder and pushes changes to every open app over a WebSocket. Writes are small
  edits that keep comments, key order and hand-written text.
- **Plugins**: core and community plugins, and vault plugins (the user's own, in `.vaultite/plugins/`, off until
  turned on, reloaded live). Manifests can declare `apiVersion` and `minAppVersion`; plugins that need more than the
  app has aren't loaded and say why.
- **Pages**: dashboards made of blocks, pinned files in the sidebar and phone tab bar, tabs for a page's views, and
  `/api/render` to read any page as text.
- **Database views**: `block-query` as a table, cards, list, board or calendar, with inline property editing.
- **Data plugins**: People (profiles, timelines, map), Logs (areas, gym, climbing, sleep, nutrition), Notes, Books,
  Projects (GitHub stats, lines of code), Routines and daily notes, Work, Calendar (iCal), Templates.
- **Editor**: CodeMirror with reading, live preview and source modes; code highlighting, Mermaid, math, callouts,
  footnotes, a slash menu; any file type opens (code, images, PDF, media, notebooks); HTML artifacts and CSV tables.
- **Obsidian compatibility**: wikilinks, backlinks and unlinked mentions, graph view, JSON Canvas boards, Excalidraw
  drawings, Obsidian themes and CSS snippets.
- **Workspace**: tabs and splits, drag and drop, quick switcher, command palette, hotkeys, five workspaces shared across
  devices, file history with diff and restore, toasts with Undo.
- **Agents**: an `AGENTS.md` written into the vault, the `vau` CLI, terminal tabs, and Claude Code integration.
- **Apps**: web app and phone PWA served by Node, and a macOS desktop app (Electron) with one window per vault.
- A sample vault in `examples/vault/`.


## Before 0.1.0

Built in a few days before versioning: data moved from SQLite into Markdown files, the backend from Python to
TypeScript on Node, and the repo was cleared of personal data (who the user is lives in the vault's `ME.md`).
