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
on: Vaultite plugins like today, people, logs), their order, `collapsedCategories` (the Plugins page's folded sections,
`<group>:<category>`: `core:navigation`, `vaultite:life`, `vault:other`), `index` (the plugin directory's address, an https URL; unset: Vaultite's). A
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
the buttons New note, Open a file, the command palette). `vau newtab` (show, hide, move; `button add`, `remove`,
`move`, `icon`); right-click a blank tab (or a button: Change icon) to change it there. The same on every device and workspace.

**Pinned pages**, `.vaultite/pages.json`'s `pinned`: `vau pin` / `vau unpin` (`vau docs pages`). Its `"install": false` (a vault
opened for the first time) puts the plugins' pages in `.vaultite/pages/` instead of among the user's files: drawn,
pinned and linked as usual, left out of the file tree. Moving one into a folder is fine: it's updated where it is.

**Hotkeys**, `.vaultite/hotkeys.json`: `{"<command id>": ["Mod+Shift+T"]}` (`Mod` is ⌘ on a Mac, Ctrl elsewhere;
`Ctrl`, `Alt`, `Shift`; `[]` takes a command's keys away); a command not listed keeps its defaults. A sequence is
steps separated by spaces, `["G G"]`, `["Space F F"]` (a step without `Mod`, `Ctrl` or `Alt` never fires while
typing). Settings > Hotkeys lists the commands and their ids. In the desktop app the menu bar shows the keys in
effect, these included.

**Appearance**, `.vaultite/appearance.json` (or `vau appearance <key> <value>`), one for every device:
- `theme`: `system` | `light` | `dark`. `scheme`: `gruvbox` (default), `default` (Classic: Apple's colours), `catppuccin`,
  `nord`, `dracula` (dark only), `solarized`, `tokyo-night`, `rose-pine`, `everforest`, `kanagawa`, `one`, `ayu`,
  `github`, `flexoki`, `amethyst`, `paper`, or
  `theme:<Name>` for a downloaded theme in `.vaultite/themes/<Name>/` (as downloaded: `manifest.json`, `theme.css`;
  only its colours carry over; `GET /api/themes` lists them).
- `density`: `compact` (default) | `comfortable`. `sidebarScroll`: `panels` (default: each panel scrolls in its own
  box, dividers between them set heights) | `sidebar` (the whole sidebar scrolls as one; `heights` ignored).
- `interfaceFont`, `textFont` (notes), `monoFont` (code): a font's name or a CSS font-family list; empty is the app's.
  `fileIcons`: true | false. `tabBar`: true (default) | false: off, each pane's bar shows only the tab on screen, not
  the row of tabs (switch with the Tabs panel, `tabs:tabs`, or the keyboard). `lineNumbers`: true | false (default), line numbers beside a file's text while editing
  it (code files always have them). `statusBar`: the plugins' items at the start of the desktop status bar, in order
  (`["today:routines", "terminal:agents"]`; unset: each plugin's default ones; right-click the bar for the list). No font size: the user zooms with ⌘+ and ⌘- (Ctrl off a Mac), and notes' and terminals' text sizes are
  each device's.
- `snippets`: the CSS snippets on, by name (`["Wide lines"]` is `.vaultite/snippets/Wide lines.css`). A snippet is
  CSS added after the app's; the colours are variables (`--background`, `--foreground`, `--card`, `--primary`,
  `--red`...), so `:root { --primary: #d33682; }` changes the accent; `--line-width` is a note's widest line (700px).
