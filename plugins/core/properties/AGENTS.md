## All properties
Every frontmatter key in the vault's notes, with how many files have it and what kind of values (text, number,
checkbox, date, date & time, list, object): a sidebar panel (hidden until shown from the
sidebar's right-click menu) and a tab (`view:properties`). Nothing is stored. To rename a key in every file, or change
its type, use the API or `vau properties` (never a bulk find-and-replace: these change only that key's lines):
- `GET /api/properties` (`[{key, count, type, types}]`, most used first), `GET /api/properties?key=status` (its files
  and values).
- `POST /api/properties/rename {from, to}`: only the key's own text changes in each file; a file that already has `to`
  is skipped (`{changed, skipped}`).
- `POST /api/properties/retype {key, type}` (`text`, `number`, `checkbox`, `date`, `list`): converts the values that
  convert without loss; `changed` has each file's old value, and `POST /api/properties/restore {key, values}` puts them
  back.

A property can be pinned to files' headers as a chip, like `origin` (its menu in All properties: Show in files'
headers), in `.vaultite/plugins/properties/data.json`: `chips: [{key, values: [{value, label, icon, tint, hint}],
types, status_bar, show_unset}]`, in order. `types` limits it to kinds of file (`note` is a plain note; every Markdown
file when left out), `status_bar: true` shows it there too, `show_unset: false` hides it on files without the key.
Icons and tints as in Provenance's values. Clicking a chip writes the value (one key, a small edit); a value the list
doesn't have shows as written.

## Property types
A property's type is the vault's, not a file's: `.vaultite/types.json`, `{"types": {"due": "date", "rating": "number"}}`
(Obsidian's `.obsidian/types.json` the same, under it; `vau docs obsidian`). Types: `text`, `list`, `number`,
`checkbox`, `date` (`2026-09-01`), `datetime` (`2026-09-01 18:00`), `tags`, `aliases` (those two are implied), `link`
(`"[[Name]]"`). A key without one is its value's type. A type picks the editor's input (the icon before a key sets it),
adds a quiet note where a value isn't of it (under the property, and in italics in `/api/render`), and makes database
views sort and compare it as such (dates by time, numbers as numbers, text as text). Write values of their type; to
see or set them: `vau properties types` (`--check`: the values that aren't), `vau properties type due date` (only that
key's line; `none` removes it; the files aren't changed: `vau properties retype` converts their values).
