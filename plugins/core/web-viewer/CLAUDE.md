# Notes for `plugins/core/web-viewer/`

- Desktop only: `view:web/<url>` tabs are an Electron WebContentsView over the pane (`electron/web.ts`): a session per
  profile (`persist:web`, `persist:web-<n>` for a workspace's own logins: `logins`, state.ts `profile()`), no preload,
  http(s) only; let-go pages are kept (4 per window) and taken back by address and profile.
- It's native, drawn above the DOM: `WebPage.tsx` keeps it on its box and swaps it for a snapshot while anything covers
  it. Toasts and `[data-floats]` (tooltips, key hints) are copied into native layers above it (index.tsx FloatLayer):
  a new overlay that doesn't take the pointer needs `data-floats`. The page keeps the keyboard; the app's ⌘/⌃/⌥
  shortcuts come back as `key` events.
- Pages' notifications (a `Notification` stand-in with a per-load token) come back as `notify` events, posted to the
  Inbox. Claude Code on the web's sessions (`CLOUD`) are claude.ai's JSON list (`/v1/code/sessions`, an
  `anthropic-version` header), asked with each profile's cookies (its partitions on disk), through an open claude.ai
  page of that profile when there is one: never its DOM, which changes. A window asks once (`web:cloud`), then hears
  `cloud` (the list, for the Terminals panel) and `session` (news, posted to the Inbox).
- Save image to vault downloads in the page's session (`saveAttachments`). Web links go through `openWebLink` (core/links.ts). QA: `webviewer.mjs`, `weblogins.mjs`, `webwatch.mjs`, `webicons.mjs`.
- Sites' icons (`icons.tsx`): the desktop app fetches a page's icons in its session, keeps only what decodes as an
  image (`iconOf`), by host in userData `web-icons.json`; the app draws the globe until one comes or if one fails to draw.
  QA: `webicons.mjs`.
