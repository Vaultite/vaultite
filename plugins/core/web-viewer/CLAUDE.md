# Notes for `plugins/core/web-viewer/`

- Desktop only: a `view:web/<url>` tab is an Electron WebContentsView over the pane (`electron/web.ts`), a session per
  profile, http(s) and extensions' own pages only. Elsewhere a tab's page opens outside (WebPage's `Elsewhere`), but
  for the web demo's few sites (framed.ts), shown in a sandboxed frame of their own origin (FramedPage.tsx).
- A new page shows the app's background till its site first paints, then its canvas (engine.ts `canvasOf`). Not white
  at commit: nothing holds the old frame till the first paint, so it flashed. Not hidden till it paints either: a hidden
  or off-window view never paints.
- The page is native, above the window's page: while anything covers it, the window's page goes over it (`layers.ts`,
  electron/appwindow.ts), see-through behind it. Only a popup or a drag takes every click; anything else takes its own
  and the rest go to the page over CDP, since sendInputEvent never reaches a cross-site frame (a captcha, "Sign in with
  Google"). An overlay no hit test finds (no pointer events, or between the test's points) needs `data-floats`; small
  ambient bits the page may hide take `data-under-pages`, so they don't raise the window. No API passes a pinch on:
  macOS gives it to the top view, so electron/gestures.m hands it to the page under the pointer (`web/qa/pinch.mjs`,
  VAULTITE_REAL_INPUT=1).
- Electron drags the window wherever any view has a drag region, whatever is drawn over it, and Chromium neither clips
  nor stacks regions (only document order counts). So sites' own are off (web-preload.cjs) and the window's are cut
  where a page shows (WebPage's `data-web-cut`, after them in the document); `web/qa/pageclicks.mjs`.
- While its pane moves (core/panemotion.ts) a picture of the page slides in its place and the page waits off the window
  at its new size: a native view moved each frame trails the pane.
- A tab owns its page by the tab's id (electron/webpages.ts): kept while hidden, ended when the tab closes, leaves the
  window (moved to another of the vault's windows, it goes along: web.ts `adopt`) or shows something else. None
  outlives its tab. Never match pages by address: `getURL()` is "" till the first load commits (hidden pages kept
  playing with no tab). A page made before its tab (window.open's, a glance) is handed over by id (`web:adopt`) and
  needs `outlivesOpener`, or Electron ends it with its opener.
- A tab comes back as it was (relaunch, ⌘⇧T, a discarded page): history and page state from web-tab-history.json, its
  last picture (web-frames/, never a locking container's) under the page till it paints (`web:frame`). Pages aren't
  started before their tab asks: starting the engine with the window delayed the window and its picture.
  `web/qa/webrestore.mjs` times it.
- An agent's page has no tab, parked off the window and unthrottled so it keeps drawing (a hidden view stops at its
  next cross-site load); idle a minute it rests hidden (agent.ts) and any agent call wakes it. While an agent holds it
  (agent.ts `held`) its size is pinned over CDP at 1280x800, zoom isolated, web.ts `fit` never places it, and its tab
  draws AgentWatch.tsx's picture.
- Agents from outside this machine (`remote`) never reach local addresses: agent.ts refuses them and cancels loads
  there (redirects, frames, DNS answers) while such an agent drives the page.
- A page in its player is still its tab's (`win` the tab's window); only `fit` changes. Its video fills it as a popover
  (the top layer), leaving the site's own full screen the site's.
- The page keeps the keyboard; the app's ⌘/⌃/⌥ shortcuts come back as `key` events. Keys a site may take (⌘F, ⌘G, zoom:
  web.ts BROWSER_KEYS) reach the page first and come back only if it left them, never to the menu bar.
- Only another app's link (desktopapp.ts `fromApp`) may ask which container (linklogins.ts). Who's signed in is the
  engine's to say (`web:who`), and a page's flow too (webpages.ts `flowOn`); sign-ins are known by OAuth's, SAML's and
  OpenID's fields (core/signin.ts), never by naming a site.
- Extensions (electron/browser/extensions.ts) are this Mac's: each is code with every site's logins, so a synced vault
  setting never chooses one (plugins rule 4). QA's: tools/fixtures/web-extension (web/qa/extensions.mjs).
- The live view (another machine's or the web app's tabs: LiveView.tsx, liveroutes.ts, electron/browser/live.ts) is
  owner only and never ops, so no agent drives input that way; frames reach the server only while someone watches.
- Other machines' logins (machinelogins.ts): names travel, cookies never through a server. A login leaves only from
  the user's act in this window (`web:seal`), sealed for the other app's key (electron/browser/sealed.ts), taken there
  as `remote:take`. Never add a `remote:` call that answers a cookie or signs out: anything on the tailnet that
  reaches a server could ask it.
- The page bar hidden (usebar.ts, barout.ts) slides over the page's top, so the window is raised over the page while
  it's out. The window never hears the pointer over a page: electron/web.ts tells when it's at the page's top (`top`).
  The pane's top (Tabs.tsx's `data-pane-bar`, Workspace.tsx's `data-pane-gap`) brings it too, and every menu that has
  the bar's switch puts it last.
- As cards, a page's corners follow its card's only where it fills the card (`setBorderRadius`). Electron rounds all
  four alike and a Mac's parent View clips no page (tried), so under a bar a page is square.
