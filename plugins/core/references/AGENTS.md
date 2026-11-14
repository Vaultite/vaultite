## References
The user's reference library is every source at once, the first having a citekey winning: a note's own
`bibliography:` files, the vault's bibliography files (BibTeX `.bib`, RIS `.ris`, CSL JSON or YAML: the settings' list
and, on their own, every .bib and .ris and library-named JSON or YAML), Zotero (the app on the server's computer, live;
the zotero.org library with a key set by `vau references zotero-key`), then reference notes. A work under two keys with
one DOI is one reference. Find keys with `references.search`; never make one up.

Citations are Pandoc's, written in the note's text:
- `[@ahrens2017]`, `[@ahrens2017, p. 33]`, `[see @ahrens2017, pp. 33-35; @luhmann1981, chap. 2]`: in brackets, several
  with `;`, a prefix before the key and a locator (`p.`, `pp.`, `chap.`, `sec.`, `fig.`, `para.`...) after a comma.
- `[-@ahrens2017]`: the year only (the author is named in the sentence). `@ahrens2017 says` or `@ahrens2017 [p. 33]
  says`: the author in the text; outside brackets only a key the library has is a citation (`@alice` is a mention).
- `@{key with spaces}` for an odd key. Citations in code are text.

A note's frontmatter may say its own `bibliography:` (a path or a list, from the note's folder or the vault's top),
`csl:` (a style: `apa`, `chicago-author-date`, `modern-language-association`, `harvard-cite-them-right`, `ieee`,
`nlm-citation-sequence`, or a `.csl` file in the vault, a journal's from zotero.org/styles) and `lang:` (en-US unless a
`locales-<lang>.xml` from the CSL project is in the vault). `::: {#refs}` then `:::` on their own lines place the
references; else they go at the end. `/api/render` (`vau render`) shows the citations formatted and the references.

A reference note (a literature note) is `type: reference` with its `citekey`; it's where notes on a work go. The app's
own have the reference's `title`, `author` (a list of "Family, Given") and `issued` (a year or a date) for reading; one
added by DOI, arXiv id or ISBN (`references.add`) holds every CSL field (`item-type: article-journal`,
`container-title`, `volume`, `issue`, `page`, `publisher`, `publisher-place`, `DOI`, `URL`, `ISBN`...), which makes it
the library's record of that work. Make one with `references.note`: from the template in the settings, with Zotero's
notes and PDF annotations when the reference is in Zotero. Write its body as any note; don't change its citekey.
