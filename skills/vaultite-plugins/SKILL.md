---
name: vaultite-plugins
description: Write a Vaultite vault plugin, a feature of the user's own in .vaultite/plugins/<id>/ (a kind of file, a block, a page, an operation, a script on a timer or on an event). Use when the user wants Vaultite to do something it doesn't, or asks for a plugin, block, tracker or automation in their vault.
license: Apache-2.0
---

# Vaultite vault plugins

1. Maybe no plugin is needed: a page of the blocks the app has (`vau blocks`, `vau dashboard new --help`), a CSV or an
   HTML file in the vault often does it.
2. Read `vau docs vault-plugins` whole before writing one (manifest, server, operations, scripts with no code,
   frontend, blocks), and `vau docs api` for an operation's shape.
3. `vau plugin new <id>` writes a working one to start from; change it from there.
4. It's off until the user turns it on, since it runs code on their Mac: ask them (the Plugins page, or
   `vau plugin on <id>`).
5. Check it: `vau plugins check` (why it didn't load, blocks to fix), then run its operations (`vau ops`) and read its
   page as the user sees it (`vau render <file>`).

Without `vau`, the same guide is `core/docs/vault-plugins.md` in https://github.com/Vaultite/vaultite, with made-up
plugins to learn from in `tools/fixtures/lighthouse/` and `tools/fixtures/wordcount/` (scripts only) there.
