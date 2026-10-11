# Notes for `plugins/`

## How it's built
- Built-in plugins are `plugins/core/<id>/`: the `essential` ones are the core as the user sees it, the rest are
  Vaultite plugins, `offByDefault`. Vault plugins live in the vault (installed, or the user's own); Vaultite's own are
  in the private repo Vaultite/plugins (`../vaultite-plugins`: its `node test.ts` checks them against this checkout).
- The core is generic primitives; what assumes one person's life (a job, a bank's CSV, one tool) is a vault plugin.
- A plugin is one folder, found by glob (no registration). The backend is the `Plugin` class (`core/plugins.ts`), the
  frontend `definePlugin` (`web/src/core/define.ts`): their doc comments are the reference.
- `forAgents` (manifest) is one line every agent reads while the plugin is on: only what an agent must know up front.
  Formats go in the plugin's `AGENTS.md` (`vau docs <id>`).
- Ask for a service (`plugin.provide` / `plugin.ask`), never for a plugin's id. Whether a plugin is off:
  `plugin.isOff()` / `vault.switchedOff()`.
- A new app plugin: decide whether each built-in bundle turns it on (`bundles/CLAUDE.md`).

## The rules
`core/rules.ts` checks them (`npm run check`).
1. A plugin's data is vault files or its settings (`.vaultite/plugins/<id>/data.json`). Files on the server's machine
   (`plugin.localDir()`, `plugin.dayLog`) only for disposable, high-churn data (history, activity, errors) that would
   churn iCloud.
2. Live data (calendar events, stats) stays out of the vault: `plugin.memo` (keyed on `fn.name`: name the function) or
   `plugin.writeCache`. Files show it through blocks.
3. Secrets: `plugin.secrets()` (`data/config.json`). A setting the manifest marks `local` is this machine's
   (`core/trust.ts`), so a synced vault can't set it.
4. A vault setting never chooses a program to run here: the owner's yes is `plugin.allows` / `plugin.allow`, kept on
   this machine. What only the owner may (a shell, the screen): `plugin.ownerOnly(req)`.
5. Imports: `@vaultite`, its own folder and plugins it `requires` (a required backend via `plugin.peer(id).exports`);
   the backend reaches the core only through `CORE_FOR_PLUGINS`. Settings come through the API, never from disk.
6. What it writes outside `.vaultite/` on its own, its manifest's `writes` declares (`core/CLAUDE.md`, write gate).

## Blocks
- A block needs both sides and a declaration: the React render (`index.tsx`), the text (`plugin.block`: what
  `/api/render` shows an agent), and its manifest entry, the contract both sides, the editor and the docs read. Plus
  its entry in `core/pages/Design.md`.
- A block is a view, never data: the backend never shows blocks to a kind (`prose()`), and API writes patch around
  them.
- A file format a plugin draws gives its text through the service `text:<ext>` (render and search read it).

## Vault plugins
- Same shape and rules; the backend imports the core as `@vaultite/core/plugins.ts`. Guide: `core/docs/vault-plugins.md`.
- Off until turned on and allowed on this machine (`core/trust.ts`): plugins.json syncs and travels with shared vaults
  and bundles, so what may run is this machine owner's yes to a plugin's content hash. Changed since, it waits again.
- Once allowed it's code on the server's machine: the rules are hygiene, not a sandbox.
- Another machine's update runs here only once its files match the source's, never on the lock's word.

## Gotchas
- Audio recorder: the transcriber's `model` is a name, never a path (whisper unpickles a path).
- File history: a whole top-level folder missing (iCloud) isn't a delete.
- Coding agent plugins share `core/codingagents.ts`. Claude Code's value is at API list prices: add new models to its
  `PRICES`. Their tests use made-up homes (`tools/fixtures/<id>`), pointed at by env vars in
  `tools/test/vault/harness.ts`.
