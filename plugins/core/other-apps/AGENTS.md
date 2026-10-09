## Vaults from other apps
A vault another Markdown app also opens keeps that app's settings in `.obsidian/app.json`; the app follows the keys it
sets that mean the same thing here (and never writes `.obsidian/`):
- `newFileLocation` / `newFileFolderPath`: where new notes go (`root`, `current`: the open file's folder, `folder`: that
  folder), else the top.
- `useMarkdownLinks`: `[[` suggestions and pasted images are written as Markdown links (`[Note](Note.md)`).
- Defaults of the app's own settings (`vau docs app`), while those are unset: `attachmentFolderPath` (where pasted files
  go: `/`, `./`, `./sub` or a folder) and `userIgnoreFilters` (excluded files); `templates.json`'s `folder`,
  `dateFormat`, `timeFormat` (Templates); `daily-notes.json`'s `folder`, `format`, `template` (Today's daily notes).
- The editor's `spellcheck`, `useTab`, `tabSize`, `autoPairBrackets`, `autoPairMarkdown`, `readableLineLength` and
  `propertiesInDocument`: what `.vaultite/editor.json` doesn't set (`vau docs app`).
- `.obsidian/types.json`: its property types (`{"types": {"due": "date"}}`; `multitext` is a list) apply here too,
  under `.vaultite/types.json`'s, which wins for a key both have (`vau docs properties`).
- Its plugins (`.obsidian/community-plugins.json`): `vau other-apps plugins` lists each with what stands in
  for it here; `vau other-apps use <id> original|<plugin>` picks one, `vau other-apps run-all` runs them all as they are.
