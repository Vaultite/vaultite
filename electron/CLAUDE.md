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
- An update (update.sh install) is staged beside the app and renamed in once it quit: a copy opened from the old bundle
  meanwhile would run the replaced tree while the disk says new (`ps` still shows the old path), so a running main is
  looked for first, and the app checks its server against build.json once up (installed.ts). The app's binary also runs
  its server, terminal keeper and agents' `vau mcp`: those aren't the app running.
- Test a release under another `appId` and `productName`: one sharing the installed app's bundle id makes macOS re-check
  its privacy grants. Uploading the update feed is by hand, never part of a build.
- Debugging the real window: `debugPort` in `vaults.json` (or `VAULTITE_DEBUG_PORT`) serves Chromium's DevTools
  protocol on 127.0.0.1; connect over CDP to read the user's live window, read only.
- The menu bar (`menu.ts`) is the focused window's commands as its page tells them: an item is a command id, never a
  copy of what it does. Only single ⌘/⌃/⌥ steps become accelerators (the page gets every key first).
- The Dock icon a page draws changes only the Dock, never the bundle.
- The first run is Set up Vaultite's window (the vault) and then the welcome card in the vault's window (web
  Welcome.tsx: the look, AI, permissions). It writes nothing outside `.vaultite/` in a folder of the user's (`npm run
  smoke` checks) but what they turn on there (agents' plugins and their pages), nor outside the vault but what they
  press (Allow on the card: Claude Code's and Codex's computer use); its tests write only under `VAULTITE_SETUP_HOME`.
- Location, Input monitoring and the drag panel (Settings > Permissions' Allow) are a Node addon in the main process
  (`macpermissions.m`), not a helper: CoreLocation and IOHIDCheckAccess answer for the process that asks, and macOS
  gives a helper binary no Location of the app's. Electron itself never asks macOS for Location.
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
  icon shows only while a window is open. Native parts: screen.swift (the keys' tap and ink, fields, other apps' text, the display's picture), dictation, voice.swift
  (the companion's voice out: it never plays under VAULTITE_QUIET, and VOICE_OUT writes a file instead).
  Only the app the user runs (packaged, not VAULTITE_QUIET; VAULTITE_HELPER_TAP=1 by hand) hears their keys and takes the
  one lock; a scripted copy hears a file, never the microphone, and where that lock is held (the user's app runs) its QA
  (web/qa/helper.mjs) is skipped unless VAULTITE_QA_LIVE=1. Each Talk-key press is logged (presslog.ts:
  userData/talk/talk-<day>.jsonl, a missed press's audio beside it): a press that went nowhere can be traced, and one
  that went shows its answer's first sound (`sound`: whose voice, ms after let-go) and a voice failing over; `stt` names
  the recognizer that heard it (`soniox`, else this Mac's with `why`), `stt-fallback` one failing mid-press; its `mic`
  and `micWhy` the input device and why, `mic-change` one that went mid-press.
- A dictation that leaves its window moves to the helper (dictation.ts `handOver`, the page keeps where it began till its
  words land: web core/dictation.ts): it's the helper's overlay that shows over every app. dictationroam.ts picks where they land.
- The realtime voice (realtimefront.ts over realtime.ts, OpenAI's WebSocket): dictation's session taps the mic for it
  (`tap`, 16 kHz, made 24 kHz), voice.ts' `stream()` plays its audio. It only gives the first sound: dictation still runs,
  and its words go to the summoned session at once, as on the pipeline (a screen answer is never slower for it); that
  answer is held (voice.ts `hold`) till the realtime voice routes the press (`look`: played after its two words, which
  give way, voice.swift `yield`; `talk`: it answered alone, the summoned answer withdrawn). Its tests are a stand-in
  socket; tools/evals/realtime.ts the real one.
- Bluetooth headsets drop to a call's sound while their microphone is open, and leave it about 2 s after it closes.
  So with one as the output, miclogic.ts picks the built-in (else a wired) mic (the setting Microphone, `auto`;
  dictation.swift lists the devices and opens the pick, the next one should it go); one used anyway is held open after
  a Talk key's press till its answer is said and a second on (`releaseMic`, at most 60 s). voice.swift follows its output device all the same (an engine started before a switch
  plays into nothing): a new engine, said again from the pause before (`voice-reroute`; `sound` says where it plays).
- The overlay (overlay.ts) is BrowserWindows, never `AppWindow`s: those count as the app's windows (the Dock, menus).
  `skipTransformProcessType`, or showing it on every Space takes the app out of the Dock. It never takes the keyboard: a
  cursor's conversation is a window of its own (`type: "panel"`, non-activating), so typing there leaves the app in
  front in front, and closing it gives that app its keyboard back.
- Every window is an `AppWindow` (appwindow.ts): a BaseWindow whose page is a view, so it can go over the Browser's
  pages (web.ts `raise`); a BrowserWindow's own page is always under its views. Pop-outs are adopted into one.
- A page's sized popup (a sign-in, a call's video) is a window of its own (popup.ts), never its opener window's child:
  on a Mac a child moves, minimizes and changes Space with its parent. One that stays on its opener's site (or is a
  blank one the opener writes into) is a pop-out, bare as a player; once it goes to another site it's a sign-in for good,
  its title bar naming that site, so the user sees who's asking. Keep on top (ontop.ts) skips Electron's process
  transform (it takes the app out of the Dock and the menu bar) and turns full screen off for the window meanwhile.
