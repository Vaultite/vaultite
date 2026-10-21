# Notes for `plugins/core/web-viewer/`

- Desktop only: a `view:web/<url>` tab is an Electron WebContentsView over the pane (`electron/web.ts`), a session per
  profile, http(s) and installed extensions' own pages (chrome-extension://) only. No preload of the page's own: the
  engine's (electron/browser/) are registered on its session.
- It's native, drawn above the DOM: `WebPage.tsx` swaps it for a snapshot while anything covers it, and copies toasts and
  `[data-floats]` into native layers above it. A new overlay that doesn't take the pointer needs `data-floats`. Small ambient bits the page may hide
  (a companion's cursor) take `data-under-pages` instead, so they don't freeze it.
- The page keeps the keyboard; the app's ⌘/⌃/⌥ shortcuts come back as `key` events.
- Claude Code on the web's sessions come from claude.ai's JSON API with a profile's cookies, asked only after that
  profile opened a claude.ai page (never on load alone), never from its DOM, which changes.
- Extensions (electron/browser/extensions.ts) are this Mac's, in userData: each is code with every site's logins, so a
  synced vault setting never chooses one (plugins rule 4). Their bar buttons, popups and the Extensions tab:
  `Extensions.tsx`; the made-up one QA uses: tools/fixtures/web-extension (web/qa/extensions.mjs).
