## Search
Finding files, in the app and for you. The quick switcher (⌘O, the sidebar's search field) finds things by name
(files, pages, people, notes, books, tags, running terminals, machines: whatever the plugins that are on add) and, under
"In files", files with the words inside them; the search tab (`view:search/<query>`) shows every matching line. Both,
`vau search` and `GET /api/search?q=` read Obsidian's search syntax:
- Plain words: every word in the file's name or text, any order, any case; a word matches part of a word.
- `"a phrase"` together, `-word` without it, `a OR b` either, `( )` groups, `/regex/` a regular expression.
- `file:` in the file's name, `path:` in its path (folders too), `content:` in its text only, `tag:#project` tagged
  (nested ones too), `line:(a b)` on one line, `block:(a b)` in one paragraph, `section:(a b)` under one heading,
  `task:x` / `task-todo:x` / `task-done:x` in a task (ticked or not; nothing after the colon: any), `match-case:X` /
  `ignore-case:x`, `[status]` has a property, `[status:seed]` its value has it (`[status:seed OR exploring]`).
- `GET /api/search?q=...&lines=5` adds each file's matching lines; `&context=N` lines around them, `&folder=Notes`,
  `&sort=relevance | name | name-desc | modified | modified-old | created | created-old`, `&case=1`. A query it can't
  read is a 400 saying why.
The search tab's options (match case, sort, collapse results, more context, explain search terms) are its settings,
below.
