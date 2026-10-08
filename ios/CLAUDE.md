# Notes for `ios/`

- **iPhone app** (Capacitor 8 with SwiftPM; `npm run ios` builds, `cap sync ios`, opens Xcode): a shell whose first
  screen (`web/phone.html`, `web/src/phone.tsx`, from the app's own files) lists servers on the tailnet and loads one's
  web app in place, so the app is always the server's version (only the first screen and native code need a build).
  The page keeps Capacitor's bridge for "Switch server…" (`web/src/core/phoneapp.ts`, no `@capacitor/core` in the web
  bundle). Native: `App/ShellPlugin.swift` (servers, probing, `snapshot` for tab cards), `Shared/Servers.swift` (the
  list, in the app group), `Share/` (the share extension: a page to `POST /api/clip`, other text to `POST /api/inbox`).
  Signing: `App/Local.xcconfig` (not in git: `DEVELOPMENT_TEAM`, `VAULTITE_BUNDLE_ID`). The project file is Capacitor's
  template plus the extra targets, edited by hand: no generators.
- **Permissions** (App/Info.plist): what a page asks the system for (camera, microphone, speech) needs its usage
  string, or iOS ends the app.
- **Push** (`App/Push.swift`): the Inbox's events; the app gives its APNs token to the current server
  (`POST /api/inbox/devices`), which sends them (`plugins/core/inbox/push.ts`, its key in data/config.json). Buttons
  answer through `inbox.answer`. `aps-environment` is development in Xcode builds, production in an archive.
- **Watch app** (`App/Watch/`, SwiftUI): a microphone and the Inbox. The watch can't reach the tailnet: everything goes
  through the phone over WatchConnectivity (`Watch/PhoneLink.swift` asks, `App/WatchLink.swift` answers). A recording
  under 60 KB goes as message data, a longer one as a queued file; the phone transcribes it and sends `inbox.voice`.
  Simulators: SpeechTranscriber's model can't download and file transfers don't arrive, so test with a short clip.
  The complication (`App/WatchWidgets/`) opens `vaultite-watch://record`.
- **Widgets** (`App/Widgets/`): shortcuts (`vaultite://record`, `command/<id>`, `open/<path>`: Shared/Links.swift,
  phoneapp.ts takeLinks), routines and agents waiting, refreshed by a push when what they show changes. The deployment
  target is 26 everywhere (`swiftToolsVersion` 6.2 in capacitor.config.json).
