# SheetJS Community Edition

SheetJS CE, the spreadsheet reader and writer (Apache License 2.0, `LICENSE` here, Copyright (C) 2012-present SheetJS
LLC, https://sheetjs.com), taken from its release tarball and kept here so the app installs nothing from SheetJS' CDN
(it isn't on the npm registry past 0.18.5: no registry signature, no `npm audit`). Not built here.

- Version: 0.20.3 (tag v0.20.3, 2024-07-18; the newest release on 2026-11-07, git.sheetjs.com/sheetjs/sheetjs)
- From: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- Tarball SHA-512: `oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==` (base64,
  the `integrity` package-lock.json had for it)
- Tarball SHA-256: 8dc73fc3b00203e72d176e85b50938627c7b086e607c682e8d3c22c02bb99fe8
- Taken: 2026-11-07

## What's here

- `xlsx.mjs`: the tarball's `package/xlsx.mjs` (the full ESM build: every format, Numbers' too), with the patches below.
  As released, SHA-256 `1a0fb062ee9781b13f6687371b202aaefc53b6ce55b530c027e01f9c087b77db`: that file is this one with
  the lines ending in `// vaultite: ...` removed (tools/test/vault/formats.ts checks it).
- `xlsx.d.mts`: the tarball's `package/types/index.d.ts`, as released (SHA-256
  `191e4e6aceae3602aa3a1e9a6bc0e98821d6d5fb787e2bc16e250439482bddb6`).
- `LICENSE`: the tarball's `package/LICENSE`, as released.

Left out: the CommonJS build (`xlsx.js`), `dist/` (minified and ExtendScript builds, their source maps, `cpexcel`'s
codepage tables, the Numbers writer's template `xlsx.zahl`), the CLI (`bin/`) and the worker sample. Without `cpexcel`,
old XLS and DBF files in a codepage other than Windows-1252 (BIFF5 and earlier, written before Excel 97) read their text
as Latin-1, on the server as already in the app (the ESM build never loaded it).

## Advisories

Both fixed before this version, per its CHANGELOG: CVE-2023-30533 (prototype pollution reading a file, fixed in
0.19.3) and CVE-2024-22363 (ReDoS, fixed in 0.20.2). OSV lists them against every npm `xlsx` version because the
registry stops at 0.18.5. CVE-2021-32012/32013/32014 were fixed in 0.17.0.

## Patches

Each is whole added lines ending in `// vaultite: <why>`, never a changed upstream line. All four were found by
reading thousands of corrupted workbooks (byte flips, cuts, splices) in every format SheetJS writes: in 0.20.3 a
corrupt file could loop forever or run the process out of memory (the server's: it reads workbooks for search, so one
bad file in a vault took it down). After them none did, and valid files (Excel's own, and every format written and
read back) read exactly as before.

1. `inflate`: stops with "Truncated or corrupt ZIP data" when it has read past the end of its input, or meets a code
   no Huffman table has. Before, a deflate stream with no final block (a cut or damaged xlsx, ods, xlsb or numbers)
   looped forever: past the end it reads zeros, which decode as empty blocks.
2. `inflate`: a declared uncompressed size bigger than deflate could make from the bytes left (at most ~1032 times) is
   ignored, the output grown as it's inflated. Before, a few-KB file could make it allocate 4 GB per ZIP entry.
3. `ReadShift`: throws "Corrupt file: read past the end of its data" once a read is more than 64 KB past the end of
   its record. Before, a corrupt count (an XLSB BrtMdb record's, for one) looped up to 2^31 times reading nothing and
   pushing results until out of memory. A lenient read a little past a short record's end still passes.
4. `parse_Rgce`: throws "Corrupt formula" when its offset or target is NaN (a formula record shorter than its formula's
   length). Before, `target != blob.l` with NaN never ended: a 28-byte BIFF2 file hung it.

Each has a test in tools/test/vault/formats.ts, on a file made to hit it.
