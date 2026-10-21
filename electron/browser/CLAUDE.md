# Notes for `electron/browser/`

The browser engine under the Browser's pages (`electron/web.ts` makes the pages and their sessions). Each feature is
a file here that adds itself through `engine.ts` and is imported by `index.ts`; web.ts never names a feature.
- A feature sets up every session (`eachSession`: a profile's logins, a container's) and every page (`eachPage`), never
  one web.ts handed it by hand: containers make sessions at any time.
- The app reaches a feature by name, `webPages.engine("<feature>:<what>", ...)` (`handle`); a feature tells windows with
  `tell(win, { type: "engine:<feature>:<what>" })`. Arguments come from a page of the app: check them like any IPC.
- What a feature keeps is this Mac's (userData), never the vault's; what the user chooses (settings, lists) is the
  web-viewer plugin's settings, which the app hands the engine.
- Pages are web content: never a preload with Node, never `nodeIntegration`; anything run in a page runs in an
  isolated world.
- Electron takes one `webRequest` listener per event and session, so the engine holds them: a feature adds a hook
  (`onRequest`), in import order (Shields first: what it blocks, extensions never see). Electron listens only for events
  some hook's `on` wants; one that changes says `requestsChanged`. Requests go through hooks synchronously while they
  answer synchronously: keep a hook that answers every request cheap and sync.
- Extensions: Electron loads them (`session.extensions`) and gives content scripts, runtime messaging, storage.local,
  scripting, alarms and part of tabs; extapi.ts answers the rest through extensions.preload.cjs (a session preload in
  extensions' pages and service workers only). Content scripts can't be reached by a preload: what they need (the
  storage shim) is written into the extension's files at install (extstore.ts `prepare`). A preload that touches a
  site's own service worker's world stalls its pages: workers ask their scope (`vaultite:ext:scope`) first.
- Service workers get session preloads only in Electron's sandboxed renderer, which a process without a window (an
  extension's worker) gets under --no-sandbox (Playwright on Linux, an AppImage under AppArmor) only by main.ts adding
  `--enable-sandbox`; never `app.enableSandbox()`, which drops --no-sandbox (that AppImage needs it, and on Linux a
  hung window's Reload then failed).
- Chromium puts its own API objects back on `chrome` whenever any extension loads, keeping what's in them: the preload
  adds to those objects, never replaces `chrome.<api>` (it would be gone at the next load, at random).
- A session preload reaches a page's frames only because web.ts sets `nodeIntegrationInSubFrames` (sandboxed: no Node),
  which Shields' cosmetic filtering gets too.
- Nothing loads at launch that a vault never opening a web page doesn't need: what's heavy (Ghostery and the kept lists,
  extensions) is `later` in engine.ts, loaded before the first page opens (web.ts awaits `engineLoaded`) or when the app
  asks a name nothing loaded answers. The app asks some names as every window starts (`adblock:settings`, `lock:set`):
  those stay cheap and eager.
- The user's hiding rules (Blocked elements) are an engine of their own per window, apart from the lists (rebuilt daily)
  and from Shields being down; they reach frames through the same preload, and again as they change (`adblock:rules`).
  Ghostery joins a stylesheet's selectors into one rule: theirs are split (`apart`), so one typo hides only itself.
- The element picker (picker-page.js) is the page's own overlay in an isolated world (a native page can't be drawn
  over by the app), styled through the CSSOM only (constructed sheets, `style`): a page's CSP or Trusted Types never
  refuse it.
- Managed extensions (extpolicy.ts) are named only in a policy file on this Mac, never by the app, a vault or the server:
  nothing in the app turns one off or removes it (extstore.ts refuses too).
- With a session `webRequest` listener, Electron gives extensions' own `chrome.webRequest` no events at all (it picks
  one or the other per session), so the preload replaces it and extwebrequest.ts relays the engine's hooks to each
  listener (filters, host permissions, blocking answers by request id). onAuthRequired is Electron's `login`, matched to
  its request by the 401 before it; the app has no sign-in prompt, so no credentials shows the site's 401. Extensions
  never see the app's own requests (no initiator, no page), nor extensions'.
