# Notes for `plugins/core/web-viewer/`

- Desktop only: a `view:web/<url>` tab is an Electron WebContentsView over the pane (`electron/web.ts`), a session per
  profile, http(s) and installed extensions' own pages (chrome-extension://) only. Its preloads are the engine's
  (electron/browser/), registered on its session, and web.ts's web-preload.cjs, which only tells its first paint.
- A new page shows the app's background (`web:look`) till its site first paints, then its canvas (engine.ts
  `canvasOf`): white, the web's default (which a view's colour also is: kept dark, unstyled sites go dark), unless dark
  pages darken it (the theme's background). Not white at commit: nothing holds the old frame till the first paint, so
  that flashed. Not a hidden page till it paints either: a hidden or off-window view never paints.
- It's native, a view above the window's own page: while anything covers it, the window's page goes over it
  (`layers.ts`, electron/appwindow.ts), see-through behind it (only backgrounds are cut), so the page stays live. Only a
  popup (a menu, a dialog) or a drag takes every click over the page; anything else (the mini player, a sidebar
  peeking, a floating pane) takes its own, the rest going on to the page over the DevTools protocol (sendInputEvent
  never reaches a frame from another site, a captcha's or "Sign in with Google"), its cursor shown back. An overlay no
  hit test finds (it takes no pointer, or sits between their points: a corner card) needs `data-floats`. Small ambient
  bits the page may hide (a companion's cursor) take `data-under-pages`, so they don't raise the window.
- Electron drags the window wherever any of its views has a drag region (`-webkit-app-region`), whatever is drawn over
  it, and Chromium neither clips regions nor stacks them: only document order counts. So a site's own are off
  (web-preload.cjs) and the window's are cut where a page shows (WebPage's `data-web-cut`); `web/qa/pageclicks.mjs`.
- While its pane moves (core/panemotion.ts: a split, a sidebar opening) a picture of the page (`shot`) slides in its
  place and the page waits off the window at its new size: a native view moved each frame trails the pane.
- A tab owns its page by the tab's id (`usePane().tab`; electron/webpages.ts decides): hidden in the background, the same
  one when shown again, ended when the tab closes or leaves the window (`onTabClose`; moved to another of the vault's
  windows, it goes along: `moved`, web.ts `adopt`) or shows something else. None
  outlives its tab: a reloaded window's tabs take theirs back within seconds or they end. Never match pages by address:
  `getURL()` is "" till the first load commits (it was how hidden pages kept playing with no tab). A page made before
  its tab (window.open's, kept for `window.opener`; a glance kept as a tab) is handed to it by id (`web:adopt`) first.
  Such a page needs `outlivesOpener`: Electron otherwise ends it with its opener, and closing a tab closed all it opened.
- A tab comes back as it was (a relaunch, ⌘⇧T, a page discarded): its history and each entry's page state (scroll, form)
  from web-tab-history.json, and its last picture (web-frames/, kept as its page ends and as the app quits; never a
  locking container's) drawn under its page, which stays see-through till it paints (`web:frame`, WebPage's
  `data-web-frame`). Not started before its tab asks (tried: the engine and a renderer starting with the window delayed
  the window and its picture, for a live page little sooner). `web/qa/webrestore.mjs` times it.
- An agent's page opens with no tab (web.ts `make(..., agent)`), parked: shown off the window, unthrottled, so it draws
  on (live pictures, screenshots); a hidden view stops drawing at its next cross-site load. Unused a minute it rests
  hidden (agent.ts), and every agent call or watch wakes it (EnginePage `wake`). Open as tab hands it to a tab (`own`).
- While an agent holds its page (agent.ts `held`: its own, not taken over, nothing asked) its size is pinned over CDP
  (1280x800) with its zoom isolated, web.ts `fit` never places it (`pageHeld`), and its tab draws AgentWatch.tsx's
  picture; `hold` re-applies all that whenever held changes. Closing its tab sends it to the background (`web:close`).
- Agents from outside this machine (`remote` in what an op hands the engine: ctx.refusal says so) never reach it or its
  network: agent.ts refuses opening, sending or using a page at a local address, and cancels a page's loads there
  (redirects, frames, DNS answers) while such an agent drives it. Its own agents may: QA's made-up sites, a dev server.
- A page in its player (a window of its own, web.ts's players) is still its tab's, `win` its tab's window: only where
  it's drawn changes (`fit`), so ending, reclaiming and closing work as for any; its tab draws nothing over it meanwhile.
  Its video fills it as a popover (the top layer), leaving the site's own full screen the site's, one with the window's.
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
  electron/web.ts tells when it's at the page's top (`top`, again while it stays: the page hears nothing while the bar's
  over it), as it tells the window's edges for the sidebars. The pane's top above it (Tabs.tsx's `data-pane-bar`
  strip, title or tabs, and as cards the gap above the card, Workspace.tsx's `data-pane-gap`: the window's to hear) brings
  it too, one band with the page's top, and its menu ends with the bar's switch (the view's `paneMenu`), with the tab bar's and pane titles': every menu that has it puts it last.
- As cards, a page's corners follow its card's where it meets them (WebPage's `corners`, `setBorderRadius`). Electron
  rounds all four alike, and on a Mac a parent View clips no page (tried), nor can a view go under the window's page
  short of raising it: under a bar its top corners round too. Raised, the hole keeps what's outside them painted.
