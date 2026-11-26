# Notes for `android/`

- The Android app is the iPhone's shell (`ios/CLAUDE.md`) for Android: its first screen (`web/phone.html`) lists
  servers and loads one's web app in place. The page's side of the bridge is `web/src/core/phoneapp.ts`; the Shell
  plugin has the iPhone's methods that need only Android itself, and the page asks for the others by name (`shellHas`).
- Capacitor's Android bridge serves only its own origin and those allowed when the activity starts, so a server's page
  gets it from `ServerPages` (the bundled config plus the servers' origins), and opening a server the activity wasn't
  made for makes it again (`MainActivity.openServer`). A new method needs nothing more: its `@PluginMethod` is in the
  injected list.
- The window shrinks for the keyboard, so the page can't see it in its viewport as on iOS: MainActivity tells it
  (`vaultite:keyboard`, taken by `web/src/core/androidapp.ts` for `keyboardUp`).
- Back closes what's over the page first: the page says whether something is open (`web/src/core/androidapp.ts`) and
  the shell sends a real Escape key (a script's doesn't close a `<dialog>`); then history, then out of the app.
- The project is Capacitor's template, edited by hand: `cap sync android` only copies the web build and its config.
  The copy leaves out the server's precompressed `.br` and `.gz` (`tools/phone_copy.ts`, Capacitor's `copy:after`
  hook): Android's asset merger reads `x.js.gz` as `x.js`, and the pair fails the build as duplicates.
  Build on Linux or a Mac with JDK 21 and the SDK (`npm run android`); CI's `android.yml` builds each release's APK.
- Signing: the release key comes from CI's secrets (`android.yml`); a build without it uses the debug key, and a phone
  refuses to update an installed APK to one signed with another key.
