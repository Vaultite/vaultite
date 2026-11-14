# citeproc-js

citeproc-js, the Citation Style Language processor that formats citations and references (Copyright (c) 2009-2019 Frank Bennett, https://github.com/Juris-M/citeproc-js), taken from its repository at a commit and kept here as Zotero keeps it (`chrome/content/zotero/xpcom/citeproc.js`): the npm package `citeproc` stopped at 2.4.63 (2023-04-17), while its fixes go on landing upstream, most from Zotero's developers. Not built here.

Its licence is the CPAL 1.0 or the AGPL 3.0 (`LICENSE`); Vaultite takes it under the Common Public Attribution License 1.0 (`CPAL`, with `AGPLv3` beside it as the release has it). CPAL is file-level: it covers this folder's `citeproc.mjs` only, and a change to it is published under the CPAL (the line marked below is the only one).

- Commit: `56e7ef310154748368665cc8a2be124e3c141832` (2026-11-10, "Merge pull request #272 from zepinglee/issue#271"; the newest on 2026-11-14, the one Zotero took that day)
- From: https://raw.githubusercontent.com/Juris-M/citeproc-js/56e7ef310154748368665cc8a2be124e3c141832/citeproc.js
- Taken: 2026-11-14

## What's here

- `citeproc.mjs`: the commit's `citeproc.js` (the release build, a script defining `CSL`) with one line added at the end, ending in `// vaultite: ...`, that makes it an ES module. As released, SHA-256 `8d80b2d4ad5d249178ddfa4c535bb72bbd1883521a88e9362686558e2f82029d`: that file is this one with the marked line removed (tools/test/vault/references.ts checks it).
- `citeproc.d.mts`: ours, the types of the parts of its API the references plugin uses.
- `LICENSE` (SHA-256 `b96ca8e1716f93449b480083c7510c18d129fa9afa4644d62c6347c06177ce30`), `CPAL` (`a953615139d8c767eb5e95f14215bf5c356ea23397a15137f6e119babf3fe69b`) and `AGPLv3` (`57c8ff33c9c0cfc3ef00e650a1cc910d7ee479a8bc509f6c9209a7c2a11399d6`): the commit's, as released.

Left out: `citeproc_commonjs.js` (the same build ending in `module.exports = CSL`), the tests, locales and schemata.

## Updating

When Zotero takes upstream fixes (`git log -- chrome/content/zotero/xpcom/citeproc.js` in zotero/zotero), take that upstream commit's `citeproc.js`: replace `citeproc.mjs` with it plus the marked line, and update the commit, the date and the SHA-256 above. Take upstream's, never Zotero's copy: Zotero sometimes carries a fix before upstream merges it, and that copy is Zotero's change.
