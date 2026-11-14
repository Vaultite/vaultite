---
type: note
kind: note
---

Research puts your reference library beside your writing: cite as you type, see each paper's references on the right in the style you choose, and keep a literature note for every source you read.

## Bring in your library
- **Zotero with Better BibTeX** (the most reliable, and it reaches your phone too): in Zotero, right-click My Library, Export Library…, pick Better BibLaTeX or Better BibTeX, tick Keep updated, and save the file in this vault (say `Library.bib`). Zotero rewrites it whenever your library changes, and every device that opens the vault cites from it.
- **Zotero on this computer**, live: in Zotero 7 or later, Settings, Advanced, turn on Allow other applications on this computer to communicate with Zotero. Your whole library, group libraries too, is cited from while Zotero runs, and what it had stays when it's closed. With Better BibTeX installed, its citekeys are the ones you cite with, and Cite from Zotero (the command palette) opens Zotero's own picker.
- **Zotero's web library**, for a vault served from another computer: make a key with read access at zotero.org/settings/keys, then References' settings, Zotero web library, Connect. The key stays on that computer, never in your notes.
- **Other reference managers**: any BibTeX (`.bib`), RIS (`.ris`), CSL JSON or CSL YAML file in the vault is read on its own. JabRef's library is a .bib already; Mendeley, EndNote, Citavi, Bookends, Papers and ReadCube export BibTeX or RIS; Paperpile syncs a .bib to a folder you can point into the vault.
- **No reference manager**: Add a reference by DOI, arXiv or ISBN (the command palette) looks the work up and keeps it as a note in your vault, ready to cite.

## Cite as you write
- Type `[@` and a name, a year or a word of the title, and pick the reference. A citation is Pandoc's, plain text you can read anywhere: `[@ahrens2017]`, a page with `[@ahrens2017, p. 33]`, several with `[see @bush1945; @luhmann1981, pp. 222-228]`, the year alone with `[-@kuhn1962]`, the author in your sentence with `@ahrens2017 argues`.
- Citations show in your style as you write. Click one to edit it; point at one to see the full reference, its DOI and where it is in Zotero.
- Insert citation (the command palette) or `/citation` in a note starts one; Cite from Zotero uses Zotero's picker on the computer it runs on.

## Styles
- The style's name above the References panel switches it: APA, Chicago, MLA, Harvard, IEEE and Vancouver come with the app.
- Any of the thousands of styles at zotero.org/styles works: put its `.csl` file in the vault and pick it there.
- A paper can say its own in its frontmatter, the way Pandoc reads it:

```yaml
title: "Paper machines"
author: Your name
bibliography: Library.bib
csl: chicago-author-date
```

## Literature notes
- Click a reference in the right sidebar (or in its card) to open its literature note: made the first time from the template in References' settings, with the reference written out, and your Zotero notes and PDF highlights, each linked back to its page.
- They go where your other literature notes are, else `Literature/`. Link them, quote them, cite them: they're notes like any other.

## Export and share
- Export to PDF (a note's menu) writes the citations in your style and adds the References at the end.
- Your notes stay plain Pandoc Markdown: `pandoc Paper.md --citeproc -o Paper.docx` makes a Word or LaTeX version with the same library and style.
- AI agents read your papers with the citations written out and the references listed, and find sources in your library by name.

## Making it yours
The panels are yours to move: right-click a sidebar to show Outline or Links, or hide what you don't use. References' settings choose the style, the files to read, the literature notes' folder and template. Your old layout is a click away in Settings, Appearance (or Back to Standard layout in the command palette), and this guide is yours to edit or delete.
