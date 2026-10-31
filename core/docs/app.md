## Changing the app (settings, sidebars, new tab, hotkeys, appearance)
Every setting is a file in the vault, and the app follows a change to one at once: "hide the file tree and move
terminals up" is an edit. Change only the keys you mean to (the files may have others); keep them valid JSON. In the
app's terminal `VAULTITE=1` is set (with `VAULTITE_URL`, the server, and `VAULTITE_CLIENT`: `desktop`, `iphone` or `web`), and
`vau` reads and changes all of this.

**Three levels.** The vault is the user's things and how the app works (files, plugins on or off, appearance, hotkeys,
and the panels and pinned pages a new workspace starts with), the same on every device. A workspace (with Workspaces
on, `vau docs workspaces`) is a desk: its tabs, sidebars' panels, pinned pages, open folders, recent files, shared by
every device on it. A device keeps only which workspace it's on and its sidebars' widths and open state. `vau context`
says which workspace the user's window is on.

**Plugins**, `.vaultite/plugins.json`: `disabled` (app plugins off), `enabled` (vault plugins and off-by-default ones
on: the app's off-by-default ones like people, logs), `index` (the plugin directory's address, an https URL; unset: Vaultite's), `updates` (which installed plugins update on their
own: `vaultite`, the default, `all` or `off`) with `updatesOn` / `updatesOff` (plugin ids that do or don't, whatever it says). A
plugin's settings: `.vaultite/plugins/<id>/data.json` (`vau docs <id>`).

**Sidebar panels**, `.vaultite/sidebars.json`: each sidebar a stack of panels top to bottom, the folded ones, and the
heights the user dragged (px) with the sidebar's height then (`heightsAt`, so another screen draws them in proportion):
```
{"left": ["search:search", "pages:pages", "terminal:sessions", "files:files"], "right": ["outline:outline"],
 "collapsed": ["pages:pages"], "dock": ["buttons:buttons"], "heights": {"terminal:sessions": 180}, "heightsAt": 820}
```
`dock`: panels a phone draws as icons at its drawer's bottom instead of in the drawer (`vau panels dock`).
A panel's key is `<plugin id>:<name>`; one in neither sidebar is hidden (its plugin stays on); a right sidebar with
none takes no room. Without the file every panel is on the left in the app's order, but the ones a plugin hides until
asked (Links, Outline, Local graph, Recent files...). With Workspaces on each workspace may have its own (its `sidebars`), so change
the current one's: `vau panels` (move, hide, show, left, right, collapse, expand; `--vault` for sidebars.json). Phones
show the same two sidebars as drawers.

**A new tab's page**, `.vaultite/newtab.json`: its sections top to bottom, and the buttons of its Buttons section,
each a palette command by id (its name, icon and shortcut are the command's; `icons` gives one another icon, a Lucide
name or an emoji):
```
{"sections": ["terminal:sessions", "core:actions", "core:opened"], "actions": ["terminal:claude", "file:new", "palette:open"],
 "icons": {"file:new": "notebook-pen"}}
```
The app's sections are `core:actions` (the buttons), `core:opened` (files opened lately in the workspace) and
`core:changed` (the vault's recently changed files); plugins add theirs (`terminal:sessions`: the running terminals and
agents; `pages:tiles`: the pinned pages, on phones), and any sidebar panel is one too by its key (`recent:recent`,
`files:files`: `vau panels` lists them; drawn as in the sidebar, never in the default page). A section left out is hidden; a button whose command isn't there
now (its plugin off) isn't drawn. Unset: the default page (every section not hidden until asked, in the app's order;
the buttons New note, Open a file, the command palette). `page`: a file's path (a dashboard) drawn instead of the
sections, a start page of any blocks, changed like any dashboard (`vau newtab page Dashboards/Start.md`; `""` the
sections again; one that's gone gives them back). `vau newtab` (show, hide, move, page; `button add`, `remove`,
`move`, `icon`); right-click a blank tab (or a button: Change icon) to change it there. The same on every device and workspace.
`opens`: what ⌘T, the + buttons and the Tabs panel's New tab row open instead, `"switcher"` (the quick switcher as a launcher: the pick opens in a new tab) or a view's tab (`"view:web"`: a web page); `vau newtab opens`.

**Pinned pages**, `.vaultite/pages.json`'s `pinned`: `vau pin` / `vau unpin` (`vau docs pages`). A plugin turned on
writes its pages into the pages folder once, as the user's files (`vau docs dashboards`).

**Writes on its own**, `.vaultite/grants.json`: where each plugin may write outside `.vaultite/` when it acts on its own
(timers, schedules, hooks), as its manifest's `writes` declares: `{"activity": {"Recaps": "allowed"}}` ("not now":
asked and not given; "ask": a write wanted it, so the app asks). `vau plugin writes`, `vau plugin grant <id>` (ask the
user first). What the user or their agent asks for is never gated.

**Files**, `.vaultite/files.json` (the File explorer's settings): `attachmentFolder`, where pasted and uploaded files
go (a folder, `/` the top, `./` beside the note, `./name` a folder beside it; unset: Obsidian's `attachmentFolderPath`,
else `Attachments`); `excluded`, files left out of search, the graph and unlinked mentions and listed last in the quick
switcher, still files you open (each a path they start with, `Archive/`, or a `/regex/`; unset: Obsidian's
`userIgnoreFilters`; `[]` none); `samples`, folders of examples, not the user's data (`["Examples"]`): their files
have no kind, and tasks, Dataview and query blocks leave them out unless the query is in a file in that folder.

**Folders**, `.vaultite/folders.json`: where new files of a kind go, by its name in the API (`{"people": "Personal/People",
"days": "Journal", "dashboards": "Pages"}`); one unset goes where most of that kind's files are (daily notes: Obsidian's
daily notes folder). Each shows in its plugin's settings.

**Hotkeys**, `.vaultite/hotkeys.json`: `{"<command id>": ["Mod+Shift+T"]}` (`Mod` is ⌘ on a Mac, Ctrl elsewhere;
`Ctrl`, `Alt`, `Shift`; `[]` takes a command's keys away); a command not listed keeps its defaults. A sequence is
steps separated by spaces, `["G G"]`, `["Space F F"]` (a step without `Mod`, `Ctrl` or `Alt` never fires while
typing). Settings > Hotkeys lists the commands and their ids. In the desktop app the menu bar shows the keys in
effect, these included.

**Editor**, `.vaultite/editor.json` (`vau settings set editor '{"useTab": false}'`), one for every device; a key it
doesn't set is `.obsidian/app.json`'s, else Obsidian's default:
- `spellcheck`: true (default) | false. `useTab`: true (default: Tab indents with a tab) | false (with `tabSize`
  spaces). `tabSize`: 1 to 8 (default 4). A note already indented keeps its own (a tab or its spaces); these are for
  one that isn't.
- `autoPairBrackets`: true (default: `( [ {` and quotes close themselves) | false. `autoPairMarkdown`: true (default:
  `* _ ~ = `` ` `` typed over a selection wrap it, a backtick closes itself) | false.
- `readableLineLength`: true (default: a note's lines stop at `--line-width`) | false (the pane's width).
- `propertiesInDocument`: `visible` (default: Properties above the text, reading too) | `hidden` | `source` (the
  frontmatter as text in live preview).
- `showInlineTitle`: true (default: the file's name as a title at the top of every file, editable while editing) |
  false (only in the tab and the path bar; a sheet keeps it). Not read from Obsidian's.

**Appearance**, `.vaultite/appearance.json` (or `vau appearance <key> <value>`), one for every device. A key it doesn't
set is `.obsidian/appearance.json`'s when the vault has one (its base theme, theme, snippets on and fonts):
- `theme`: `system` | `light` | `dark` (Claude Code in the app's terminals starts in its ANSI theme of that mode, so it
  draws in the scheme's colours too). `scheme`: `gruvbox` (default), `default` (Classic: Apple's colours), `catppuccin`,
  `nord`, `dracula` (dark only), `solarized`, `tokyo-night`, `rose-pine`, `everforest`, `kanagawa`, `one`, `ayu`,
  `github`, `flexoki`, `amethyst`, `paper`, or
  `theme:<Name>` for a downloaded theme in `.vaultite/themes/<Name>/` or `.obsidian/themes/<Name>/` (as downloaded:
  `manifest.json`, `theme.css`; only its colours carry over; `GET /api/themes` lists them).
- `density`: `compact` (default) | `comfortable`. `animation`: `natural` (default, springy) | `snappy` | `off`.
  `sidebarScroll`: `panels` (default: each panel scrolls in its own
  box, dividers between them set heights) | `sidebar` (the whole sidebar scrolls as one; `heights` ignored).
  `panelDividers`: true | false (default), a line between the sidebars' panels. `quickTextSize`: true | false
  (default): ⌘/⌃ and the wheel, or a pinch, over a note or a terminal changes its text size.
- `interfaceFont`, `textFont` (notes), `monoFont` (code): a font's name or a CSS font-family list; empty is the app's.
  `fileIcons`: true | false. `tabBar`: true (default) | false: off, each pane's bar shows only the tab on screen, not
  the row of tabs (switch with the Tabs panel, `tabs:tabs`, or the keyboard). Vertical tabs are both: `tabBar` false and
  `tabs:tabs` at the top of the left sidebar (Show tabs in the sidebar does it, Show tabs on top undoes it). `paneTitles`: false (default) | true: with the tab bar off, that bar names the tab on screen; off, nothing is above a pane: a file's bar (or the Browser's) is its title row.
  `tabTint`: true | false (default): the active tab takes a light wash of its colour (a web page's container).
  `dimPanes`: true (default) | false: with the window split, the panes without the focus fade a little (web pages in the desktop app stay as they are).
  `rails`: true (default) | false: off, a hidden sidebar has no icon rail and slides in while the pointer is at its edge; `peekShade`: true | false (default), the page dims a little behind it. `typingFade`: true | false (default): the bars above files fade while typing, back when the pointer moves or at Escape. `translucent`: true | false (default): in the Mac and Windows 11 apps the desktop shows through the sidebars, tab bar and status bar, blurred, in the scheme's colours (`--translucent-tint`, 70% in light, 60% in dark, how much), pages solid; solid with Reduce transparency. `translucentPages`: true | false (default): with `translucent`, pages too (notes, terminals, canvases, the graph, the app's own pages) show the desktop, less than the chrome (`--translucent-page-tint`, 88% in light, 82% in dark); web pages, PDFs, images and video stay solid. `lineNumbers`: true | false (default), line numbers beside a file's text while editing
  it (code files always have them). `statusBar`: the desktop status bar's items, in order: the app's own (`core:view`,
  `core:words`, `core:characters`) and plugins' (`["terminal:agents", "core:view", "core:words", "token-count:tokens"]`;
  unset: every default one; `[]`: none, the bar a faint corner). Right-click the bar for the list, drag one to move it;
  the palette shows or hides each. `statusBarMore`: those of them kept in the bar's tray (its more button, which also holds what doesn't
  fit). `statusBarLeft`: those of them in the bar's left corner, by the left sidebar, as Vim draws its mode
  (`["companion:status", "vim:mode"]`; unset: the items that ask for it, Vim's mode and the companion); the rest are in
  its right corner, the file's. Drag one from corner to corner. `fileBar`: the plugins' items in a file's top bar, in order (`["dispatch:dispatch", "companion:presence"]`;
  unset: their default places); one dragged into a sidebar (or Move to sidebar) is a panel there, in `sidebars.json`.
  `sidebarHeader`: the plugins' items in the left sidebar's header, in order (`["workspaces:numbers"]`; unset: every one;
  `[]`: none). Right-click the header to show or hide each.
  `pullActions`: the three commands a page pulled down past its top offers on a phone, by palette command id: left,
  straight down (what a plain pull runs), right (`["file:new", "switcher:open", "tab:close"]`, the default; one left
  out or empty keeps its default).
  No font size: the user zooms with ⌘+ and ⌘- (Ctrl off a Mac), and notes' and terminals' text sizes are each device's.
- `snippets`: the CSS snippets on, by name (`["Wide lines"]` is `.vaultite/snippets/Wide lines.css`, else
  `.obsidian/snippets/`'s; the app never writes those). A snippet is
  CSS added after the app's; the colours are variables (`--background`, `--foreground`, `--card`, `--primary`,
  `--red`...), so `:root { --primary: #d33682; }` changes the accent; `--line-width` is a note's widest line (700px);
  `--font-heading` the titles' and large headings' font (unset: the font around them). A font file beside the snippets
  (`.woff2`, `.woff`, `.ttf`, `.otf`) loads by its name: `@font-face { src: url("Instrument Serif.woff2") }`.
