## Browser
A web browser in tabs of the desktop app, next to your notes. A tab `view:web/<address>` shows
that page (`vau open "view:web/https://example.com"`); its bar has back, forward, reload, the address (an address or
words to search for; the tab's container at its left, Shields at its right), pinned extensions, Save and a … menu. Save
clips the page as it's shown (the Web clipper's `POST /api/clip` with its HTML, so a page you're logged in to works
too) into `Clippings/`; its menu has plugins' other ways to save (Save video). The … menu: Bookmark, Block an element,
Open in another browser, Open as player, Picture in picture, plugins' other actions and Extensions. Right-click an image in a
page: Save image to vault (into the attachments folder, like a pasted one), Download image, Copy image, Copy image
address. Commands: "Open web page…", "Clip current web page", "Open web pages in a tab". Pages keep their own logins,
apart from the app's, on the Mac running the desktop app; nothing about them is kept in the vault.
- Containers: a tab can open in a container (Personal, Work, or ones you add), each with logins of its own, so one site
  has several accounts side by side. `view:web/@<container id>/<address>` opens one in a container; the page's bar
  shows it (its colour, under the tab's icon too) and its menu moves the tab, always opens its site there or adds a
  container. Containers are managed in Sites (Manage containers…): add one, and a container's options (rename, colour,
  Touch ID, agent access, delete: deleting clears its logins) on its heading's … or right-click. They're the plugin's `containers` setting:
  `[{ "id": "work", "name": "Work", "color": "orange", "sites": ["linear.app"] }]` (colours: blue, orange, green, red,
  purple, pink, yellow, teal, indigo, gray; `sites`: a page of one opened in no container opens there). What's opened
  from a page in a container opens in it too. `"lock": true` makes a container need Touch ID: its pages don't open or
  show until unlocked in its tab, and lock again when the Mac locks, sleeps or is idle 15 minutes ("Lock containers").
- Tabs: each is its own page, as in any browser (two tabs of one address are two pages): one in the background keeps
  its page, closing it ends it, and ⌘⇧T opens it again afresh at its address. When the Mac runs short of memory,
  background tabs' pages may be let go (never one playing sound) and load again when shown. A tab playing sound shows
  a speaker beside its site's icon: a click on it mutes or unmutes the tab, and while a page plays the status bar's "Web
  pages playing" names it, its menu showing its tab or muting it. Playing lasts from a page's first sound till its media
  pauses or ends, through quiet scenes; sound without media (a game) ends after 10 seconds of silence.
- Full screen: a page's own (a video's button) fills the window, which goes full screen, as in Chrome; Esc brings it back.
- Players, to watch a page or share it in a call (Discord's window picker finds "Vaultite player"): "Open as player" (the
  … menu, "Open current web page as player", ⌥⌘P) moves the tab's page, playing on and not loaded again, into a window
  of its own with no app around it, full screen on a Space of its own (`playerFullScreen: false`: a window), its main
  video's player full screen in it (the site's controls and captions with it; a video in an embedded player of another
  site, that player; no video, the page itself). It plays on while the window is hidden, in the background or on another
  Space, and isn't let go when memory runs short. Esc, closing the window (⌘W) or the tab's Bring back return it to its
  tab, still playing; its tab says where it is meanwhile, and closing the tab closes the player. Agents: `vau browser
  player <tab>` (`--window`, `--off`), any tab. Picture in picture (the … menu) floats the page's video over every
  window instead.
- Logins: each workspace's pages have their own (a different account per workspace for the same site; workspace 1 keeps
  the ones pages shared before), or with `logins: shared` every page shares one.
- The Sites panel (in the sidebar's Panels menu): the sites opened in this workspace's logins ("Default" without
  workspaces) or a container's, picked on its heading's right (+ adds a container). Who's signed in leads: the account
  (and its picture) for Google (YouTube and google.<country> in the same row, and any other Google accounts signed in
  beside it), X, Reddit, GitHub, Hacker News (ycombinator.com), Claude and ChatGPT; a site whose login cookie is there is
  signed in even when it won't say who ("Signed in", or the name it last gave) (Sign out clears a site's cookies and storage), with a container's always-open sites; the
  rest, latest visited first, and one line for trackers (cookies other sites' pages left, which it clears) fold behind
  "N more sites" when there are more than a few. The Sites tab ("Show sites and logins") has every set of logins, each
  container a card in its colour with its options (dragged by its name to reorder containers everywhere), and a filter by site or account. The address bar's container menu names who's signed in
  to the page's site in each container. The Browser's settings have the same for every set of logins, under Sites and logins.
- Icons: a site's is its home page's or its /favicon.ico; a page with one of its own under a path (Maps on google.com)
  has it on its tab without changing its site's.
- Notifications: a page's notifications become Inbox events (source: the site, kind `web`, linking to its tab), so
  they're toasts and the Mac's notifications too; `notifications: false` drops them.
- Claude Code on the web: with claude.ai signed in in a workspace's logins, the desktop app reads its sessions every 5
  seconds while one is working or waiting, else every 15 (claude.ai's own list, with those logins: no claude.ai tab
  needed). The Terminals panel lists them under Cloud, and one finishing or waiting for the user is an Inbox event:
  "Claude Code finished" (kind `done`) or "Claude Code needs you" (`waiting`), `session` its address.
- On the web and phones links open in the browser, and a web tab says so with a link out.
- Pinned: Pin in a page's tab menu (or `vau pin <address>`) pins it to the sidebar by its address, with its site's icon
  and its title, kept up to date while it's open; a click opens it here. While the plugin is off it doesn't show.
- Links: web links clicked in the app (in notes, blocks, sheets, terminals) open in a new web tab; ⌘-click (Ctrl
  elsewhere) opens them in the system browser, as does every link with `openLinks: browser`.
- Agents: the browser ops are `vau browser ...` and MCP tools (`browser_open`, `browser_tabs`, `browser_snapshot`,
  `browser_act`, `browser_run`, `browser_navigate`, `browser_read`, `browser_wait`, `browser_screenshot`, `browser_pdf`,
  `browser_evaluate`, `browser_ask_user`, `browser_close`). The browser is the desktop app's: a server without one (the always-on one, which
  the phone and apps on the internet reach) passes each call to a machine in Machines whose desktop app has this vault
  open (its tab numbers, its Downloads), and says so when none has. `vau browser tabs` lists the tabs, whose each is
  (yours, another agent's, the user's) and what agents may do in it; `vau browser open <url> --task "<task>"` opens one
  for you beside the user's, in the Agents container (signed in to what the user signed in to there), in a tab group of
  yours, `<you>/<task>` ("Claude Code/flight search"; `--summary` says what for), answering its number; `vau browser close <tab>` closes one an
  agent opened (never the user's). Then `vau browser snapshot <tab>` (the page as an accessibility tree, its controls
  with refs like e12), `vau browser act <tab> <action> <ref>` (click, dblclick, hover, fill/type with `--value`, press
  with `--key`, check, uncheck, select an option by its text, upload `--files` from the vault into a file input, scroll;
  fill `--fields` fills a whole form; once the page settles it answers what changed on it, `--diff` summary, none or a
  number of lines, and what the step downloaded), `vau browser run <tab> '<script>'` (snapshot, act, fill, read, wait
  and go composed in one call, in a sandbox, 30 s at most), `vau browser pdf <tab>` (the page as a PDF in the vault), `vau browser go <tab> <url|back|forward|reload>`, `vau browser read
  <tab>` (its text; `--find` only the lines with some words), `vau browser wait <tab>` (`--text`, `--url`,
  `--download`, `--helped`) and `vau browser screenshot <tab>` (a PNG's path; a background tab too; MCP gives the
  picture). An element keeps its ref while it's on the page; a new page gives new ones. A container's
  `agents` setting says what agents may do in its pages (`read`, or `act`; unset: nothing, as in tabs in no container);
  the user can pause agents in a tab. Pages' scripts never run for agents, nor see what agents do:
  `vau browser evaluate <tab> "<expression>"` (Act only) runs in a world of its own, which sees the DOM, not the page's
  scripts. A site asking for a passkey shows a QR code in the tab for the user's phone. Where only the user can go on (a
  sign-in, a passkey, a captcha), `vau browser ask <tab> "<what to do>"` brings the tab to the front with that and a
  Done button in its bar, and tells their Inbox (their phone too); `vau browser wait <tab>
  --helped` waits for Done. "Show agents in the browser": the tabs agents are at work in now, each a live picture with
  Show tab and Pause, then past runs searched by agent, task or summary; each agent's steps are kept on the Mac for 14
  days, with pictures, to replay (never what's typed into a password field).
- History: every page's visits (address, title, time, logins, typed or a link) are kept on the Mac running the desktop
  app, never in the vault, ranked by frecency. The address bar completes a site inline as you type and lists the search,
  open tabs ("Switch to tab"), bookmarks and history (⇧⌦ removes a history row); "Open web page…" is a new web tab with
  its address ready, the sites visited most under it. The History tab ("Show history", ⌘Y on a Mac): by day, searched,
  rows removed (Undo), and "Clear browsing history…" for a time range.
- Bookmarks are a note, `Bookmarks.md` (`type: bookmarks`; one moved keeps working): a heading per folder (`## Reading`,
  `### Later` under it) and a `- [title](url)` line per bookmark, which the address bar suggests. Add with
  `vau bookmark <url> --title ... --folder "Reading/Later"` (bookmarks.add, `links` for many) or ⌘D on a page; edit the
  note by hand like any other.
- "Import from Brave…" / "Import from Chrome…" (on the Mac whose browser it is): a profile's history into the Mac's
  history, its bookmarks into `Bookmarks.md` under their folders; nothing twice when imported again, never passwords or
  cookies.
- Shields (setting `shields`, on by default): ads, trackers, malware sites and YouTube's video ads are blocked in every
  page, with uBlock Origin's default lists (uBlock filters, privacy, badware, quick fixes, unbreak, EasyList,
  EasyPrivacy, Peter Lowe's), updated daily on the Mac. A page's Shields button shows how many requests were blocked on
  it; its menu turns Shields for <site> off (the page reloads), kept in `shieldsDown`: sites like `example.com`, their
  subdomains too.
- Blocked elements: parts of pages the user hid, as hiding rules (`youtube.com##ytd-reel-shelf-renderer`: a site, `##`
  and a CSS selector, uBlock Origin's and Brave's syntax; no site: every site; `:has-text()` and uBlock's other
  procedural ones work too) in the Browser's list, `.vaultite/plugins/web-viewer/blocked-elements.md` (the app's, not a
  note): a `## <site>` heading per site and a `` - `rule` `` line per rule, words after it a note to yourself. Pages show a change
  to the list at once, with no reload; they apply with Shields down too (they're the user's, not the lists'). "Block an
  element…" (the Shields menu, or "Block an element on this page") picks one in the page: the element under the pointer
  is outlined, a click picks it, Wider and Narrower (↑ ↓) walk to its parent and back, what the selector matches is
  hidden as a preview and its selector can be edited; Block adds the rule (Esc cancels). The Shields menu lists the
  site's rules ("Hidden on <site>": one clicked is shown again, with Undo) and its ready-made ones, off until chosen
  (setting `hide`: `youtube-shorts`, `youtube-recommendations`, `youtube-comments`). Agents: `vau browser block
  "<site>##<selector>"` (or a selector with `--site`), `vau browser unblock <rule>`, `vau browser blocked [site]`;
  prefer selectors that last (a custom element's name, an id, a semantic attribute), never a generated class. Not
  Focus's: what a managed extension blocks isn't here, and nothing here gets around it.
- Site styles: a site's own CSS, `.vaultite/plugins/web-viewer/sites/<site>.css` (youtube.com.css: its subdomains too),
  added to its pages before they paint and again as it's saved, no reload. Each declaration wins over the site's own (the
  app makes them !important, in a layer), so none needs !important. The vault's look is there as variables, following
  light, dark, the colour scheme and fonts: `--vault-background`, `--vault-foreground`, `--vault-card`, `--vault-popover`,
  `--vault-muted`, `--vault-muted-foreground`, `--vault-primary`, `--vault-accent`, `--vault-border` and the app's other
  colours, `--vault-font-ui`, `--vault-font-text`, `--vault-font-code`, `--vault-radius`, `--vault-color-scheme` (light
  or dark). Use them, not colours of your own, so a site follows the vault; on a site with its own colour tokens (YouTube's),
  map those rather than restyling each part. The Shields menu has "Style for <site>" (off: setting `unstyled`) and "Edit
  its style…" ("Style this site…" for one without: its file from a template, opened beside the page); the palette's "Edit
  this site's style" too. Agents: `vau browser style [site]` (`--css`, `--remove`).
- Extensions (Chrome's, on the Mac running the desktop app; installed per Mac, never in the vault, since each is code
  run on every site): "Extensions" (a command, or a page's … menu) lists them with a switch each,
  Options, Pin to the bar and Remove, and adds one from a Chrome Web Store link or id, from a folder or `.crx` file, or
  from another browser on the Mac (Brave, Chrome, Edge, Arc, Vivaldi: from the Web Store when it still has it, else
  that browser's copy, as for Manifest V2 ones the store dropped), with its settings from that browser's profile
  (chrome.storage: its options, sign-in, license), so it starts as it is there; an installed one that another browser
  also has gets "Settings from Brave" in its … menu, which replaces its settings here with that profile's. On a Web Store extension's page the bar offers "Add
  to Vaultite". Pinned ones show their button in every page's bar (badge and all; a narrow pane leaves them to the …
  menu's Extensions); a click opens its popup under it. Web Store ones update about daily. An extension's settings and data are per logins (each workspace's, each
  container's), as in Chrome's profiles. Not there: their items in the page's right-click menu, their keyboard
  shortcuts, identity sign-in, side panels. `chrome.webRequest` works beside Shields (what Shields blocks, extensions
  don't see).
- Managed extensions, as Chrome's force-installed ones: what this Mac forces on, named only in a file its owner writes
  in the terminal, `{ "extensions": ["<an unpacked extension's folder>", "<a Web Store id>"] }`: the Mac's
  `/Library/Application Support/Vaultite/managed-extensions.json` (every Vaultite app; made with sudo, so changing it
  takes sudo) or `managed-extensions.json` in one app's userData. They're on in every page, workspace and container
  (Agents too), shown as Managed by this Mac with no switch or Remove; a change to the file applies within seconds, a
  folder is copied again when its files change (at launch, Look for updates, daily), and one taken out of the file
  stays as an ordinary extension. It's the owner's alone: agents never write it or work around what it blocks.
