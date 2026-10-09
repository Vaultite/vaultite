## Coming from another Markdown app
A vault another Markdown app made (an Obsidian vault) opens as it is (both apps can share a folder; the app never writes
`.obsidian/`). What carries over:
- Markdown: wikilinks and Markdown links to notes (`[text](Some%20Note.md)`), heading and block links and embeds,
  `#tags` and `#nested/tags` (with frontmatter `tags`), `==highlights==`, `%%comments%%`, callouts, footnotes, math,
  mermaid, `![[image.png|300]]`, and `[[file.pdf]]` / `![[file.pdf]]` finding attachments by name anywhere.
- Sidebar: Outline and Tags panels (shown from the sidebar's right-click menu, or as tabs), next to Files and Links
  (backlinks).
- Bases: `.base` files open as their views, embedded or inline (`vau docs query`).
- `.obsidian/app.json`: where new notes and pasted images go, and Markdown links; `.obsidian/types.json`: property
  types (`vau docs other-apps`, `vau docs properties`).
- Themes and CSS snippets, copied into `.vaultite/themes/` and `.vaultite/snippets/` (`vau docs app`).
- Its notes stay plain notes: a file is a person, a log, a book... by its `type:` only, so a `People/` folder brought
  over is still notes until `vau type People --apply` gives its files `type: person` (`vau type` lists such folders).
  A plugin's mark on its files (`kanban-plugin: board`) types them when the plugin standing in for it says so
  (its manifest's `marks`).
- Its plugins: offered once when the vault opens. Each runs as it is (the original, through a plugin that
  runs them: `replaces: {"obsidian": ["*"]}`) or with what stands in for it here; `vau other-apps plugins`, `vau
  other-apps use <id> original|<plugin>`, `vau other-apps run-all`, or the sheet of Vaults from other apps. Never both:
  turning one on turns the other off. More are in the Plugins page's Browse, in that plugin's tab.
- Not read: `workspace.json`, hotkeys and appearance. Renames update `[[links]]`,
  not Markdown links.
