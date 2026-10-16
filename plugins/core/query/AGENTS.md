## Database views (bases)
A database view is Obsidian's Bases: the files that match, as a table, cards, a list, a board, a calendar or a map.
The files are the data, so there's nothing to keep in sync. Three ways to place one, all the same YAML:
- A `.base` file (`Books.base`): the app draws its views as tabs (Source shows the YAML).
- An embed in any note or dashboard: `![[Books.base]]` (its first view), `![[Books.base#Reading]]` (that view).
- A ```` ```base ```` fence in a note: the base inline. On a dashboard `wide: true` (top level) takes the whole row.
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
    name: Reading            # its tab, and its title in a fence
    filters: 'status == "reading"'
    order: [file.name, author, formula.left]      # the columns
    sort: [{property: formula.left, direction: DESC}]
    groupBy: {property: note.status, direction: ASC}   # a kanban's columns
    limit: 20
    summaries: {formula.left: Sum, note.current_page: rounded}
```
- Filters: an expression, or `and` / `or` / `not` (none of them true) lists of filters, nested. Usual ones:
  `file.inFolder("People")` (subfolders too), `type == "person"` (its type, as the app knows it), `file.hasTag("ai")`
  (nested tags count), `file.ext == "md"` (notes only), `!file.inFolder("Templates")`.
- A base lists every file outside hidden folders, as in Obsidian: attachments, templates and `archived: true` ones too,
  but not the file it's in. Archive folders (`.archive/`) only with a view's `archived: true` (`only`: only archived).
- Columns left out: the name and the keys most matches have. In the app a heading sorts (only there), a row opens its
  file and a double-click on a plain value changes that property in the file (not a formula's or a file property).
- Keys this app adds to a view: a `kanban` is a column per value of `groupBy`
  (and No value), `groups: [idea, building]` first, even empty; moving a card (drag, or its … menu) writes that key.
  A `calendar` is a month by `date: started` (default `date`, else `created`), `month: 2026-09` to start there;
  dragging an item to another day rewrites the date. A `map` pins each file at `coordinates: note.place` (default
  `coordinates`: `[lat, lon]` or `"lat, lon"`), coloured by `markerColor` (an app colour's name or a CSS colour), with
  `markerIcon` (a lucide name).
- `summaries`: `Sum`, `Average`, `Min`, `Max`, `Median`, `Range`, `Stddev`, `Earliest`, `Latest`, `Checked`,
  `Unchecked`, `Empty`, `Filled`, `Unique`, `Count` (any case), or an expression over `values`.
- "New base" (palette, the file tree's menus) makes a `.base` listing that folder, "New database" a note with a fence
  of it; `/base` puts a fence in the note. In a `.base`'s tab, its … menu changes a view's layout, adds a view, puts one
  first (what an embed shows) or deletes one: small edits that keep everything else (comments, unknown keys).
- A layout this app doesn't draw (a community plugin's) is a table, with a note; settings it doesn't use (`rowHeight`,
  `cardSize`, `image`...) are kept and ignored.

### `this`: a view about the note it's in
`this` is the note a view is drawn in: the note with the fence, or, when that note is embedded in another
(`![[Related]]`), the note embedding it; for an embedded `.base`, the note embedding it. So one note holding a view,
embedded in many, shows each of them its own: `file.hasLink(this.file)` (what links to the note), `project == this`
(a property naming it), `status == this.status` (the same value as its own).

### Reading one, and `vau query`
- `GET /api/render?path=<file>`: a fence or embed as a Markdown table under its view's name (a kanban a section per
  column, a calendar a bullet per day, a map a bullet per file with its place); a `.base`, every view.
- `GET /api/query?base=Books.base&view=Reading` (one view as JSON, with `views` and `current`), or
  `?q={"base": "<its YAML>", "show": "Reading"}` (`this=<path>` sets `this`). A bad base is a 400 saying why; `notes`
  say what was left out (a filter that doesn't parse, a function that doesn't exist).
- `vau query` (MCP `query`, `POST /api/ops/query.run`) asks the same engine with flags: `--from People/ --type person
  --where "relation = friend and every_days <= 30" --columns file,relation --sort=-every_days --group relation`. Its
  `where`: `=` `!=` `<` `<=` `>` `>=` `contains`, `and` / `or` / `not`, `( )`, `has <key>`; values are numbers,
  `'quoted text'` or a bare word; text compares without case and `[[Alice Park]]` equals `Alice Park`. It leaves out
  templates, archived files (`--archived` shows them) and `--this <note>` itself.

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
