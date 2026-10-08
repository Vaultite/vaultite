# Notes for `web/src/editor/`

- **Editor** (CodeMirror 6, one lazy chunk: `editor/lazy.ts`): reading / live preview / source per device, autosave
  600 ms after typing (core/autosave.ts). Markdown's extras get their HTML from `web/src/core/markdown.ts` only; raw HTML
  stays escaped except `<details>`. Outside a file's view it's `NoteEditor` / `FileEditor` (components/NoteEditor.tsx),
  wired like FileView (`useVaultEditing`, components/editing.tsx).
- A file's editor holds its whole text in every mode, so positions are the file's (plugins, Obsidian's included):
  outside source mode the frontmatter is hidden behind Properties and out of the user's reach (`editor/frontmatter.ts`).
- Plugins' `editor` extensions (the Vim vault plugin, Vaultite/plugins) go in a compartment at the highest precedence,
  reconfigured on plugin switches (`editorExtensions`, core/plugins.ts); vault plugins get the app's CodeMirror
  (`SHARED_EDITOR`, core/rules.ts), never their own copy.
- Every editor registers in `core/editors.ts`, so commands find the one meant (`currentEditor()`): Find and replace
  (`plugins/core/find`) and Folding (`plugins/core/folding`) load their CodeMirror code lazily.
- Switching views keeps the place (`keepPlace`, components/filePlace.ts).
- Page preview (`plugins/core/page-preview`) listens for `[data-wiki]` / `[data-preview]` outside sheets.
- Right-click: an image or embed has one menu (components/EmbedMenu.tsx); text has Editing commands' (made of commands
  by id); the desktop app lets the event reach the system first for spelling.
- QA: `keylists.mjs`, `editing.mjs`, `viewstate.mjs`, `stability.mjs`, `images.mjs`,
  `embedmenus.mjs`, `editormenu.mjs`.
