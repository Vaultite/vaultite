## Vaults from other apps
A vault another Markdown app also opens keeps that app's settings in `.obsidian/app.json`; the app follows the keys it
sets that mean the same thing here (and never writes `.obsidian/`):
- `newFileLocation` / `newFileFolderPath`: where new notes go (`root`, `current`: the open file's folder, `folder`: that
  folder), else the top.
- `attachmentFolderPath`: where a pasted image goes (`/`, `./`, `./sub` or a folder), else `Attachments/`.
- `useMarkdownLinks`: `[[` suggestions and pasted images are written as Markdown links (`[Note](Note.md)`).
- `.obsidian/types.json`: its property types (`{"types": {"due": "date"}}`; `multitext` is a list) apply here too,
  under `.vaultite/types.json`'s, which wins for a key both have (`vau docs properties`).
- Its plugins (`.obsidian/community-plugins.json`): `vau other-apps plugins` lists each with what stands in
  for it here; `vau other-apps use <id> original|<plugin>` picks one, `vau other-apps run-all` runs them all as they are.
