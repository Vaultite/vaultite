## Browser
Web pages in tabs of the desktop app. Their logins, history, extensions and steps live on the Mac running it, never in
the vault. On the web and phones a web tab links out instead.

- Tabs: `view:web/<address>` (`vau open "view:web/https://example.com"`), `view:web/@<container id>/<address>` in a
  container (`vau open <address> --container Personal`, by name). Two tabs of one address are two pages. Tab numbers
  are never reused, a restart included. `vau pin <address>` pins a page to the sidebar.
- Containers: logins of their own, in the plugin's `containers` setting:
  `[{ "id": "work", "name": "Work", "color": "orange", "sites": ["linear.app"], "lock": true, "agents": "read" }]`.
  Colours: blue, orange, green, red, purple, pink, yellow, teal, indigo, gray. `sites`: a page of one opened in no
  container opens there. `lock`: its pages need Touch ID, locking again when the Mac locks, sleeps or idles 15 minutes.
  `agents`: `read` or `act`; unset, agents can't use its pages (nor tabs in no container). A link opens in: a note's
  `container:` property (an id, or a name in any case) for every link followed from it, else its site's rule, else the
  workspace's `container`, else the workspace's own logins (`logins: shared`: one set for every page). What a page
  opens stays in its container.
- Agents: `vau browser ...` and the MCP tools `browser_open`, `browser_tabs`, `browser_snapshot`, `browser_act`,
  `browser_run`, `browser_navigate`, `browser_read`, `browser_wait`, `browser_screenshot`, `browser_pdf`,
  `browser_evaluate`, `browser_download`, `browser_ask_user`, `browser_login`, `browser_close`. Read
  `vau docs browsing` first.
  - The browser is the desktop app attached to this server. A server without one passes each call to an always-on
    machine in Machines that has one (its tab numbers, its Downloads), never to a laptop's app, and says when none has.
  - `vau browser open <url> --task "<task>"` (`--summary`) opens your own page in the background, in the Agents
    container, never a tab of the user's, answering its number, content and refs once it has drawn. It's laid out at
    1280x800 and 100% zoom wherever it's shown. What it opens is yours too. `close` closes only agents' pages.
  - `tabs` lists every tab: whose it is and what agents may do in it. `taken`: the user took it over and your acts fail
    till they give it back. The user can pause agents in a tab. A page left a minute rests till you're back.
  - `act <tab> <action> <ref>` or `--name "<its name>"`: click, dblclick, hover, fill/type `--value` (type with no ref:
    at the caret), paste `--value --format markdown|html` (never the user's clipboard), press `--key`, check, uncheck,
    select by option text, upload `--files` from the vault, scroll; `fill --fields` fills a form. It answers what
    changed (`--diff`: summary, none or a number of lines) or the new page's content, and what it downloaded. A ref
    lasts while its element is on the page.
  - `run <tab> '<script>'` composes snapshot, act, fill, read, wait and go in a sandbox, 30 s at most. `read` (`--main`,
    `--find`; a Google doc as Markdown, a sheet as CSV), `wait` (`--text`, `--url`, `--download`, `--helped`),
    `screenshot` (a PNG's path; background tabs too), `pdf` and `download <tab> <url>` (with the tab's logins) into the
    vault, `go <tab> <url|back|forward|reload>`, `player <tab>` (`--full-screen`, `--window`, `--off`).
  - `evaluate` (`act` only) runs in a world of its own: it sees the DOM, not the page's scripts, and pages' scripts never
    see what agents do.
  - Where only the user can go on (a sign-in, a passkey, a captcha): `vau browser ask <tab> "<what to do>"` shows them
    the page with a Done card and tells their Inbox; `wait <tab> --helped` waits for Done.
  - An agent from outside this machine never reaches local addresses (localhost, the LAN, the tailnet), redirected
    there or not.
  - Each agent's steps are kept 14 days to replay ("Show agents in the browser"), never what's typed in a password
    field. A failed call is kept with them.
- Passwords for agents: `vau browser login <tab>` (`--entry <title or username>` when the site has several, `--submit`
  presses Enter) fills a username and password, a username alone or a TOTP code from a KeePass file on that Mac (made
  with KeePassXC's KeeShare; set in the Agents container's "Passwords for agents…"). Matching is strict: an entry's
  address (and its KP2A_URL ones) names a host, `example.com` with its www., `*.example.com` every subdomain (never a
  public suffix's), an http page only for an http entry, ports exact. An entry tagged `agent-free` fills at once; any
  other waits for the user's yes with a passkey, from an Inbox event, lasting 15 minutes for that entry and agent.
  Nothing else gives a yes. You hear only what happened (filled, entries to pick from, waiting, no entry, said no).
  What's filled reads as ••• everywhere; `evaluate` is off in a page holding it (or any typed password), `screenshot`
  and `pdf` while it shows; a page your script ran in gets no login till it loads again.
  Adding a passkey, at that Mac: serve Vaultite over https on the tailnet (`tailscale serve --https=8447 8793`), then
  Passwords for agents… > Passkeys that approve logins… > Add a passkey…, scan with the phone, confirm with Touch ID.
- Bookmarks: the note `Bookmarks.md` (`type: bookmarks`; it may move): a heading per folder (`## Reading`, `### Later`
  under it), a `- [title](url)` line per bookmark. `vau bookmark <url> --title ... --folder "Reading/Later"`
  (`links` for many), `vau bookmark edit <url> --title ... --folder ... --before <url>`, `vau bookmark remove <url>`,
  `vau bookmark folder <path>` (`--rename`, `--remove`). Importing from Brave or Chrome adds history and bookmarks,
  never passwords or cookies.
- Blocked elements: `.vaultite/plugins/web-viewer/blocked-elements.md`, a `## <site>` heading per site and a
  `` - `rule` `` line per rule (words after it a note). Rules are uBlock Origin's and Brave's syntax
  (`youtube.com##ytd-reel-shelf-renderer`; no site: every site; `:has-text()` and the other procedural ones work), and
  apply with Shields down too. `vau browser block "<site>##<selector>"` (or `--site`), `unblock <rule>`,
  `blocked [site]`. Prefer selectors that last (a custom element's name, an id, a semantic attribute), never a generated
  class. A managed extension's blocking isn't here, and nothing here gets around it.
- Site styles: `.vaultite/plugins/web-viewer/sites/<site>.css` (its subdomains too; a host's own file, like
  `docs.google.com.css`, over its parent site's), applied before pages paint and again on save. Every declaration wins
  over the site's (the app makes it !important, in a layer), so write none. The vault's look is variables: use them,
  not colours of your own, and on a site with colour tokens of its own map those: `--vault-background`,
  `--vault-foreground`, `--vault-card`, `--vault-popover`, `--vault-muted`, `--vault-muted-foreground`,
  `--vault-primary`, `--vault-accent`, `--vault-border` and the app's other colours, `--vault-font-ui`,
  `--vault-font-text`, `--vault-font-code`, `--vault-radius`, `--vault-color-scheme` (light or dark),
  `--vault-paper-filter` (dark: a canvas' white paper onto the card; light: none). A site's dark mode goes in
  `@media (prefers-color-scheme: dark)`. `vau browser style [site]` (`--css`, `--remove`).
- Dark pages: a page dark by its site or by its style shows as it is, each judged as it looks with its style; the rest
  get Chromium's auto dark mode. A style that darkens a canvas itself uses `--vault-paper-filter`.
- Inbox events: a page's notifications (source: the site, kind `web`, linking to its tab). With claude.ai signed in to
  a workspace's logins, Claude Code on the web's sessions: "Claude Code finished" (kind `done`) or "Claude Code needs
  you" (`waiting`), `session` its address; the Terminals panel lists them under Cloud.
- Extensions are per Mac, never in the vault. Managed ones are named only by the owner, in
  `/Library/Application Support/Vaultite/managed-extensions.json` (every app; sudo) or `managed-extensions.json` in one
  app's userData: `{ "extensions": ["<an unpacked extension's folder>", "<a Web Store id>"] }`. Agents never write it
  or work around what it blocks.
