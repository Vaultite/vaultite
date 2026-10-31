# Notes for `plugins/core/web-viewer/`

- Desktop only: a `view:web/<url>` tab is an Electron WebContentsView over the pane (`electron/web.ts`), a session per
  profile, http(s) and installed extensions' own pages (chrome-extension://) only. Its preloads are the engine's
  (electron/browser/), registered on its session, and web.ts's web-preload.cjs, which only tells its first paint.
- A new page shows the app's background (`web:look`) till its site first paints, then white, the web's default canvas
  (which a view's colour also is: kept dark, unstyled sites go dark). Not white at commit: nothing holds the old frame
  till the first paint, so that flashed. Not a hidden page till it paints either: a hidden or off-window view never paints.
- It's native, a view above the window's own page: while anything covers it, the window's page goes over it
  (`layers.ts`, electron/appwindow.ts), see-through behind it (only backgrounds are cut), so the page stays live. A new
  overlay that doesn't take the pointer needs `data-floats` (the pointer then goes on to the page over the DevTools
  protocol: sendInputEvent never reaches a frame from another site, a captcha's or "Sign in with Google"). Small
  ambient bits the page may hide (a companion's cursor) take `data-under-pages`, so they don't raise the window.
- A tab owns its page by the tab's id (`usePane().tab`; electron/webpages.ts decides): hidden in the background, the same
  one when shown again, ended when the tab closes or leaves the window (`onTabClose`; moved to another of the vault's
  windows, it goes along: `moved`, web.ts `adopt`) or shows something else. None
  outlives its tab: a reloaded window's tabs take theirs back within seconds or they end. Never match pages by address:
  `getURL()` is "" till the first load commits (it was how hidden pages kept playing with no tab). A page made before
  its tab (window.open's, kept for `window.opener`; a glance kept as a tab) is handed to it by id (`web:adopt`) first.
  Such a page needs `outlivesOpener`: Electron otherwise ends it with its opener, and closing a tab closed all it opened.
- An agent's page opens with no tab (web.ts `make(..., agent)`), parked: shown off the window, unthrottled, so it draws
  on (live pictures, screenshots); a hidden view stops drawing at its next cross-site load. Unused a minute it rests
  hidden (agent.ts), and every agent call or watch wakes it (EnginePage `wake`). Open as tab hands it to a tab (`own`).
- A page in its player (a window of its own, web.ts's players) is still its tab's, `win` its tab's window: only where
  it's drawn changes (`fit`), so ending, reclaiming and closing work as for any; its tab draws nothing over it meanwhile.
  Esc never reaches a page that's full screen (Electron takes it), so the player's video leaving full screen leaves it.
- The page keeps the keyboard; the app's ⌘/⌃/⌥ shortcuts come back as `key` events. The browser's keys a site may take
  (⌘F, ⌘G, zoom: web.ts BROWSER_KEYS) reach the page first and come back only if it left them (web-preload.cjs), never
  to the menu bar, whose ⌘F and ⌘= are the app's.
- Claude Code on the web's sessions are read here (electron/web.ts) for the Cloud sessions plugin, which says what.
- Extensions (electron/browser/extensions.ts) are this Mac's, in userData: each is code with every site's logins, so a
  synced vault setting never chooses one (plugins rule 4). Their bar buttons, popups and the Extensions tab:
  `Extensions.tsx`; the made-up one QA uses: tools/fixtures/web-extension (web/qa/extensions.mjs).
- Its tabs from the web app (no Electron there: a phone, the always-on server) or another machine are the live view:
  LiveView.tsx, its routes liveroutes.ts, the engine's electron/browser/live.ts. A tab is `3@m1` in another machine's
  browser, its routes and socket joined there. Owner only and never ops, so no agent drives input that way; frames reach
  the server unasked as desktop events (core/desktopapp.ts onDesktopEvent), only while someone watches.
- Other machines' logins (machinelogins.ts, Sites' "On M1"): names travel, cookies never through a server. A login
  leaves only from the user's act in this window (`web:seal`, never a server call), sealed for the other app's key
  (electron/browser/sealed.ts); that app takes it as `remote:take`, which adds a login and reads none. Never add a
  `remote:` call that answers a cookie or signs out: anything on the tailnet that reaches a server could ask it.
- The page bar hidden (`pageBar`, pagebar.ts) lies over the box, slid out: out, it covers the page's top, so the window
  is raised over the page (layers.ts) and hears the pointer leave it. The window never hears the pointer over a page:
  electron/web.ts tells when it's at the page's top (`top`), as it tells the window's edges for the sidebars.
