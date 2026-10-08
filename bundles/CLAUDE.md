# Notes for `bundles/`

- **Bundles** (`core/bundles.ts`; built-in in `bundles/<id>/`, the user's in `.vaultite/bundles/<id>/`): a setup of the
  app as a folder shaped like `.vaultite/` plus the vault files it needs. Core, not a plugin: it switches plugins.
  Applying goes through the API's own routes (`App.host().call`), adds files only where there's none, and keeps what it
  changed in `.vaultite/bundles/previous.json` for Restore (a round trip, key order too). Panels and pins become the
  defaults and the current workspace follows; an appearance value equal to the default removes the key. Vault plugins
  in a bundle need `allowCode`; a `local` setting is never saved or set. A vault opened for the first time starts from
  Minimal (`DEFAULT_BUNDLE`, core/bundles.ts); one still offered them (`onboarding.json`) opens on #bundles until one is
  applied or the offer skipped, which applies Minimal too (neither leaves a Restore). **A new app plugin**: decide in
  each built-in bundle whether it's on (an `essential` one is unless in `disabled`; a Vaultite plugin, `offByDefault`,
  only if in `enabled`; Minimal turns on none of those);
  `npm run check` checks the bundles name only what the app has. `"more": true` puts one under More….
  QA: `web/qa/bundles.mjs`.
