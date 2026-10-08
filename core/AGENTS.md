# Vaultite

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
