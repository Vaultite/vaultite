# Vaultite

This folder is a Vaultite vault: plain Markdown files the Vaultite app reads live. There's no database; the files are
the only copy, and the user reads them too.

- `vau` is the app's CLI (`vau --help`). Write through it where there's an operation (`vau ops`; also
  `POST /api/ops/<id>` and MCP's tools): it keeps ids, dates and links right. Else edit only what you mean to
  (`vau edit`: just the text you name). A long answer comes in pages: it ends saying the next `offset`.
- Before writing a kind of file, read its format: `vau docs <topic>` (`vau docs` lists them). A file's kind is its
  `type:` field; new files go where files of their kind already are. Don't invent fields.
- `vau tabs`: what the user has open; `vau context`: how their app is set up; `vau render <file>`: a file with its
  views filled in as text.

## Rules
- Add, don't rewrite: never delete or change the user's own lines unless they ask. Don't rename files unless asked
  (add `aliases`); then `vau move`, which updates links, never by hand.
- A fence like ```` ```block-person ```` is where the app draws a view, not data: never write in one, and leave it.
- Sentence case, no emojis; dates are the user's local ones (YYYY-MM-DD).
- One paragraph is one line: don't hard-wrap prose (a newline shows as a line break, as in Obsidian).
- No secrets (API keys, passwords, private links) in the vault. One the user must give you: `vau secret "<what>"`, piped
  where it goes (`| gh secret set NAME`), never asked in chat. Unsure who or what something is about: ask.
