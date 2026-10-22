# Notes for `plugins/core/web-viewer/`

- Desktop only: a `view:web/<url>` tab is an Electron WebContentsView over the pane (`electron/web.ts`), a session per
  profile, http(s) and installed extensions' own pages (chrome-extension://) only. Its preloads are the engine's
  (electron/browser/), registered on its session, and web.ts's web-preload.cjs, which only tells its first paint.
- A new page shows the app's background (`web:look`) till its site first paints, then white, the web's default canvas
  (which a view's colour also is: kept dark, unstyled sites go dark). Not white at commit: nothing holds the old frame
  till the first paint, so that flashed. Not a hidden page till it paints either: a hidden or off-window view never paints.
- It's native, a view above the window's own page: while anything covers it, the window's page goes over it
  (`layers.ts`, electron/appwindow.ts), see-through behind it (only backgrounds are cut), so the page stays live. A new
  overlay that doesn't take the pointer needs `data-floats` (the pointer then goes on to the page). Small ambient bits
  the page may hide (a companion's cursor) take `data-under-pages`, so they don't raise the window.
- A tab owns its page by the tab's id (`usePane().tab`; electron/webpages.ts decides): hidden in the background, the same
  one when shown again, ended when the tab closes or leaves the window (`onTabClose`) or shows something else. None
  outlives its tab: a reloaded window's tabs take theirs back within seconds or they end. Never match pages by address:
  `getURL()` is "" till the first load commits (it was how hidden pages kept playing with no tab).
- A page in its player (a window of its own, web.ts's players) is still its tab's, `win` its tab's window: only where
  it's drawn changes (`fit`), so ending, reclaiming and closing work as for any; its tab draws nothing over it meanwhile.
  Esc never reaches a page that's full screen (Electron takes it), so the player's video leaving full screen leaves it.
- The page keeps the keyboard; the app's ⌘/⌃/⌥ shortcuts come back as `key` events.
- Claude Code on the web's sessions are read here (electron/web.ts) for the Cloud sessions plugin, which says what.
- Extensions (electron/browser/extensions.ts) are this Mac's, in userData: each is code with every site's logins, so a
  synced vault setting never chooses one (plugins rule 4). Their bar buttons, popups and the Extensions tab:
  `Extensions.tsx`; the made-up one QA uses: tools/fixtures/web-extension (web/qa/extensions.mjs).
