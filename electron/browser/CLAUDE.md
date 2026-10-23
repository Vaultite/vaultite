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
  isolated world. The one exception is passkeys-preload.cjs: navigator.credentials is called in the main world, so it
  replaces it there, holding only the bridge's two functions (no global); passkeys.ts takes the origin from Chromium.
- Passkeys come from a phone over FIDO's hybrid transport (hybrid.ts), since Electron has no WebAuthn UI and a Mac's own
  (iCloud Keychain, Touch ID) needs Apple's browser entitlement: the phone signs with its passkeys, the app only relays.
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
- The user's hiding rules (blocked elements) are an engine of their own per window, apart from the lists (rebuilt daily)
  and from Shields being down; they reach frames through the same preload, and again as they change (`adblock:rules`).
  Ghostery joins a stylesheet's selectors into one rule: theirs are split (`apart`), so one typo hides only itself.
- Site styles (sitestyles.ts) are inserted author CSS, which Chromium orders before the page's own: they win only by
  being !important in a layer (`vaultite-style`), which the app makes them (web-viewer's stylestate.ts `winning`).
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
- Another browser's settings for an extension (extsettings.ts) are read and written by a stand-in extension with its
  key, never the extension itself (its worker would act on what it found mid-copy): Chromium keeps each chrome.storage
  area as a LevelDB folder, which a session of its own reads as its local area. Written through the storage shim, so
  the sync area lands where the extension reads it.
- Pages say they're a plain Chrome (web.ts strips Electron and the app's name from the user agent: Google's sign-in turns
  away Electron), but Cloudflare's human check finds Electron in the page and fails that lie: its requests say Electron
  (challenges.ts), with which it passes, the user's click or none.
- Chromium drops session cookies (no expiry) at every launch (Electron never sets persist_session_cookies), so every
  restart into an update signed out of sites that use one: sessioncookies.ts follows each persistent session's as they
  change and writes them encrypted (safeStorage, never plain) into its partition's folder, setting them again as the
  session is made.
- Persistent cookies are encrypted in the Cookies databases (the EnableCookieEncryption fuse, electron/sign.cjs), with
  the "<app name> Safe Storage" Keychain key safeStorage uses. Rows saved plain before still load and are encrypted when a
  site sets them again. Chromium deletes every cookie of a site with one it can't decrypt (a build without the fuse, a
  Keychain that refuses): never run a build without it on a profile. A session setup that returns a promise
  holds the session's pages and cookie reads (`sessionReady`); a restart into an update awaits `engineFlush` first.
- Agents never read a secret the app filled (logins.ts, from agents.kdbx): every agent answer goes through `serve`, which
  scrubs it (pagesecrets.ts), and what a page shows is scrubbed at its source too, since `run` composes calls without
  `serve`. A new agent output does the same. An agent's script (evaluate) can inject code that stays listening in the
  page's document, so the app fills nothing on that site's pages till they load again; this holds only because Electron
  has no back/forward cache (web/qa/agentlogins.mjs checks).
