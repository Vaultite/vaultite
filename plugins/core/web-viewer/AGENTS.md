## Web viewer
Web pages in a tab of the desktop app, next to your notes (a viewer, not a browser). A tab
`view:web/<address>` shows that page (`vau open "view:web/https://example.com"`); its bar has back, forward, reload,
the address (an address or words to search for), "Open in the browser" and "Save to vault", which clips the page as
it's shown (the Web clipper's `POST /api/clip` with its HTML, so a page you're logged in to works too) into
`Clippings/`. Right-click an image in a page: Save image to vault (into the attachments folder, like a pasted one),
Download image, Copy image, Copy image address. Commands: "Open web page…", "Clip current web page", "Open web pages in a tab". Pages keep their own
logins, apart from the app's, on the Mac running the desktop app; nothing about them is kept in the vault.
- Logins: each workspace's pages have their own (a different account per workspace for the same site; workspace 1 keeps
  the ones pages shared before), or with `logins: shared` every page shares one.
- The Web pages panel (in the sidebar's Panels menu): the pages open in this workspace's logins and the sites you
  opened in them, with the account for Claude and ChatGPT (Sign out clears a site's cookies and storage), then one line
  for trackers (cookies other sites' pages left), which clears them.
- Notifications: a page's notifications become Inbox events (source: the site, kind `web`, linking to its tab), so
  they're toasts and the Mac's notifications too; `notifications: false` drops them.
- Claude Code on the web: with claude.ai signed in in a workspace's logins, the desktop app reads its sessions every
  15 seconds (claude.ai's own list, with those logins: no claude.ai tab needed). The Terminals panel lists them under
  Cloud, and one finishing or waiting for the user is an Inbox event: "Claude Code finished" (kind `done`) or "Claude
  Code needs you" (`waiting`), `session` its address. On the web and phones links open in the
browser, and a web tab says so with a link out.
- Links: web links clicked in the app (in notes, blocks, sheets) open in a new web tab; ⌘-click (Ctrl elsewhere)
  opens them in the system browser.
- Its settings (below): `openLinks: browser` sends every link to the browser.
