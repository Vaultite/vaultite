# Notes for `bundles/`

- A bundle (`core/bundles.ts`) is a setup of the app: a folder shaped like `.vaultite/` plus the vault files it needs.
  Applying goes through the API's own routes, adds files only where there's none, and keeps what it changed for Restore
  (a round trip, key order too). A `local` setting is never saved or set.
- A plugin of Vaultite's own that isn't the app's (one that moved out) is named with `install` (`Vaultite/plugins/<id>`).
- Three built in: Standard (the app's own defaults, so its plugins.json names nothing), Zen, Life OS. A new app
  plugin: decide in each whether it's on (an `offByDefault` one only if in `enabled`; Standard turns on none of those);
  an `alwaysOn` one is never named. `npm run check` checks bundles name only what the app has.
- Their card pictures (`preview.png`, `preview-dark.png`) are shots of the app with each applied: after a change to
  how one looks (or to the app's look), `PORT=<free> node web/qa/bundle-shots.mjs [<id>...]` and look at them.
