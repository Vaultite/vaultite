## Vaults from other apps
A vault another Markdown app also opens keeps that app's settings in `.obsidian/app.json`; the app follows the keys it
sets that mean the same thing here (and never writes `.obsidian/`):
- `newFileLocation` / `newFileFolderPath`: where new notes go (`root`, `current`: the open file's folder, `folder`: that
  folder), else the top.
- `useMarkdownLinks`: `[[` suggestions and pasted images are written as Markdown links (`[Note](Note.md)`).
- Defaults of the app's own settings (`vau docs app`), while those are unset: `attachmentFolderPath` (where pasted files
  go: `/`, `./`, `./sub` or a folder) and `userIgnoreFilters` (excluded files); `templates.json`'s `folder`,
  `dateFormat`, `timeFormat` (Templates); `daily-notes.json`'s `folder`, `format`, `template` (Daily notes).
- The editor's `spellcheck`, `useTab`, `tabSize`, `autoPairBrackets`, `autoPairMarkdown`, `readableLineLength` and
  `propertiesInDocument`, `defaultViewMode` (`source`: editing, `preview`: reading) as `defaultView`, and `livePreview`
  (false: source mode) as `editingMode`: what `.vaultite/editor.json` doesn't set (`vau docs app`).
- `appearance.json`: the defaults of `.vaultite/appearance.json` (`vau docs app`): `theme` (`obsidian` dark,
  `moonstone` light, `system`), `cssTheme` as the scheme, `enabledCssSnippets`, and the three fonts; `.obsidian/themes/`
  and `.obsidian/snippets/` are listed beside the vault's own. Its accent colour and text size have no match here.
- `hotkeys.json`: the keys of its core commands the app has too (`command-palette:open` is `palette:open`...), as the
  defaults of `.vaultite/hotkeys.json` (`vau hotkeys` marks them); its plugins' keys are plugin-compat's, by their ids.
- `.obsidian/types.json`: its property types (`{"types": {"due": "date"}}`; `multitext` is a list) apply here too,
  under `.vaultite/types.json`'s, which wins for a key both have (`vau docs properties`).
- Its plugins (`.obsidian/community-plugins.json`): `vau other-apps plugins` lists each with what stands in for it here;
  `vau other-apps use <id> original|<plugin>` picks one, `vau other-apps run-all` runs them all as they are.
