## Browser
A web browser in tabs of the desktop app, next to your notes. A tab `view:web/<address>` shows
that page (`vau open "view:web/https://example.com"`); its bar has back, forward, reload, the address (an address or
words to search for), "Open in another browser" and "Save to vault", which clips the page as it's shown (the Web clipper's
`POST /api/clip` with its HTML, so a page you're logged in to works too) into `Clippings/`. Right-click an image in a
page: Save image to vault (into the attachments folder, like a pasted one), Download image, Copy image, Copy image
address. Commands: "Open web page…", "Clip current web page", "Open web pages in a tab". Pages keep their own logins,
apart from the app's, on the Mac running the desktop app; nothing about them is kept in the vault.
- Containers: a tab can open in a container (Personal, Work, or ones you add), each with logins of its own, so one site
  has several accounts side by side. `view:web/@<container id>/<address>` opens one in a container; the page's bar
  shows it (its colour, under the tab's icon too) and its menu moves the tab, always opens its site there, and adds,
  renames, recolours or deletes containers (deleting clears its logins). They're the plugin's `containers` setting:
  `[{ "id": "work", "name": "Work", "color": "orange", "sites": ["linear.app"] }]` (colours: blue, orange, green, red,
  purple, pink, yellow, teal, indigo, gray; `sites`: a page of one opened in no container opens there). What's opened
  from a page in a container opens in it too. `"lock": true` makes a container need Touch ID: its pages don't open or
  show until unlocked in its tab, and lock again when the Mac locks, sleeps or is idle 15 minutes ("Lock containers").
- Logins: each workspace's pages have their own (a different account per workspace for the same site; workspace 1 keeps
  the ones pages shared before), or with `logins: shared` every page shares one.
- The Web pages panel (in the sidebar's Panels menu): the pages open in this workspace's logins and the sites you
  opened in them, with the account for Claude and ChatGPT (Sign out clears a site's cookies and storage), then one line
  for trackers (cookies other sites' pages left), which clears them.
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
- Agents (the desktop app's server only: `vau` in its terminals): `vau browser tabs` lists the tabs and what agents
  may do in each; `vau browser open <url>` opens one for you beside the user's, in the Agents container (signed in to
  what the user signed in to there), answering its number. Then `vau browser snapshot <tab>` (the page as an
  accessibility tree, its controls with refs like e12), `vau browser act <tab> <action> <ref>` (click, dblclick, hover,
  fill/type with `--value`, press with `--key`, check, uncheck, select an option by its text, scroll), `vau browser go
  <tab> <url|back|forward|reload>`, `vau browser read <tab>` (its text), `vau browser wait <tab> --text ...` and
  `vau browser screenshot <tab>` (a PNG's path). Take a new snapshot after the page changes: refs are only good for
  the one they came from. A container's `agents` setting says what agents may do in its pages (`read`, or `act`; unset:
  nothing, as in tabs in no container); the user can pause agents in a tab. Pages' scripts never run for agents.
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
  procedural ones work too) in a note, `Blocked elements.md` (`type: blocked-elements`; one moved keeps working): a
  `## <site>` heading per site and a `` - `rule` `` line per rule, words after it a note to yourself. Pages show a change
  to the note at once, with no reload; they apply with Shields down too (they're the user's, not the lists'). "Block an
  element…" (the Shields menu, or "Block an element on this page") picks one in the page: the element under the pointer
  is outlined, a click picks it, Wider and Narrower (↑ ↓) walk to its parent and back, what the selector matches is
  hidden as a preview and its selector can be edited; Block adds the rule (Esc cancels). The Shields menu lists the
  site's rules ("Hidden on <site>": one clicked is shown again, with Undo) and its ready-made ones, off until chosen
  (setting `hide`: `youtube-shorts`, `youtube-recommendations`, `youtube-comments`). Agents: `vau browser block
  "<site>##<selector>"` (or a selector with `--site`), `vau browser unblock <rule>`, `vau browser blocked [site]`;
  prefer selectors that last (a custom element's name, an id, a semantic attribute), never a generated class. Not
  Focus's: what a managed extension blocks isn't here, and nothing here gets around it.
- Extensions (Chrome's, on the Mac running the desktop app; installed per Mac, never in the vault, since each is code
  run on every site): "Extensions" (a command, or the puzzle button in a page's bar) lists them with a switch each,
  Options, Pin to the bar and Remove, and adds one from a Chrome Web Store link or id, from a folder or `.crx` file, or
  from another browser on the Mac (Brave, Chrome, Edge, Arc, Vivaldi: from the Web Store when it still has it, else
  that browser's copy, as for Manifest V2 ones the store dropped). On a Web Store extension's page the bar offers "Add
  to Vaultite". Pinned ones show their button in every page's bar (badge and all); a click opens its popup under it.
  Web Store ones update about daily. An extension's settings and data are per logins (each workspace's, each
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
