# Changelog

What changed in Vaultite, newest first: one line per change, as it stands now (a change undone or redone before a
release is written once, as it ended up). Versions follow [semantic versioning](https://semver.org); the plugin API has
its own number (`API_VERSION` in `core/version.ts`). The details are in git history and in `vau docs`.

## Unreleased

- **Agents' tabs in sight**: the pane agents' browser tabs open in no longer shrinks a little with each tab till it's
  gone, a pane squeezed too thin comes back at an even share, and Open web page always opens a new tab.
- **No more rules ping-pong**: two machines on different versions sharing a vault no longer rewrite `.vaultite/AGENTS.md`
  back and forth; each writes it only when its own rules change.
- **Agents' tabs stay**: short of memory, the browser no longer discards a tab an agent opened or one waiting on you,
  so its number and its ask last.
- **Security pass**: a page reaching the app under another site's name (DNS rebinding) can't read plugins' pages,
  requests through Tailscale Funnel are refused, an HTML artifact can't take what it read to another site, files from
  the artifacts' CDN cache never run as pages, other sites can't frame the app, and opening a script or an app kept in
  the vault shows it in Finder instead of running it. A `vaultite://command` link (in a note or from another app) asks
  before running a command that does more than open something, and Vaultite Connect without owner tools can't turn
  plugins on or edit the agents' rules.
- **Copy the sign-in code**: the page an AI app opens to connect to your vault has a copy button beside its code, to
  paste into Connections.
- **One server per vault on a machine**: a second server for a vault this machine already serves won't start, and the
  desktop app on a Mac whose always-on service serves the vault attaches its window and browser to that server rather
  than starting its own. Agents' tabs outlast the server restarting. Other machines' agents use an always-on machine's
  browser; a laptop's app answers only its own agents.
- **Updates wait for agents**: the desktop app restarts into an update only once its browser is idle (no agent call
  under way, no page waiting on you, no agent at work in the last 10 minutes); its server's update waits only for agents
  at work, since the app's tabs and asks outlast the server restarting.
- **A server that updates itself**: `vau service install --updates main` has a service install follow a branch, taking
  each commit CI passed on (fast-forward only, a clean checkout, never while agents use the browser), building it and
  restarting when its own code changed; a failure keeps the version before and shows in `vau errors`. `vau version`
  says what runs and what the updates are doing.
- **Browser tabs from your phone**: in the web app (another Mac, a phone), Show browser tabs lists the desktop app's web
  pages, whose each is (an agent's and its task, or yours), its container, paused or waiting for you. Open one to watch it
  live and tap, type and scroll in it, stop or resume its agents, see what they did there, and say Done to what an agent
  asked (signing in, a check): the Inbox item a browser ask makes opens it.
- **Sites, tidied**: each container is a card in its colour and leads with who you're signed in as, now on Google
  (YouTube and its country sites in the same row, other Google accounts beside it), X, Reddit, GitHub, GitLab, Hacker
  News, Instagram, Facebook, LinkedIn, Cloudflare, Cursor, Apple, Perplexity and Wikipedia too, WhatsApp as its open
  page last showed, with their pictures; a site whose login cookie is there shows signed in even when it
  won't say who, and keeps the name it last gave. Each site is asked only every few hours per login, again when you
  sign in to another account. The rest fold behind "N more sites", latest visited first, and a filter finds a site or account.
  Drag a container by its name (or Move up and down in its menu) to reorder it everywhere it's listed. The address bar's container menu says who you'd be in
  each container. A page's own icon (Google Maps) no longer replaces its site's on every other tab.
- **Answered at once**: what you do shows straight away instead of after the server replies. Forgetting a device,
  signing out of a site, disconnecting an app, removing history, errors, extensions or reviewed files fold their rows
  away; switches and names change as you set them; slow actions (Restore, Start it, Keep) say they're working and take
  no second press. A machine's menu and "Choose where…" open at once. What fails comes back and says why.
- ⌘A selects only what you're in, never the whole window: a menu's filter is a real field (⌘A, ⌥⌫, paste and
  dictation work in it), a field being renamed keeps ⌘A for its text, a note in reading view selects its text, and the
  sidebars and bars select nothing.
- Vaultite Main updates again on a Mac whose shell aliases `rm` to ask first; it kept the old version, saying the new
  one didn't build.
- A companion's comments and suggestions show as cards in the note's margin by default; the Conversations panel with a
  dot by each line is the setting Comments: In the sidebar.
- An app a LaunchAgent keeps running stays under it after updating itself, so a crash still restarts it.
- Passkeys work in the browser: a site asking for one shows a QR code that your phone scans, and the phone's passkey (an
  iPhone's iCloud Keychain, an Android's) signs you in or is saved there. Bluetooth needs to be on, on both.
- **Your devices, live**: the Tabs panel marks which of your other devices are open now, and on those a tab can be
  moved here or closed there (or all of them). Browsers are named by what they are and where ("Brave on Studio", not
  "Chrome on Mac"), a device can be renamed, and automated browsers no longer show up. Devices, in Machines and the
  palette, lists every app and browser.
- Clicking a web page's field always types there: a click while a toast is over the page, or in a window that's behind,
  no longer leaves the keyboard in a note.
- Opening a web page no longer flashes white while the site answers: it shows the app's background until the site first
  draws (pages that set no colour of their own are still white).
- The view button picks any view, source mode too: right-click it, or hold it on phones. The views' menus show each
  view's icon, with the check at the row's end.

## 0.7.0 (2026-10-22)

The web viewer becomes a browser (Shields, containers, Chrome extensions, agents using it), tab groups and vertical
tabs, bundles you can pick apart, try and browse, Obsidian's Advanced Slides and reading-view plugins, and a faster app.

- Chrome extensions run in web pages: add them from the Chrome Web Store (Add to Vaultite on an extension's page, or a
  link in Extensions), a folder, or Brave and Chrome on the Mac; pinned ones' buttons are in the page's bar, every one in
  its … menu.
- Managed extensions: ones the Mac's owner names in a file from the terminal are always on in every page and container,
  with no switch or Remove in the app, like Chrome's force-installed ones (a site blocker can't be turned off on a whim;
  its blocked page and its asks for time work as in Chrome).
- Extensions that watch or change pages' requests (chrome.webRequest) work with Shields on: password managers fill
  sites' sign-in prompts (KeePassXC-Browser), and Zotero Connector sees what a page loads.
- An extension added from Brave or Chrome comes with its settings there (options, sign-in, license), and one already
  added gets them from its … menu, Settings from Brave: DeArrow's license and SponsorBlock's settings carry over.
- Web pages open in containers, as in Firefox and Brave: Personal, Work or your own, each signed in on its own, so one
  site can have several accounts side by side. The page's bar shows the tab's container and moves it to another, and a
  site can always open in one.
- A container can lock with Touch ID, like Brave's app lock: its pages stay hidden until unlocked, and lock again when
  the Mac locks, sleeps or sits idle 15 minutes (Lock containers locks them now).
- Web pages in the Mac app block ads, trackers and YouTube's video ads (Shields, with uBlock Origin's default lists): a
  page's Shields button counts what was blocked and turns them off for its site. Nothing of it loads until a web page
  opens.
- Block an element (the Shields menu, the palette, or right-click a part of the page to start on it): point at part of a page, widen or narrow the pick with ↑ and ↓,
  see it hidden before you save, and edit its selector. Rules are `youtube.com##selector` lines in the Browser's list
  (`.vaultite/plugins/web-viewer/blocked-elements.md`; a Blocked elements note moves there once) that pages follow as it
  changes; the Shields menu lists a site's rules (click one to show it again) and hides
  YouTube's Shorts, recommendations or comments in one click. Agents add rules with `vau browser block`.
- Web pages keep a history on this Mac: the address bar completes a site as you type and suggests your history,
  bookmarks and open tabs, a new web tab starts at the address, ⌘Y opens History, and Import from Brave (or Chrome)
  brings a profile's history in and its bookmarks into a Bookmarks note.
- Make Vaultite the default browser (a command): links from other apps open in a web tab.
- The Web viewer is the Browser now, and Open in the browser is Open in another browser.
- A web page's bar is calmer: its container and Shields sit inside the address, one Save button saves the page to the
  vault (plugins' ways to save, like Save video, in its menu), and Bookmark, Block an element, Open in another browser,
  extensions and plugins' other actions are in its … menu. As a pane narrows, the address gives way first.
- The Web pages panel is Sites: the sites signed in to in this workspace's logins (Default without workspaces) or a
  container's, picked on its heading, with Sign out and Clear trackers; the Browser's settings list every container's.
- Browser: each tab owns its page, so closing a tab always ends it (a slow page's sound no longer plays on with no tab),
  two tabs of one address are two pages, ⌘⇧T opens one page, and the address shows while it loads; a tab's speaker mutes
  it with a click, and the status bar names the pages playing sound.
- Browser: switching between web tabs no longer flashes see-through for a frame. A tab's container menu is only for
  choosing one (Open in, Always open here, New container, Manage containers); containers are added and changed in
  Sites (the panel's + and the picked one's options, the Sites tab with every container and its options), which also
  pins the sites each always opens. Menus mixing icons and checks put the check at the end, so no row starts indented.
- Browser: menus, the palette, popovers, tooltips and toasts draw over a live page; it no longer freezes into a picture
  or blinks as one opens, and a toast over a page lets clicks through to it.
- Browser: "Open as player" (a page's … menu, ⌥⌘P) moves a tab's page, still playing, into a window of its own, its
  video filling it full screen on its own Space, to watch or share in a call; Esc brings it back. A video's own full
  screen now fills the window, and Picture in picture floats a page's video.
- Browser, Block element: what you pick is marked in red but stays on the page until you press Block; Preview (P) hides
  it for a look. Shields' button no longer goes missing on a page opened as the app starts, and is just the shield: the count is in its menu.
- A web page playing sound shows a speaker on its tab; Mute tab is in its menu and its bar.
- A web tab playing a video keeps its speaker, and the status bar its "playing", through quiet scenes, till the video
  pauses; the speaker sits beside the site's icon instead of replacing it. A background video in a quiet scene is no
  longer let go when memory runs short.
- Browser site styles: a site's own CSS (`.vaultite/plugins/web-viewer/sites/youtube.com.css`) in the vault's look, its
  colours and fonts as `--vault-*` variables that follow light, dark and the colour scheme; it applies as you save, wins
  over the site's own without !important, and the Shields menu turns it off or opens it beside the page ("Style this
  site…"). Agents write one with `vau browser style`.
- Tint the active tab (Settings > Appearance, off by default): a web page's tab takes its container's colour, lightly.
  The container's line under the address is straight.
- Agents use the desktop app's browser as you would (`vau browser open`, `snapshot`, `act`, `read`):
  their tab opens beside yours, the bar says what they're doing with Pause, and Show what agents did in the
  browser replays each run step by step. Each container says whether agents can't use it, read it, or act in it;
  only the new Agents container lets them act until you say otherwise.
- Browser agents over MCP: `browser_open`, `browser_snapshot`, `browser_act` and the rest are MCP tools, and a server
  without the desktop app (the always-on one) passes them to a Mac whose app has the vault open, or says none has.
  Agents' tabs are grouped as <agent>/<task> and marked theirs, they close their own, upload vault files, hear where a
  download went, search a page (`--find`), get a picture of a background tab, run an expression in a world of its own,
  and ask you to sign in with a Done in the tab's bar (and the Inbox). A tab an agent moved on in the background no
  longer goes back to its first page when shown.
- Agents in the browser: `act` answers what changed on the page once it settles (`--diff`) and fills a whole form at
  once (`--fields`), refs last while their element does, `browser run` does a whole flow in one call (a script in a
  sandbox, 30 s), and `browser pdf` saves a page into the vault. "Show agents in the browser" shows the tabs agents work
  in now, live, with Show tab and Pause, then past runs searched by agent, task or the summary given on open.
- Agents never take your focus: a terminal an agent opens, resumes or dispatches goes in a tab behind yours, with a
  quiet toast ("Claude Code started a session") and Show. `vau terminal open claude --prompt "..."` starts it on its task.
- Agents' lines: what agents write in a note is marked theirs by line, kept beside the note (never in its text) and
  found again as you edit: a thin bar in the writer's colour by each line, hover (or a held finger's menu) for who,
  model, effort and when; a line you edit after an agent shows as both. Provenance's setting Agents' lines: a bar,
  tinted (the text stays washed in their colour), or off. `vau blame <note>` lists them, and the day's recap counts
  lines by agent. The companion is told an ask's whole paragraph and the three above it, uncut.
- Agents' tabs show their state: the agent's logo stays, with a dot on its corner breathing while it works, yellow when
  it waits on you, blue when its Inbox row has an answer to read, red if it failed, on the tab bar, the
  Tabs panel, the phone's tabs and Terminals, which lists the ones that need you first, in bold (the status bar counts
  the same). Closing an agent's tab leaves it running there; End session ends it (asking only while it works), and a
  session dispatched from a note opens beside that note's tab, in its tab group.
- Ask an agent in the background: a small box (the palette's look) takes a question, and Enter starts it in a new
  Claude Code session with no tab, where the workspace's new sessions go (the agent, account and machine are picked
  under the field, remembered per workspace); a toast says what was asked, with Open. `vau terminal ask` does the same.
- Terminals read OSC 7501 (program status): Claude Code says itself when it's working, waiting on you (for a permission,
  an answer or a login, and why) or done, instead of hooks and screen reading, and so does Codex from 0.163 (its turn's
  answer reaching the Inbox under its session's name); agents that don't speak it (older Codex, or any agent in tmux)
  keep those, and Codex's permission prompts show as waiting with Approve and Deny.
- Inbox: each agent session is one row, there only when it needs you (it asks, wants an approval, or its turn ended
  with a question or an answer to read, judged from its last message by a small fast model), bold until you open it;
  its sheet shows the answer drawn and a reply that goes back into the session. A turn done with nothing for you goes in
  quietly, and only what needs you toasts and notifies (rate limited). No more "Claude Code finished" per turn. A
  session you end yourself (End session) leaves its row read.
- Agents: a question an agent asks before it's ready (Claude Code's "Do you trust this folder?" on a first run) waits on
  you like a permission: its terminal shows waiting, the Inbox and phone have Approve and Deny, and its first prompt
  runs once you approve. The Inbox has Approve and Deny for any agent's permission, which stays unread until answered,
  and a companion's cursor shows its question right there with them.
- Terminal: `vau terminal run <file>` (terminal.run) hands a note to a coding agent or a shell command, here or on
  another machine, reporting to the inbox: what Dispatch's buttons and scheduled notes now start agents with.
- Cloud sessions: Claude Code on the web's sessions have a sidebar panel of their own, out of Terminals. Every claude.ai
  account the Browser is signed in to shows (each workspace's logins, each container, each organization), under its
  name, any of them hidden from the panel's eye; a session opens in the logins it belongs to. Asked once before
  anything is read. Start a new one with +, or send a note as a new session's prompt. Working and waiting sessions show
  as such again (claude.ai's list had stopped saying).
- Another machine's sessions reach this app again after a laptop sleeps or changes network, and their permissions are
  approved, denied and replied to from here, the phone (Reply on the notification) and the watch; only the machine the
  session runs on sends the phone's push.
- Tab groups, as in a browser: right-click tabs for Add tab to new group, and a group is a coloured chip before its tabs
  (in the Tabs panel, the same pill with a line down its tabs; a section on a phone) that folds to its name; drag the
  chip to move the whole group, and rename, recolour, ungroup or close it from its menu. Agents group tabs with
  `vau tabs group`. Dragging tabs, the others make way and the tab shows where it lands, the group's line under it if
  it joins: held over a group's last tab it joins its end, just past it it leaves in place, and dropped on a folded
  group it goes in, the group staying folded.
- Vertical tabs in one switch: Show tabs in the sidebar (the palette, or right-click the tab bar) puts the Tabs panel at
  the top of the left sidebar and hides the tab bar; Show tabs on top puts them back.
- Every list you reorder by dragging makes way as the tabs do, instead of showing a line: pinned pages (list and
  tiles), sidebar panels, the Sidebars sheet, a blank tab's sections and buttons, the status bar and its tray, and the
  header's items. Something dragged in from elsewhere opens a gap where it would land; a pin dragged out to unpin
  leaves the rest closed up.
- Reordering Pinned and Tabs: dropping just under the last row puts it at the end (Pinned no longer unpins it), and
  dropping a pinned page over its own place leaves it there instead of sending it to the bottom.
- With the tab bar off, nothing shows above a pane unless Pane titles is on (now off by default); a note's bar or the
  Browser's address bar is then the window's title row, beside the sidebar's, making room for the toggles and the Mac's
  traffic lights instead of an empty band above it; its empty part drags the window and has the tab bar's menu.
- Mac app: with the tab bar and pane titles off, the sidebar toggles beside a folded sidebar can be clicked again.
- Tabs panel: right-click its heading (or a device) to hide other devices' tabs and list only this device's; Tabs
  settings have it too.
- Status bar: every item can be hidden, moved and tucked under More, the file's too (view, word and character counts,
  Vim's mode, chips, origin, tokens): right-click the bar, or "Show in status bar" / "Hide from status bar" and "Show
  all status bar items" in the palette. With nothing shown, the bar is a faint corner whose right-click brings them
  back; saved setups keep the file's items they showed.
- Status bar: what doesn't fit goes (characters, then items to the tray, then words), never onto a second line; last
  launch's widths hold only while the app loads, so no empty room is left where a longer song title was.
- Status bar: after the window or a sidebar is resized it no longer reaches under the left sidebar or keeps empty room
  at its end (it held the width it had at the last launch).
- Mac app: the traffic lights come in once a hidden sidebar has slid in, not a frame at a time from their default place,
  and stay hidden with it after full screen, a focus change or a new window.
- Mac: a sidebar without its rail (Zen) slides in carrying the window's traffic lights and its toggle, set in its top
  row as beside the pinned sidebar, instead of the lights hanging over its corner; the lights sit centred on that row
  in either density.
- Zen: the page dims softly behind a sidebar slid in, the file bar fades while you type, Files waits folded, and
  "Show in the file tree" (a breadcrumb, Reveal) slides the hidden sidebar in instead of pinning it open. A hidden
  sidebar slides in from its edge over a browser tab or an embedded page (a PDF, an app's card) too.
- Settings: the sidebars' switches (rails, dimming, scrolling, dividers) are in Appearance, Sidebars, above the panels.
- Applying a bundle with the app open draws it as a reload would: the status bar no longer keeps the last setup's width.
- Setup: one page for Bundles and Plugins, as its two tabs, behind a Setup button beside Settings at the sidebar's foot
  (Your setup atop Settings goes there too); Open Setup, Open Plugins and Choose a bundle… open it from the palette.
- Bundles: Standard after Zen (or any of the app's bundles after another) is that bundle's setup again: each says every
  part of the look and every setting any of them sets, instead of leaving Zen's tab bar, rails and tiles behind.
- Bundles: a saved bundle says the whole look and the settings the app's bundles set, so applying it after any other
  gives back the setup it was saved from.
- Bundles: each change in a bundle's preview has a tick: untick some to apply or try it without them, or save it as
  "<Name> (mine)" (`vau bundle apply --skip`, `vau bundle fork`); restore still puts the rest back.
- Bundles: Try one from its preview: a bar at the foot of every window says Trying <Name>, with Keep and Revert, until
  you pick one, even after a restart (`vau bundle apply --trial`, `vau bundle keep`).
- Bundles: the bundle in use says In use · modified on its card once your setup changes (hover for what differs); its
  preview offers Save changes (over yours, or as "<Name> (mine)" for the app's) and Revert.
- Bundles: Browse, on the Bundles tab, lists bundles shared on GitHub (the topic vaultite-bundle, or listed in
  Vaultite/plugins), searchable, saying which you have and which has an update; each is pinned at a commit, and
  importing one gets exactly that commit (`vau bundle browse`).
- The Agents bundle is back as a community bundle in the directory: coding agents in terminals beside your pages, their
  sessions and limits, a feed of what they did, your machines and the server.
- Bundles: updating one you have (Check for updates… on its card, or Update available in Browse) says what's new
  (files, plugins re-pinned) and replaces yours only when you say so; it's never applied.
- Bundles: plugins a bundle installs are pinned to the commit and files recorded when it was saved (the app's too): a
  moved tag can't change what's installed, and files that differ are refused, nothing installed.
- Bundles: a bundle can bring a guide, a note on how its setup works, opened after applying it; Life OS and Zen have
  one.
- Bundles: the app's own bundles show a real picture of the app they make, in light or dark as the app is.
- Bundles: a bundle that installs plugins says so with a small mark on its card's title row (hover it for which), so
  every card is one height.
- Bundles: the tab is laid out as Plugins is: Your bundles (built in, then yours) and Get bundles (the directory, with
  Import… for one it doesn't list), with the search beside them; with none of yours yet, one empty state offers Save
  current setup and Import…, and after yours a tile saves another.
- Bundles carry the editor's settings (editor.json): Zen hides notes' properties, and the others show them again.
- Slides present Obsidian Advanced Slides decks: `note:` speaker notes come off the slide and show beside it (S, or
  the notes button), `--` vertical slides, fragments (`<!-- element class="fragment" -->`, `+` lists) stepped through,
  slide backgrounds (`<!-- slide bg="..." -->`, with text in a tone that reads on them), and the deck's `<style>` kept to
  the presentation; the frontmatter's separators, `bg`, `theme` and `showNotes` count.
- Reading view runs plugins over a note's blocks (`reading` in the plugin API): Obsidian plugins' Markdown
  post-processors now reach a note being read, so Simple Embeds turns a YouTube link into a player there, Banners draws
  its banner and Supercharged Links marks links; blocks no plugin changed draw as before.
- Renaming or moving a note updates Markdown links that name it alone (`[a](Note.md)`, Obsidian's shortest path), not
  only relative ones and wikilinks.
- An Obsidian vault keeps its look: its base theme (light, dark or system), its theme from `.obsidian/themes/`, the CSS
  snippets it has on from `.obsidian/snippets/` and its fonts apply until you set them in Vaultite. Nothing is written
  to `.obsidian/`.
- Vault plugins load in a vault that is also a code project (a `package.json` saying `"type": "commonjs"` at its top).
- Notes: click a note's icon beside its title to change it, or the icon of a row you're renaming in the file tree.
- Archive: folders can be archived whole, from their menu or `vau archive <folder>`, into `.archive/` in the folder
  above; Archive now sits right above Delete in file and folder menus.
- Faster everywhere: the server no longer walks the whole vault before each of the app's requests while nothing
  changed on disk, and a save, or a note an agent edits, re-reads only that file (on a 3,000-file vault, 6 to 20 times
  less work per request, and an edit on disk 0.1 ms instead of 64).
- Lighter over the network: an open app asks the server about 6 times less (a change on disk no longer has every window
  read every setting and live card again), the phone back from sleep reads only what changed meanwhile, its first load
  comes a quarter smaller, and agents' hooks and `vau` commands answer without waiting on the vault.
- Big vaults (tens of thousands of notes): the first load no longer reads every note again for token counts, a rename
  reads only the notes that link to it, and each request's sync no longer asks every file its kind. Typing and opening
  notes stay fast with a folder of thousands of files open in the file tree (it draws only the rows in sight, and a save
  no longer redraws it), and the first search no longer reads every JSON file first: plain `.json` data is left out of
  search, as in Obsidian (canvases, drawings, tables and code are still searched).
- Browser: switching to a web tab shows its page about three times sooner (25 ms instead of 80), a new tab's page
  loads in a renderer started ahead, as Chrome does (a third sooner), the app no longer spends a steady few percent of
  CPU checking whether a menu or toast covers the page, and each request costs Shields less.
- Terminals: a burst of output (a long listing, a busy agent) reaches the screen 5-10x sooner in a few large pieces
  instead of thousands of tiny ones, the terminal list (`vau terminal`, the Terminals panel) answers without starting
  tmux or `ps` again when it just did, and typing no longer lays out the page on every key.
- An open window that sits idle costs less: a settled graph no longer redraws every frame (its GPU and page work drop to
  nearly nothing), a hidden window stops the server checking every terminal every 2 s, and the app no longer re-lists
  its commands for the menu bar or re-places comment cards every second and a half while nothing needs them.
- The command palette opens drawing a page of rows, more as you scroll: about a quarter of the work it did on a
  vault with many plugins (every command's row).
- Typing in a long note (over 32 KB) no longer counts its words and tokens on every key: the status bar updates
  them when typing pauses.
- Vault plugins' code is kept by the browser: a reload no longer waits for every plugin's bundle again (about half
  a second on a vault with twenty of them).
- Claude Code's usage is counted with less than half the work: right after the server starts (a deploy, the desktop app
  opening) it no longer stalls the app while it reads weeks of transcripts.
- `vau profile` samples the running server's CPU for some seconds (no restart) and lists where its time went; the
  profile is kept for Chrome's DevTools.
- Plugins: a plugin's row tapped just after installing it opens its own sheet once its code has loaded, not the
  directory's sheet with Install.
- Start @name's model and effort chooser stays open while the note changes from outside away from it (an agent's
  edit, the file changed on disk); typing on or moving off it still closes it.
- Mac app: Settings, Permissions shows what macOS lets Vaultite do (the vault folder for the app and its terminals,
  microphone, accessibility, screen recording, folders...), whether the app's signature keeps them across updates, and
  a way to allow each; `vau permissions` tells agents the same. A terminal macOS keeps from the vault says so.
- Plugins: a `webPageActions` item with `kind: "save"` goes in a web page's Save menu, any other in its … menu.
- Connecting Claude or another AI app from Safari works: its sign-in page went on waiting after you typed the code.
- Connections: an AI app let in by its code that's slow to finish says where it waits (its sign-in page not gone back
  yet, or the app not finishing), and one that never connects stays a while saying why, instead of a shimmer that
  vanishes; the server's log and Errors note it too.
- Phones: holding something for its menu (a tab, a recent file, a property, a block in a note) no longer selects its
  text or what's around it.
- Vault plugins: one whose files are put back as they were (its broken edit undone) starts again at once, instead of
  saying it couldn't start until the page was reloaded.

## 0.6.3 (2026-10-20)

A quieter first run with the Zen bundle, and steadier editing and Review.

- The Zen bundle replaces Agents: sidebars without rails that slide in from the window's edge, no tab bar, panes
  floating on the window. New in Appearance: Sidebar rails, and Pane titles for a tab bar that's off.
- Pinned pages can show as tiles: a grid of their icons at the top of the sidebar, named on hover (Pinned settings >
  Show pinned pages as).
- New plugin Glance (Navigation, off until turned on): ⌥-click a link, a file in the sidebar or a search result to see
  it in a wide sheet over the page, live and editable, then Open in tab, Open to the side, or close it.
- Phones: a page pulled down offers New note, Open a file (straight down) and Close tab; choose its three commands in
  Settings > Appearance on the phone.
- An agent that isn't installed (Claude Code, Codex...) says so in a toast instead of the companion staying on
  starting; its terminal's tip says not installed.
- New vaults: Start here tries the companion first (@claude in the note), and the Buttons panel is in the left sidebar.
- Applying Standard sets up what a new vault has: it no longer adds the pages of plugins already on (Activity, People,
  Agents...); a bundle writes the pages of the plugins it turns on.
- Bundles: the card of the bundle your setup matches says In use (a new vault's Standard), in place of the last one
  applied.
- Settings and Get plugins are quieter: fewer explanation lines under rows, and each plugin in Get plugins is one line
  of description, its version and date beside its name.
- Inbox: a result marked done is first under Done, and the agent's event about it is read and opens it in the archive.
- In the desktop app, a web page in a pane the status bar reaches over stays live: it stops above the bar instead of
  freezing as a picture of itself.
- Typing in a note no longer redraws the status bar's items: a keystroke draws less than half of what it did.
- Back to a page lands exactly where it was scrolled: its blocks come back at the height they had, not rounded up, so
  the page no longer settles a few pixels as they load.
- Switching to editing puts the cursor on a line still wholly in sight once the page settles, so the first key no
  longer scrolls to a line that ended up half hidden.
- A file written through the API just as something else changed is still told to open windows and plugins: Review
  no longer misses an AI's edit made right after another change.
- A file saved just before another write is no longer put down to that write in Activity, so Review still has the
  text from just before an AI's change instead of saying no earlier version is kept.

## 0.6.2 (2026-10-20)

Apple Health in the iPhone app, and Health starting again in the Mac app.

- Health and other plugins built on Logs start in the Mac app again (it ships no .tsx, which its check wanted).
- Right-click the Properties header to show every note's properties, hide them or show them as text while editing;
  the palette has the same, so hidden properties come back from anywhere. Settings calls the third choice As text.
- The iPhone app reads Apple Health for a plugin that asks (Apple Health's Settings page): its whole history once, then
  what's new as the Watch syncs, in the background, with the Activity rings (`phoneHealth` in the plugin API).

## 0.6.1 (2026-10-20)

A first run that feels finished: the Mac app installs like one, errors say what happened in plain words, and the palette and font picker open faster.

- The command palette, the quick switcher and the font picker open sooner and keep up with the pointer and the arrow
  keys: the font picker no longer loads every font before it shows.
- The app built from source (`npm run app:build`, `app:install`) is Vaultite Main, an app of its own: a release
  installs beside it instead of over it.
- The Mac app's icon has the shape and margin of a Mac app's, and its disk image opens to a laid-out window (Vaultite,
  an arrow, Applications) named just Vaultite.
- Opened from its disk image, the Mac app offers to move itself to Applications, then reopens from there and ejects the
  disk image.
- Set up Vaultite says less: New vault and Open folder without a line under them, and Start with example notes.
- The plugin directory ends with its list, without a note under it (installing one still says it runs code).
- In the plugins list, "needs" shows only when what a plugin needs is off, as small as its byline.
- Companion is on by default: its session starts only when you first @ it or ask it something.
- A new vault's example notes are Start here, How this vault works (a tour of what a note holds) and the Claude page,
  not every plugin's page.
- A vault plugin using the app's CodeMirror starts in a new vault: Obsidian plugins no longer fail with "Class
  extends value undefined".
- Errors say what failed in plain words, never a program's text: a plugin that can't start says so with Turn off, and
  the exact error waits behind Details (Copy details, the Errors page).

## 0.6.0 (2026-10-19)

Conflicts show in place, menus filter as you type, sidebars are yours to arrange, and vaults in iCloud Drive stay readable.

- What you type is kept on the device a moment after you stop, not only as it saves: a window closed right after
  typing, with the server out of reach, offers those edits back the next time instead of losing them.
- Review leaves out the dates the app keeps in a note (its `updated`, moved by any edit): an AI's change shows and
  counts only its own lines.
- A vault plugin that changed after you allowed it says it's paused, once, in the inbox as waiting on you, naming the
  jobs that won't run until you allow it again; `vau schedule list` shows them as paused.
- The Agents bundle turns on Muse, and the web demo shows its page with sample data.
- **Menus filter as you type**: type while any menu is open and only the matching rows stay, those in its submenus
  too (Panels ▸ More ▸ a panel), the best one ready for Enter; a long list (More) says so at the top. The Panels menu
  shows each panel's icon beside its check.
- **Customize sidebars**: a sheet with both sidebars side by side and the hidden panels below, to drag panels between
  them or move one from its menu, with a filter and Restore defaults. Open it from Panels ▸ Customize sidebars…,
  Settings > Appearance > Sidebars, or the palette.
- **Today's note in the sidebar**: a Daily note panel (the sidebar's right-click menu, Panels) edits the day's note in
  place beside whatever is open, as a scratchpad; its heading steps to other days and back to today, and a day without
  a note is started from the template only when you ask. With the sidebar folded, its icon in the rail opens it
  beside the rail to type in at once. It also opens as a tab, to keep in a split.
- **A day's plan on a dashboard**: ```` ```block-day ```` draws a daily note, or one section of it (`section: Plan`), to
  check off and edit in place; it steps to tomorrow and back, opens the note, and starts a missing one from the
  template. "Open tomorrow's daily note" joins today's in the palette.
- **Vaults in iCloud Drive stay readable**: a note or setting iCloud moved to the cloud to save space (Optimize Mac
  Storage), or that another device just changed, is brought down and read instead of showing as missing or empty, and
  the server keeps the vault folder downloaded on its Mac (Finder's Keep Downloaded, which turns it off again). The
  server no longer stalls at start on a file iCloud is slow to give while it updates the vault's notes.
- A dashboard card of a ```tasks, ```dataview or ```base fence goes full width or under the one before without its
  query being erased: it's written after the fence's language (```tasks wide), and bases' `wide: true` moves there once.
- **Note dates**: a note made in the app, by you or an agent, gets `created` and `updated` in its properties (your local
  time, shown as dates), and `updated` moves when its text is edited in the app, in the same save. Notes you already
  have are left as they are; the property names are its settings, and it can be turned off.
- **Conflicts shown in place**: when a note changes elsewhere in the lines you're typing, both versions appear right
  there, named ("Claude Code edited line 6 while you typed"), each with Keep, plus Keep both; the rest merges, both
  sides are kept in File history, and each choice can be undone. A save whose answer was lost (a phone going to sleep)
  no longer conflicts with itself, and starting a companion on a note no longer reads as an AI changing it.
- **Pick a model before starting @name**: the Start @name row's chip (Sonnet · medium) opens its model and effort
  choices with a tap or click, on a phone too, now up to extra high and max; the row itself still starts at once. A
  stopped agent's Start runs it as it ran before.
- A companion whose session was stopped or ended no longer leaves its cursor behind, following you from note to note:
  it goes until its session runs again.
- A file's header row stays one tidy row on phones: Review is a short chip (who changed it in its tip), the folder
  keeps its name and nothing runs off the edge.
- **Times in your local time**: notes' and inbox items' `created` and `updated` are written in your time, not UTC
  (existing ones are converted once), so an evening's item no longer reads as tomorrow.
- **Approvals wait for you**: an app's request for your yes stays in the Inbox until you answer, however long, and
  survives a restart.
- `vau plugins check` names a schedule's op parameter it doesn't take, instead of the job failing when it's due.
- Report screenshots are named for their day and report, so two agents' `after.png` no longer collide.
- A person's profile card stays first when a timeline or a fact is added to a profile that had only the card.
- **Move the mini player**: drag it to any corner of the window, like picture in picture; it stays there, keeps clear
  of the right sidebar and the pane's back and forward, and its video no longer shows controls it can't use.
- Electron 44.9 and patch updates.
- **Links to archived files keep working**: a link to a file's old place (a recap, a report written before it was
  archived) still opens it, and the file's next move rewrites it; recaps link files where they are now.
- Fixes: a save both sides made alike no longer stalls unsaved; a plugin's page no longer crashes while it updates;
  a menu filter with no match keeps taking keys; an iCloud copy of a daily note that can't merge no longer blocks the
  day; undoing a Keep no longer drops what you typed since.
- Moving or archiving a drawing (`.excalidraw`) or any file with a long extension no longer doubles it.
- **One copy name**: imported attachments and trashed files that share a name get " 1", " 2"..., as new files do.
- **Sample folders** (Settings > Files): folders of examples, not your data. Their notes are no one's people, books or
  logs, and tasks, Dataview and database views made outside them leave them out.
- **No more duplicate daily notes**: a day's note iCloud is still bringing from another Mac isn't made a second time,
  and iCloud's copy of one ("2026-10-08 2") with nothing of its own merges into it and is archived when it's opened.
- **Companion cursor menu**: right-click an agent's cursor (or … in its box) to show its session, switch the mode,
  start a fresh session or stop it. A session that ends, however it ends, takes its cursor with it.
- **Faster diagrams**: Mermaid diagrams are drawn by Pele, a fraction of the download and time; they follow light,
  dark and the colour scheme as they change, fit narrow panes and zoom when they don't fit.
- **Birthdays** in People: a person's `birthday` (YYYY-MM-DD, or MM-DD) shows on their profile with their age, and the
  `people-birthdays` block lists the next ones, red under a week away and orange under a month.
- **Closing tabs one after another**, as browsers do: tabs closed with the mouse keep their width, so the next
  tab's X comes under the pointer; they fill the bar again once the pointer leaves it.
- **More default hotkeys**, as Google Docs and Finder have them: ⌘⇧X strikethrough, ⌘⇧H highlight, ⌘⇧C code, ⌘⌥1–6
  headings (⌘⌥0 none), ⌘⇧7 / 8 / 9 numbered, bullet and task lists, ⌘⇧V paste as plain text, ⌥↑ / ⌥↓ move a line;
  ⌘[ / ⌘] back and forward, ⌘⌥W close other tabs, ⌘, Settings (in the browser too), ⌘⇧D today's daily note, `?` the
  hotkeys; on a file tree row F2 renames, ⌘D duplicates and ⌘⌫ deletes; on a canvas ⇧1 / ⇧2 / ⇧0 fit, fit the
  selection and 100% (rebindable now). A note's keys (⌘D, ⌘B...) no longer change it while the keyboard is elsewhere.
- Agents' faces overlap as in a shared doc and fit the Conversations panel, the rest behind +N.
- Plugins' commands find `node` and `vau` when the server runs under launchd.
- Plugins installed by an older version no longer read as edited when an update is offered.
- A single plugin waiting for your yes gets its own Review button on Plugins.
- Applying a bundle turns off the CSS snippets another bundle brought (Life OS's serif titles); your own stay on.

## 0.5.0 (2026-10-17)

A companion agent writes beside you, AI apps draw the vault as cards, and the app is simpler to set up.

- **Companion**: an always-on Claude Code or Codex agent with its own cursor in your notes and drawings; write `@claude`
  in any line and it answers (starting if it isn't running), comments, suggests changes or types with you.
- **The vault in claude.ai and ChatGPT**: their chats draw live cards for notes, tasks and boards, and Claude's
  artifacts and ChatGPT's Intelligent UI saved to the vault run as they did there.
- **Review AI changes**: what AI apps and agents changed, file by file, with Keep and Revert.
- **Simpler to set up**: most of the app is always on, Settings works like System Settings, three bundles you can share
  as a link, and Vaultite's own plugins (Books, Today, Health, Muse, the coding agents...) install from its directory.
- **Editing as in Obsidian**: tables cell by cell, Bases that save what you change, coloured highlights, graph filters
  and shortcodes.
- **Watch and listen anywhere**: a player that keeps going across the app and your devices, a Queue, Podcasts, and
  offline media on the iPhone.

### Changes

- **Companion** (a new plugin, off until turned on): an always-on Claude Code or Codex session with its own cursor.
  `@claude` anywhere in a line (or ⌘⇧K) asks it, sent at Enter or when you pause; it answers in a bubble, comments on a
  line, suggests changes you take with Tab, or types with you (modes: quiet, notice, pair). Its comments and
  suggestions are threads in the Conversations panel (margin cards instead is a setting), kept beside the note so they
  survive a restart and reach your other devices. Its edits are its own in Activity, Review and version history, and a
  long session hands over to a fresh one with a summary and its open threads.
- ==Highlights== and %%comments%% run over a paragraph's soft line breaks, as Obsidian's do; a mark on a selection over
  several blocks wraps each block. A companion's cursor for a file scrolled out of the file list stays at the list's edge.
- More companions join by name (`vau companion start --as Ada`, or Start @name in the @ picker, with a model and
  effort), each in its own colour; `@ada` asks only that one. Hover a cursor for what it's doing, click it for its last
  words, drag it onto text to say "look at this"; a note's top bar shows who's here. In an Excalidraw drawing each is a
  collaborator that draws with you (`vau companion draw`). `vau companion timings` shows how fast each answered.
- **MCP Apps**: claude.ai and ChatGPT draw cards for the vault's tools: a note read shows the note with Open in
  Vaultite, a task list ticks in place, a Kanban board moves its cards. The same cards draw in a note with a
  `block-mcp-app`.
- **Artifacts and live answers**: artifacts made in Claude run as saved `.html` files (their saved data, asking Claude,
  saving themselves and downloads work as on claude.ai); ChatGPT's Intelligent UI saved to a note is a ```genui fence
  drawn live with the app's controls, its script sandboxed and the values you pick kept in the note.
- **Review AI changes**: what AI apps and coding agents changed that you haven't looked at, file by file like a pull
  request, with Keep and Revert (both undoable); a count in the status bar and "Claude changed this · Review" in a
  changed file's header lead there.
- Connections lists each AI app once, and a connected one opens its own page: what it read and changed lately, read
  only or read and write (enforced by the server), its name and Disconnect. "Another app" sets up any MCP client.
- **Agent blocks are one set**: `agent-limits`, `agent-sessions`, `agent-usage`, `agent-projects`, `agent-models` and
  `agent-project` take `agent:` in place of each agent's own copies (`claude-usage`, `codex-sessions`...).
- Machines browse an agent machine's files, cloud agents' too through a read-only file agent (enrollment codes,
  revocable access): Markdown with its properties, JSON as a tree, transcripts as a conversation.
- Activity keeps the calls an agent, the CLI or a script got wrong, and why (`vau activity --action failed`), and says
  what a plugin's operation did (`did`); `vau` names the command a stray word belongs to (`vau errors 3f9a` → `vau
  errors show 3f9a`).

- **Fewer plugins to manage**: 41 of the app's parts (files, search, the graph, the inbox, slides, canvas, terminal and
  more) are always on and no longer listed; the coding agents are one row, Coding agents, with a switch for each;
  Activity, Token count and Workspaces are off until turned on (a vault that had them on keeps them), as are random
  note, unique note and note composer; Vim is Settings, Editor, Vim keys.
- **Moved to Vaultite's plugins**: Books, Today, Health, Learning, Projects, Lessons, Podcasts, App windows, Dock icon,
  Page tabs, Muse, Dispatch and the coding agents but Claude Code and Codex (Cursor, Grok Bot, OpenCode, OpenClaw,
  Hermes). A vault that had one on installs it once with its settings, asking once to allow them; Life OS and Agents
  install theirs. New there: Muse's dashboard (its runs, what it learned, its dreams and feed), and Grok Bot apart from
  Cursor.
- **Daily notes are their own plugin**, on from the start as in Obsidian (`vau daily`, the op `daily-note.open`, was
  `today.daily`); Today keeps routines, ticked in the daily notes (`routine.check`; `POST /api/checks` is gone).
- **Plugins page**: one Filter menu (status, source, category, with counts and chips), plugins that are on first, and a
  search that also lists the directory's plugins you don't have. Get plugins has the same menu (sorted by Top, New or
  Updated), its rows open a sheet with the plugin's readme and Install, and Vaultite's own carry a verified mark.
  Installing turns a plugin on (one not Vaultite's asks first); a vault plugin's sheet has Uninstall. Plugin updates
  moved to Settings > General.
- An update that says it does more beyond the vault waits for you to allow it; another machine runs an update only from
  the source it allowed. Who may reach your terminal and MCP is this Mac's, set only by its owner, and a plugin whose
  required plugin is off is off too.
- **Settings works like System Settings**: a list of sections beside the page (a sheet on a phone), the search atop the
  list and its results in its place, Your setup heading it; Plugins and AI apps are sections like the others.
- **Every on/off setting is a switch everywhere**, named as Settings names it: the palette (Enter flips it), menus and
  the menu bar with a check, Settings' search. What isn't a setting says what it does (Show / Hide left sidebar, Pin /
  Unpin tab); "Turn on" is only for plugins.
- **Three bundles**: Standard, Life OS and Agents, on a Bundles page of its own (Your setup, "Choose a bundle…"). Share
  one as a file, a prompt for an agent or a link (`vaultite.com/b/<owner>/<name>` runs it live in the web demo, and Open
  in Vaultite opens it in the Mac and iPhone apps). Import shows what it would change first and takes JSON, a file or a
  GitHub repository. Bundles carry the new tab and the plugins you installed, and can bring their own fonts: Life OS
  titles its notes and pages in Instrument Serif (a CSS snippet sets `--font-heading` and loads a font beside it).
- **Plugin API 4**: a plugin offers modules to plugins that require it (manifest `exports`, imported as
  `@plugins/<id>/<module>`, was `@plugins/core/<id>/...`); coding agent plugins get `@vaultite/core/agents.ts`; a vault
  plugin may join a Plugins page group (`group`), keep settings files of its own (`<name>.json`), say it works only in
  the desktop app (`desktopApp`) and write under a page's title in `/api/render` (`page-head`).
- Quitting the app stops what vault plugins run first, and the first start after an update no longer bundles every
  vault plugin again.

- **Plugins' pages are your files**: turning a plugin on writes its pages once into your pages folder (Dashboards/ by
  default), pinned, and never touches them again; the read-only copies in `.vaultite/pages` are gone (`vau dashboard
  restore` writes back one you deleted). The Design page is `vau docs design`.
- **The file is the page**: no subtitles (`vau dashboard new` drops `--subtitle`) and no kind above the title; a
  dashboard's title is a note's, editable, with the file's `icon` before it. People and People map, Activity, Days and
  Performance, Agents and each agent's page are pages of their own.
- **A kind's blocks are written**: a new person, project, book or log gets its blocks' fences atop its file, and only
  what a file has a fence of is drawn. Links find a file by its name and `aliases`, no longer by `title:` or `name:`.
  `vau migrate --apply` updates older files; `vau blocks tidy` is gone.
- **A dashboard edits as it reads**: ⌘E keeps its grid, with the text between blocks typed in place. Each card's bar
  drags it, sets its width, edits its options or removes it; Add a block puts one in. A dashboard of only text reads in
  a note's column, and a block's Edit source shows its Markdown where the block was.
- **Tables edited cell by cell**, as in Obsidian: Tab, Enter and the arrows move between cells; grips select, sort,
  move and delete a row or column; cells copy to and paste from a spreadsheet. Tables are a ruled grid everywhere.
- **Bases save what you change**, as Obsidian does: sort, rename, summarize, hide, move and resize columns, and the
  Sort, Filter and Properties menus, written to the `.base` or the fence. Database views are only Obsidian's now
  (```` ```base ```` fences, `.base` files); `block-query` is gone.
- **Graph view settings, as Obsidian's**: a search that filters the graph (`type:person`, `tag:#work`, also in search),
  tags and attachments as dots, colour groups, links coloured by property, arrows, and sliders for sizes and forces.
- **Shortcodes** (a new plugin, on from the start): type `:` and a name for an emoji or one of the app's icons
  (`:fire:`, or `:LiCalendar:` as Obsidian's Iconize writes them).
- Highlights take Obsidian's six colours (`==🟢text==`), picked after `==`, from a swatch or Format ▸ Highlight.
- ```chart fences draw bar, line, area, pie and scatter charts, and code outside the editor is coloured like the
  editor's.
- Checkboxes tick in callouts, `<details>`, embeds and dashboards, and are rounded squares. Find (⌘F, Vim's /) lights
  matches in tables, callouts and folded details and works on dashboards. A callout you're editing shows its `[!type]`
  as typed, and Clear formatting takes out the marks live preview hides.

- **Pin anything**: web pages (with their icon and title), plugin pages, folders (opening in place), images, PDFs and
  Claude Code conversations (resumed once ended); `vau pin <address>`.
- A file's menu is the same wherever it's right-clicked or held (a tab, an embed, a canvas card, a recent file), with
  plugins' items in each; a tab's menu is shorter, its file's actions in a submenu. Sidebar rows and panel headings have
  a … for their menu, and a row's menu shows only that row's actions. A file's top bar items drag along the bar or into
  a sidebar.
- The palette, the quick switcher and the pickers find words in any order, and Enter right after typing takes the first
  match.
- **Themes reach everything**: Change colour scheme previews the whole app as you move; terminals, the graph, maps,
  diagrams, HTML pages and Claude Code follow it. A new tab can show a dashboard of your own (`vau newtab page`).
- The file tree reveals the open file (off in Settings, Files). The status bar stops short of the left sidebar, with a
  tray its items drag into. Toasts stay at 3 lines (4 on phones), and rows' buttons line up down a list.
- Loading shimmers only once it takes a moment, lists draw skeleton rows, and the sidebars and status bar hold still
  while the app loads. Notes start loading when the pointer rests on a link, and typing is lighter. `vau perf` shows
  what you waited for, part by part.
- **Quick Look for Markdown** in Finder, even with the app closed. Vaultite can be the default Markdown app, and
  `vaultite://command/<id>` and `vaultite://open/<path>` run a command or open a file from Shortcuts, Raycast or a link.
- **Pinch to resize text** is a setting, off by default (Settings > Appearance).
- **Watch and listen anywhere**: audio and video keep playing as you move around, in a mini player and on the lock
  screen, and pick up where you stopped on any device, with skips, speed, captions, picture in picture and a transcript
  that follows along. **Queue** gathers what the inbox holds to watch, listen to and read; **Podcasts** puts each new
  episode in the inbox. On the iPhone, media downloads to play offline and e-books turn pages on a tap.
- On the watch, a voice note says Got it at once, can pause or be discarded and stops on silence; one handed to an agent
  says "Sent to Claude".
- The web demo builds Vaultite's own plugins in, imports bundles from GitHub, shows the Agents bundle's made-up
  sessions, and loads with an ad blocker on.

- Terminals: links open in the Web viewer (⌘-click: the browser); exiting the shell left after an agent closes its tab;
  `vau terminal send` arrives whole, without a stray `201~`; on a Mac the keeper lets go of ended shells'
  pseudo-terminals (a keeper running for days used them all up), and ending a terminal ends an agent sitting on the
  hangup.
- Vim on Linux and Windows: in normal mode the app's Ctrl shortcuts (palette, quick switcher, reading) win over Vim's,
  as in Obsidian; Vim keeps its own (Ctrl+W, D, U, F, B, V, R, A, X).
- Fixes: swiping through slides on a touch screen no longer takes the browser back a page; web pages in a pop-out window
  stay there; a tooltip over a web page shows above it; Errors and Activity keep updating after you come back; an edit
  in a JSON view stays on its field; allowed Activity writes the recaps it was refused.

## 0.4.0 (2026-10-10)

Every AI app connects, from a new vault's first minute.

- **Connections from the start**: a new vault offers Claude, ChatGPT, Muse and Grok Bot; Grok Bot connects too.
- **Plugins update on their own**, and Claude's plan limits are read live.
- **Fixes from a new user's first hour**: suggestions land after the link, recent files are yours, terminals run the
  app's own vau, and the playground has one name.

- **Recent files are yours**: a blank tab's Recently changed and Recently opened, the quick switcher and Open Recent
  leave out the plugins' built-in pages (Agents, Errors, a bundle's dashboards); a copy of one in your vault still shows.
- **The playground, by one name**: the vault menu, the Help menu and the made-up vault itself call it the playground,
  and Manage vaults offers it too.
- **Terminals run the app's own vau**: it comes first on PATH once your shell's startup files have run, so another
  vau installed elsewhere (Homebrew's, an older one) no longer runs instead.
- **Suggestions land after the link**: picking a `[[link`, `![[embed`, `[[Note#heading` or slash menu item with Enter,
  Tab or a click puts the cursor after it (past the `]]`, so typing on no longer goes inside the link), and Escape
  closes the list for good while you keep typing there (Ctrl-Space brings it back).
- **A new vault has Connections**: Minimal keeps the MCP plugin on, so Settings > Setup and a blank tab offer Claude,
  ChatGPT, Muse and Grok Bot from the start (nothing is on the internet until you sign in to Vaultite Cloud).
- **Grok Bot connects**: desktop apps sign in through their own localhost address, and a connection takes the name of
  the app whose sheet you typed its code in (Grok Bot signs in as Cursor).

- **Claude's plan limits, asked live**: each account's are asked of Claude Code as /usage does (every two minutes, or
  now with the refresh button), no open session needed; a status line no longer shows one account's limits as another's.
- **Plugins update on their own**: Vaultite's installed plugins update by themselves every hour (Plugins page: Vaultite's,
  all or none; each plugin's page can say otherwise), one notification says what's new, and every machine that allowed a
  plugin runs the new version once it matches its source. Each plugin's page lists its updates with what each brought,
  and can roll back the last one; the day's recap lists them too (`vau plugin history`, `vau plugin rollback`).

## 0.3.0 (2026-10-10)

Your AI apps up front, and your Mac's Vaultite from anywhere.

- **Connections**: Claude, ChatGPT, Muse and Grok Bot on one page, from Settings or a blank tab, each set up in one sheet.
- **From anywhere**: the phone and any browser reach your Mac's Vaultite at your vaultite.app address while it's on.
- **Plugins**: their pages built in, a yes before they write on their own, and installs from a zip.

- **Connections leads with your AI apps**: Claude, ChatGPT, Muse and Grok Bot as cards that say whether each is
  connected, each opening its steps in a sheet (signing in to Vaultite Cloud first when there's no address yet), with
  the account and addresses last. It's first in Settings > Setup and on a blank tab until an app is connected; what an
  app writes is named as it signed in.
- **Open your Mac's Vaultite from anywhere**: signed in to Vaultite Cloud, the phone and any browser reach the whole app
  at `https://<handle>.vaultite.app` while the Mac is on, after signing in with the Vaultite account; terminals and
  coding agents stay off there unless turned on in Connections.
- **Every sidebar panel opens in a tab**: Buttons now has a tab (drag its heading onto a pane, or Open in a tab), and
  `npm run check` flags a plugin's panel that has none (a warning for vault plugins).
- **Terminal rows have a menu**: right-click (or hold) a session in the Terminals panel or tab to copy its agent's
  session ID or its terminal ID, open the agent's conversation, or end it; `vau terminal list` shows the session ID too.
- **A plugin from a zip**: `vau plugin install "https://…/x.zip#sha256=<hex>"` installs a plugin downloaded from an
  https address, checked against its hash, for plugins that aren't in a repository.
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
  has its name on its icon ("Studio"); "detached" is in its tooltip, not on its row. The tooltip shows in the open
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
