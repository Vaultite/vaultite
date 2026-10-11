# Notes for `plugins/core/web-viewer/`

- Desktop only: a `view:web/<url>` tab is an Electron WebContentsView over the pane (`electron/web.ts`), a session per
  profile, no preload, http(s) only.
- It's native, drawn above the DOM: `WebPage.tsx` swaps it for a snapshot while anything covers it, and copies toasts and
  `[data-floats]` into native layers above it. A new overlay that doesn't take the pointer needs `data-floats`.
- The page keeps the keyboard; the app's ⌘/⌃/⌥ shortcuts come back as `key` events.
- Claude Code on the web's sessions come from claude.ai's JSON API with a profile's cookies, asked only after that
  profile opened a claude.ai page (never on load alone), never from its DOM, which changes.
