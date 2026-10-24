# Notes for `electron/browser/`

The browser engine under the Browser's pages (`electron/web.ts` makes the pages and their sessions). Each feature is
a file here that adds itself through `engine.ts` and is imported by `index.ts`; web.ts never names a feature.
- It imports nothing of the app's (`npm run check`), so it could be a library: the app hands it its windows
  (`setEngineHost`), and what a feature needs of the app goes through that host, kept small.
- A feature sets up every session (`eachSession`: a profile's logins, a container's) and every page (`eachPage`), never
  one handed to it: containers make sessions at any time.
- The app reaches a feature as `webPages.engine("<feature>:<what>", ...)` (`handle`); a feature tells windows with
  `tell(win, { type: "engine:<feature>:<what>" })`. Check the arguments like any IPC.
- What a feature keeps is this Mac's (userData), never the vault's; what the user chooses is the web-viewer plugin's
  settings, which the app hands the engine.
- Pages are web content: no preload with Node, no `nodeIntegration`, scripts in isolated worlds. The one exception,
  passkeys-preload.cjs, replaces navigator.credentials in the main world holding only the bridge's two functions.
- Passkeys come from a phone over FIDO's hybrid transport (hybrid.ts): Electron has no WebAuthn UI and a Mac's own needs
  Apple's browser entitlement. The phone signs, the app only relays.
- Electron takes one `webRequest` listener per event and session, so the engine holds them and features add hooks
  (`onRequest`) in import order (Shields first: what it blocks, extensions never see). A hook whose `on` changes says
  `requestsChanged`. Hooks answering every request stay cheap and sync.
- Extensions: Electron gives content scripts, runtime messaging, storage.local, scripting, alarms and part of tabs;
  extapi.ts answers the rest through extensions.preload.cjs (extensions' pages and workers only). Content scripts can't
  be reached by a preload: their storage shim is written into the extension at install (extstore.ts `prepare`). A
  preload touching a site's own service worker stalls its pages: workers ask their scope (`vaultite:ext:scope`) first.
- Service workers get session preloads only in the sandboxed renderer, which a windowless process under --no-sandbox
  (Playwright on Linux, an AppImage under AppArmor) gets only from main.ts adding `--enable-sandbox`. Never
  `app.enableSandbox()`: it drops --no-sandbox, which that AppImage needs.
- Chromium puts its API objects back on `chrome` whenever an extension loads: the preload adds to them, never replaces
  `chrome.<api>`.
- Session preloads reach frames only because web.ts sets `nodeIntegrationInSubFrames` (sandboxed, no Node); Shields'
  cosmetic filtering relies on it too.
- Nothing heavy loads at launch (Ghostery, its lists, extensions): it's `later` in engine.ts, loaded before the first
  page (web.ts awaits `engineLoaded`) or when the app asks a name nothing answers yet. Names every window asks at start
  (`adblock:settings`, `lock:set`) stay cheap and eager.
- The user's hiding rules are an engine of their own per window, apart from the daily lists and from Shields being
  down, sent to frames again as they change (`adblock:rules`). Ghostery joins a sheet's selectors into one rule: ours
  are split (`apart`), so a typo hides only itself.
- Site styles (sitestyles.ts) are author CSS, which Chromium orders before the page's: they win only as !important in
  a layer (`vaultite-style`), which web-viewer's stylestate.ts `winning` makes them.
- The element picker (picker-page.js) is an overlay in an isolated world, styled only through the CSSOM, so no CSP or
  Trusted Types refuse it.
- Managed extensions (extpolicy.ts) are named only in a policy file on this Mac: nothing in the app, a vault or the
  server turns one off or removes it (extstore.ts refuses too).
- With a session `webRequest` listener Electron gives extensions' `chrome.webRequest` no events, so the preload
  replaces it and extwebrequest.ts relays the engine's hooks. onAuthRequired is Electron's `login`, matched by the 401
  before it; the app has no sign-in prompt, so no credentials shows the site's 401. Extensions never see the app's own
  requests, nor extensions'.
- Another browser's settings for an extension (extsettings.ts) are copied by a stand-in extension with its key, never
  the extension itself (its worker would act mid-copy): each chrome.storage area is a LevelDB folder a session of its
  own reads, written through the storage shim so the sync area lands where the extension reads it.
- Pages claim a plain Chrome (web.ts strips Electron from the user agent: Google's sign-in refuses Electron), but
  Cloudflare's check finds Electron in the page, so its requests say Electron (challenges.ts) and pass.
- Chromium drops session cookies at every launch (Electron never sets persist_session_cookies): sessioncookies.ts
  keeps each persistent session's, encrypted (safeStorage), in its partition's folder and sets them as it's made.
- Cookies are encrypted (the EnableCookieEncryption fuse, electron/sign.cjs) with the "<app name> Safe Storage" key;
  plain rows from before load, encrypted when set again. Chromium deletes every cookie of a site with one it can't
  decrypt: never run a build without the fuse on a profile. A session setup returning a promise holds its pages and
  cookie reads (`sessionReady`); an update restart awaits `engineFlush`.
- Agents never read a secret the app filled (logins.ts, agents.kdbx): every agent answer goes through `serve`, which
  scrubs it (pagesecrets.ts), and page text is scrubbed at its source too, since `run` composes calls without `serve`.
  After an agent's script runs in a site's page the app fills nothing there till it loads again (sound only because
  Electron has no back/forward cache: web/qa/agentlogins.mjs).
- A login its entry's tag doesn't free waits for the user's passkey, verified here (presence.ts), never for a yes an
  agent could give. A passkey is added only by a code the app shows, then Touch ID: agents have computer use, so a
  click proves nothing. The list is encrypted with the Keychain's key.
