---
name: vaultite-vault
description: Read and write a Vaultite vault, a folder of Markdown files the Vaultite app draws as pages (people, logs, notes, routines, books, projects, dashboards), through the vau CLI, Vaultite's MCP tools or the files themselves. Use in a folder with a .vaultite/ directory, when the user mentions Vaultite or vau, or asks to log, note or remember something in their vault.
license: Apache-2.0
---

# Vaultite vault

When the vault has `.vaultite/AGENTS.md`, read it rather than the rules below: the app writes it from the same source,
with the lines of the plugins that are on and the user's own rules. With Vaultite's MCP tools and no `vau`, the
operations are the same: the `ops` tool lists them, `call` runs one, `docs` and `render` read.

<!-- generated: core/AGENTS.md and the built-in plugins' forAgents lines (node tools/skills.ts writes this part) -->
This folder is a Vaultite vault: plain Markdown files that the Vaultite app reads live. There's no database; the files
are the only copy, and the user reads them too.

- `vau` is the app's CLI (`vau --help`). Write through it where there's an operation (`vau ops`; the same are
  `POST /api/ops/<id>` and MCP's tools): it keeps ids, dates and links right. Else edit the file, changing only what
  you mean to.
- Before writing a kind of file, read its format: `vau docs <topic>` (`vau docs` lists them). A file's kind is its
  `type:` field; new files go where files of their kind already are. Don't invent fields.
- `vau context` shows what the user is looking at; `vau render <file>` a file with its views filled in as text.

## Rules
- Add, don't rewrite: never delete or change the user's own lines unless they ask. Don't rename files unless asked
  (add `aliases`); then `vau move`, which updates links, never by hand.
- A fence like ```` ```block-person ```` is where the app draws a view: not data. Never write in one, and leave it
  where it is.
- Sentence case, no emojis; dates are the user's local ones (YYYY-MM-DD).
- No secrets (API keys, passwords, private links) in the vault. Unsure who or what something is about: ask.

## Plugins
- What the user did on a day (notes changed and what changed, tasks done, captures, logs): `activity.recap` (`vau recap 2026-10-06`), kept in `Recaps/<date>.md`.
- Something for the user to read later (research, a summary) goes in their inbox: `inbox.add`.
- `ME.md` is the user: read it before writing anything (who they are, the people who matter, how they want you to work, what not to store).
<!-- end generated -->

## Without the app

No `vau` and no MCP (a copy or a checkout of the vault): edit the files by the same rules, and the app reads them the
next time it opens the vault.
- A file's kind is its frontmatter `type:` (`person`, `log`, `note`, `book`, `project`, `routine`, `dashboard`...);
  without one it's a plain note. Copy the shape of a file of that kind already in the vault.
- Links are wikilinks: `[[Alice Park]]`, `[[Alice Park|Alice]]`, `[[Note#Heading]]`; `![[Note]]` on a line of its own
  shows that note there. Renaming a file by hand doesn't update its links: do it yourself.
- A `## Timeline` section holds dated lines, placed by date: `- 2026-09-28 · call · 30 min · Talked about the new job`.
- Leave `.vaultite/` (the app's settings and its generated files) and `.trash/` alone.
- Each kind's format in full: `core/docs/` and each plugin's `AGENTS.md` in https://github.com/Vaultite/vaultite.
