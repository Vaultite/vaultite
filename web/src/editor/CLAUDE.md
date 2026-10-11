# Notes for `web/src/editor/`

- A file's editor holds its whole text in every mode, so positions are the file's (plugins' and Obsidian's too); outside
  source mode the frontmatter is hidden behind Properties (`frontmatter.ts`).
- Markdown's extras get their HTML only from `web/src/core/markdown.ts`; raw HTML stays escaped except `<details>`.
- Plugins' `editor` extensions go in one compartment at the highest precedence; vault plugins get the app's CodeMirror
  (`SHARED_EDITOR`, core/rules.ts), never their own copy.
- Every editor registers in `core/editors.ts`, so commands find the one meant (`currentEditor()`).
- Suggestion lists share `suggest.ts`.
- An editor going away leaves its history and selection for the next one of that tab and file (`kept.ts`).
