# Notes for `electron/`

- Each vault is a window with its own `server.ts` (forked with `ELECTRON_RUN_AS_NODE`, a port kept per vault so each
  keeps its localStorage), dying with its window, unless a server here already serves it (its service): then the window
  attaches to that one and answers its browser calls (host.ts). `vaults.json` is this Mac's, never a vault's.
- Files from outside a vault (Open with, a drop) are read or written only when the main process sent their path
  (`core/outside.ts`).
- Signing (`sign.cjs`): with a real identity macOS keeps the app's privacy grants across builds; signed ad hoc, each
  build is a new app and its terminals get "Operation not permitted" on an iCloud Drive vault. A new native need is an
  entitlement (`entitlements.plist`) or an Info.plist usage string (package.json's `build`).
- Four apps, each its own id, name and userData, so any of them install side by side: Vaultite (releases), Vaultite
  Nightly (`nightly.cjs`), Vaultite Main (`source.cjs`: built from source, `app:build`) and Vaultite Dev (a branch;
  `npm run app:dev` opens the sandbox, never Set up).
- Test a release under another `appId` and `productName`: one sharing the installed app's bundle id makes macOS re-check
  its privacy grants. Uploading the update feed is by hand, never part of a build.
- Debugging the real window: `debugPort` in `vaults.json` (or `VAULTITE_DEBUG_PORT`) serves Chromium's DevTools
  protocol on 127.0.0.1; connect over CDP to read the user's live window, read only.
- The menu bar (`menu.ts`) is the focused window's commands as its page tells them: an item is a command id, never a
  copy of what it does. Only single ⌘/⌃/⌥ steps become accelerators (the page gets every key first).
- The Dock icon a page draws changes only the Dock, never the bundle.
- Set up Vaultite writes nothing outside `.vaultite/` in a folder of the user's (`npm run smoke` checks) but what they
  turn on there (an agent's plugin and its page), nor outside the vault but what they tick (an agent's config: Claude
  Code's computer use, Codex's, OpenClaw's and Hermes' MCP servers); its tests write only under `VAULTITE_SETUP_HOME`.
- macOS credits what programs in the app's terminals do (screen capture, Accessibility) to the app: the terminal keeper
  is the app's child, and stays its even after the app quits. One grant covers every agent there.
- Windows: a release build only (no update.sh; Vaultite Main is Mac and Linux). Its title bar is the page's, with
  Windows' controls drawn over the top-right corner (preload.cjs tells their colours, index.css keeps clear of them);
  files and vaultite:// links come in argv and `second-instance`, outside paths go to the page with forward slashes.
  Its installer stops every process running its .exe, terminal keepers and `vau` included, before it updates.
- The menu-bar helper (helper.ts, a Mac's): Electron's own process kept windowless with a Tray, not a second app, so it
  is one install with one signature and the grants the app already has (microphone, Accessibility, screen recording).
  One per Mac (a lock socket in the temp folder: Vaultite, Main and Dev may all run); off in Vaultite Dev and under
  VAULTITE_QUIET unless VAULTITE_HELPER=1. With it, a closed window's server is kept (`kept` in main.ts) and the Dock
  icon shows only while a window is open. Native parts: screen.swift (fn's tap, fields, other apps' text), dictation.
- The overlay (overlay.ts) is BrowserWindows, never `AppWindow`s: those count as the app's windows (the Dock, menus).
  `skipTransformProcessType`, or showing it on every Space takes the app out of the Dock.
- Every window is an `AppWindow` (appwindow.ts): a BaseWindow whose page is a view, so it can go over the Browser's
  pages (web.ts `raise`); a BrowserWindow's own page is always under its views. Pop-outs are adopted into one.
