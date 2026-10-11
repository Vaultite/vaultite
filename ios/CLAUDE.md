# Notes for `ios/`

- The iPhone app is a shell: its first screen (`web/phone.html`) lists servers on the tailnet and loads one's web app in
  place, so the app is always the server's version; only the first screen and native code need a build. The web bundle
  has no `@capacitor/core` (the bridge is `web/src/core/phoneapp.ts`).
- Signing is `ios/App/Local.xcconfig` (not in git). The project file is Capacitor's template plus the extra targets,
  edited by hand: no generators.
- What a page asks the system for (camera, microphone, speech) needs its usage string in `ios/App/App/Info.plist`, or
  iOS ends the app.
- Push: `aps-environment` is development in Xcode builds, production in an archive.
- The watch can't reach the tailnet: everything goes through the phone over WatchConnectivity. On simulators the speech
  model can't download and file transfers don't arrive, so test with a short clip.
