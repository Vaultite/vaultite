# Notes for `bundles/`

- A bundle (`core/bundles.ts`) is a setup of the app: a folder shaped like `.vaultite/` plus the vault files it needs.
  Applying goes through the API's own routes, adds files only where there's none, and keeps what it changed for Restore
  (a round trip, key order too). A `local` setting is never saved or set.
- Three built in: Standard (the app's own defaults, so its plugins.json names nothing), Life OS, Agents. A new app
  plugin: decide in each whether it's on (an `offByDefault` one only if in `enabled`; Standard turns on none of those);
  an `alwaysOn` one is never named. `npm run check` checks bundles name only what the app has.
