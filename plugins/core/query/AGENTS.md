## Database views
A ```` ```block-query ```` in any file (a dashboard, a note) lists the files that match, like a database:
the files are the data, so there's nothing to keep in sync. Options, as YAML inside the fence:
````
```block-query
title: Friends to call
from: People/
type: person                # its `type:` (none, in a kind's folder: that kind's)
tags: [University]          # frontmatter tags or #tags in the text
where: "relation = friend and every_days <= 30"
filters: 'file.mtime > now() - "1 week"'   # a Bases filter (below), with the where
formulas:                   # computed columns, formula.<name>
  overdue: if(every_days, (now() - file.mtime) / 86400000 > every_days, false)
columns: [file, relation, location, every_days, formula.overdue]
properties: {formula.overdue: {displayName: Overdue}}
summaries: {every_days: Average}
sort: [-every_days, file]
group: relation
groups: [family, friend]
view: table
limit: 50                   # every match when left out
archived: true
```
````
- `where`: `=` `!=` `<` `<=` `>` `>=` `contains`, joined with `and` / `or` / `not` and `( )`, plus `has <key>`
  (the key has a value). Values: numbers, `'quoted text'`, a bare word (`friend`, `2026-09-01`, `true`), or `this` /
  `this.<key>` (below). Text compares without case, `[[Alice Park]]` equals `Alice Park`, a list matches when any value
  does (`tags contains AI`), dates compare as text (YYYY-MM-DD) unless the key has a type (`vau docs properties`: then
  dates by time, numbers as numbers, text as text, in `sort` too). Or a map: `where: {relation: [friend, family]}`
  (every key; a list: any value).
- Keys are frontmatter keys, plus `file` (the name), `folder`, `path`, `updated` (modified) and `created`; the Bases
  way works too: `note.status`, `file.name`, `file.mtime`, `file.size`, `file.tags`, `formula.overdue`.
- Columns left out: the name and the keys most matches have. In the app a heading sorts (only there), a row opens its
  file and a double-click on a plain value changes that property in the file (not a formula's or a file property).
- `summaries`: `Sum`, `Average`, `Min`, `Max`, `Median`, `Range`, `Stddev`, `Earliest`, `Latest`, `Checked`,
  `Unchecked`, `Empty`, `Filled`, `Unique`, `Count` (any case), or an expression over `values` (the column's values in
  the rows shown: `values.filter(value > 10).length`). Shown under a table's column; grouped, each group has its own.
- `view: board` is a column per value of `group` (it needs one, like `group: status`), the `groups` listed first
  (shown even when empty), then the others, then "No value"; each card shows its name and `columns`. Moving a card to
  another column (drag it, or its … menu) writes that one key in its file (No value removes it).
- `view: calendar` is a month by a date key, `date: started` (default `date` when the matches have one, else
  `created`); `month: 2026-09` picks the month (default this one; the app's arrows only change what's shown). It lists
  only that month's files. Dragging an item to another day rewrites the date (a time after it stays).
- `view: map` puts a pin per file where its `coordinates` key says (`coordinates: note.place`; default `coordinates`:
  `[lat, lon]`, or text `"lat, lon"`, like People's), coloured by `markerColor` (a key: an app colour's name like
  `green`, or any CSS colour) with `markerIcon` (a key: a lucide icon's name). Files without one are listed under it.
- To see what it lists: `GET /api/render?path=<the file>` (a Markdown table, summaries in a last row), or
  `GET /api/query?q=<the options as JSON or YAML>` (`limit` and `offset` page it; `{columns, groups: [{name, value, rows: [{path, title, values,
  pin}], summaries}], total, shown, summaries, notes}`, plus `group` for a board and `date`, `month` for a calendar,
  whose groups are its days; a bad query is a 400 saying why). As text a board is a `### column (count)` section per
  column with a bullet per file, a calendar its month with a `- YYYY-MM-DD · [[file]]` bullet per file, a map a
  bullet per file with its coordinates. `notes` (in italics as text) say what was left out: a filter or a formula that
  doesn't parse, a function that doesn't exist.
### `this`: a view about the note it's in
`this` is the note a view is drawn in: the file the block is in, or, when that file is embedded in another
(`![[Related]]`), the note embedding it (the nearest one); on a dashboard, the dashboard; with `file:`, that file. So
one note holding a view, embedded in many, shows each of them its own:
````
```block-query
title: Linked here
where: "file.links contains this"   # what links to the note (dynamic backlinks); file.backlinks contains this: what it links to
```
````
`project = this` (a property naming it: `[[Lighthouse]]`, a path or an alias), `status = this.status` (the same value as
its own; `this.file`, `this.folder`, `this.tags` too), `{project: this}` in a map. Quoted, `'this'` is the word. In
`filters` it's Bases' `this` (`file.hasLink(this.file)`). As text (`/api/render`) it's the same note; asked directly:
`/api/query?q=...&this=<path>`, `vau query --where "..." --this <note>` (the note itself isn't listed).

Database views leave out the Templates folder's notes (patterns, not things) unless `from` names it, archived files
unless `archived: true` (how many are hidden is said), and the file the view is in. A .base lists every file, templates
and archived ones too, as in Obsidian. "New database" in the file tree's menu makes a note named after the folder (`Recipes
database.md`) with a table of it (`from: Recipes/`), in the folder, or where new notes go when it's a kind's (People/,
Logs/...).

### Bases (`*.base`)
A `.base` file is YAML that the app draws as its views (a tab per view; Source shows the YAML), in the shape other
Markdown apps write it, so they read it too:
```
filters:                     # every view's; a view's own `filters` apply too (and)
  and:
    - file.inFolder("Books")
    - 'status != "dropped"'
formulas:
  left: total_pages - current_page
properties:
  formula.left: {displayName: Pages left}
summaries:                   # summary formulas a view can name (`values`: the column's values)
  rounded: values.mean().round(1)
views:
  - type: table              # table | cards | list | kanban (a board) | map | calendar (this app's)
    name: Reading
    filters: 'status == "reading"'
    order: [file.name, author, formula.left]      # the columns
    sort: [{property: formula.left, direction: DESC}]
    groupBy: {property: note.status, direction: ASC}   # a kanban's columns
    limit: 20
    summaries: {formula.left: Sum, note.current_page: rounded}
    coordinates: note.coordinates   # a map's pins; markerColor, markerIcon too
```
- Filters: an expression, or `and` / `or` / `not` (none of them true) lists of filters, nested. A base without filters
  lists every file of the vault, attachments too (`file.ext == "md"` keeps notes).
- Embed one in any note or dashboard: `![[Books.base]]` (its first view), `![[Books.base#Reading]]` (that view); `this`
  is the note then. Or inline, a ```` ```base ```` fence with the same YAML in a note (`this`: the note).
- "New base" (palette, the file tree's menus) makes one listing that folder; `/base` puts a fence in the note. In its
  tab, editing, the … menu changes a view's layout, adds a view, puts one first (what an embed shows) or deletes one:
  small edits that keep everything else (comments, keys this app doesn't know).
- Read one: `GET /api/render?path=Books.base` (every view, a table each), `GET /api/query?base=Books.base&view=Reading`
  (one view, as JSON, with `views` and `current`), or `GET /api/query?q={"base": "<its YAML>", "show": "Reading"}`.
- A layout this app doesn't draw (a community plugin's) is a table, with a note; view settings it doesn't use
  (`rowHeight`, `cardSize`, `image`, a map's `defaultZoom`...) are kept and ignored.

### Expressions (filters, formulas, summaries)
Bases' language: `'text'` or `"text"`, numbers, `true` / `false` / `null`, `[lists]`, `{"objects": 1}`,
`/regex/`; `+ - * / %`, `== != > < >= <=`, `! && ||`, `( )`, `x.field`, `x[0]`, `x["key"]`. Names are properties
(`status`, `note.status`, `note["due date"]`; a dash in a name is part of it, so write a minus with spaces), `file`,
`formula.x`, `this`, and in `filter` / `map` / `reduce` `value`, `index`, `acc` (in a summary `values`). A `"[[link]]"`
in a property is a link; text that is a date acts as one where a date is expected (compared with one, `+ "1w"`,
`.format()`). Dates are this machine's time; `date - date` is milliseconds.
- Global: `if`, `now`, `today`, `date`, `duration`, `link`, `file`, `list`, `number`, `min`, `max`, `random`, `image`,
  `icon`, `html`, `escapeHTML`.
- `file`: `name` (with its extension), `basename`, `path`, `folder`, `ext`, `size`, `ctime`, `mtime`, `tags`, `links`,
  `embeds`, `backlinks`, `properties`; `hasTag()` (nested count), `inFolder()`, `hasLink()`, `hasProperty()`, `asLink()`.
- Text: `length`, `contains`, `containsAll`, `containsAny`, `startsWith`, `endsWith`, `isEmpty`, `lower`, `upper`,
  `title`, `trim`, `replace` (text: every one; a regex: its flags), `repeat`, `reverse`, `slice`, `split`.
- Numbers: `abs`, `ceil`, `floor`, `round(digits)`, `toFixed`. Dates: `year`, `month`, `day`, `hour`, `minute`,
  `second`, `millisecond`, `date()`, `format("YYYY-MM-DD")` (Moment's tokens), `time()`, `relative()`; `+` / `-` a
  duration (`"1d"`, `"2 weeks"`, `"1M"`: months; `"m"`: minutes).
- Lists: `length`, `contains`, `containsAll`, `containsAny`, `filter`, `map`, `reduce`, `flat`, `join`, `reverse`,
  `slice`, `sort`, `unique`, `isEmpty`, and for summaries `sum`, `mean`, `min`, `max`, `median`. Links: `asFile()`,
  `linksTo()`. Objects: `keys`, `values`, `isEmpty`. Regexes: `matches`. Any value: `isTruthy`, `isType`, `toString`.
- Not supported (a note says so): functions other apps' plugins add, `html()` and `image()` drawn as such (they show
  as text). Property types (types.json) sort a view's columns; inside expressions a value is read by how it looks (text
  that looks like a date or a link is one).
