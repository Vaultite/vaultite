## Bundles
A bundle is a whole setup of the app at once: which plugins are on, their settings, the sidebars' panels, the pinned
pages and the dashboards they need, the look, and optionally hotkeys and vault plugins. The user picks one on Setup's
Bundles tab (Setup is beside Settings at the sidebar's foot, its other tab Plugins; a new vault starts from Standard),
saves their own setup as one, shares it as a file or a repository, and imports others' (Import, or pasting or dropping
one on the page: its preview first).
The app's own: Standard (`standard`, the app's defaults: notes and links, a terminal and Claude Code), Zen (`zen`: the
sidebars hide until the pointer reaches the window's edge, no tab bar, Glance), Life OS (`life-os`: days, people, health,
books, and pages and databases over them).
- A bundle is a folder shaped like `.vaultite/`, plus the vault files it needs. The user's are in
  `.vaultite/bundles/<id>/` (the id is the folder's name):
  ```
  bundle.json        {"name": "Writing desk", "description": "One line on what it's for", "icon": "pen", "tint": "purple",
                      "guide": "Guides/How Writing desk works.md"}: guide is a note it brings saying in plain words how the setup
                      works (its pages, where things go, how to start); opened after applying, and skippable like any file
  plugins.json       {"disabled": [every app plugin that's off], "enabled": [opt-in ones that are on: its vault plugins, built-ins off by default like people],
                      "install": {"tasks": {"name": "Tasks", "source": "Vaultite/plugins/tasks", "tag": "tasks/v1.0.1", "commit": "<sha>", "hash": "<its files'>"}}:
                      installed from there when applied, at that commit (tags move), refused unless its files hash to that (the lock's);
                      one of the app's own plugins that moved to Vaultite's plugins, named in `enabled`, is installed from there too}
  sidebars.json      the panels, as .vaultite/sidebars.json ({} is the default panels)
  pages.json         {"pinned": ["Dashboards/Desk.md", "Dashboards/Projects.md"]}
  appearance.json    {"theme": "system", "scheme": "everforest", "density": "comfortable", ...}: the app's and saved ones say every key
  editor.json        the editor's settings, as .vaultite/editor.json ({"propertiesInDocument": "hidden"}): saved ones say those the app's set
  hotkeys.json       optional
  newtab.json        what a new tab shows, as .vaultite/newtab.json (its `page`: a dashboard it brings, or a plugin's page)
  preview.png        its card's picture: a screenshot of the app it makes (the desktop app takes one when saving)
  preview-dark.png   the same in dark, shown while the app is dark (each picture stands in for the other)
  plugins/<id>/data.json   a plugin's settings: those that differ from its defaults (saved: also the ones the app's bundles set)
  plugins/<id>/      with a manifest.json: a vault plugin made in the vault that it brings (it runs code: applying asks the user, and their yes
                     allows it on that machine; one already in the vault keeps waiting until allowed on its own)
  themes/<Name>/, snippets/<name>.css   themes and CSS snippets it uses, and the fonts the snippets load
  Dashboards/Desk.md any other file: a vault file at the same path (the dashboards it pins; Dashboards/ is the vault's
                     pages folder), added if there's none
  ```
  Each file is optional: a part left out stays as it is when the bundle is applied (no plugins.json: plugins aren't
  touched). `icon` is a lucide name, `tint` a colour's name. Settings marked "this machine's own" (who may reach it: allowUsers,
  allowRemote, a port) are never saved in a bundle nor set by one, and a number the user set higher (a history's days)
  is never lowered. Files may be text or not (an image, a font), up to 64 MB in all; one that can't be read is listed
  with why.
- A bundle of only some parts changes only those: one with just appearance.json (and themes, snippets) restyles any
  setup. To match a picture (a screenshot someone shared): pick the scheme closest to its colours or write a theme
  (`.vaultite/themes/<Name>/`), its fonts, and a snippet for the rest (`vau docs app`, Appearance).
- Applying makes small edits: the plugin switches that change, the keys its files set (a value of the look, the editor or a
  setting that is the default removes the key), one pin at a time, and the files it brings only where there's none (nothing is ever
  deleted). A plugin it turns on writes its pages, as turning it on does (those already on don't: Standard over a new
  vault adds none); a plugin's page it pins (`Dashboards/Today.md`) is written if the pages folder has none. Pins become the
  bundle's pages, then the user's own as they were; dashboards the app brings (plugins' and its own bundles') that it
  doesn't pin are unpinned, the files kept. Panels and pins become the vault's defaults
  (sidebars.json, pages.json) and the workspace the user is on follows them (its own panels go; its own pins get the
  same edits); other workspaces keep theirs, and tabs aren't touched.
- What it changed is kept in `.vaultite/bundles/previous.json` until the next apply: "Restore previous setup" (the
  toast's Undo, the Bundles tab, `vau bundle restore`) puts each key, pin and panel back and trashes the files it added if
  they're unchanged.
- Each change of a plan has an id (`changes` in `bundle.show`: `install:<plugin>`, `plugin:<plugin>`,
  `setting:<plugin>.<key>`, `panels`, `file:<path>`, `pin:<path>`, `pins:order`, `appearance:<key>`, `editor:<key>`,
  `hotkey:<command>`, `newtab:<key>`), the same for the same bundle and setup. Applying with `skip` leaves those out (nor kept to restore);
  `vau bundle fork <id> --skip ...` saves the bundle without them as "<Name> (mine)" (a value skipped is the current
  one, still said; a pin, file or plugin skipped is left out). In the app each is a ticked line of the bundle's
  preview: unticked, Apply and Try leave it out, and Save as "<Name> (mine)" forks it (an install unticked takes its
  plugin with it; a plugin's files and the page a pin needs go with theirs).
- The bundle applied last (`.vaultite/bundles/applied.json`, with what it skipped) is in use; once the setup changes,
  `GET /api/bundles` gives it `modified` and `differs` (the ids that would apply). Applying it again puts it back;
  `vau bundle save --over <id>` keeps the changes: over one of the user's (its name, card and `from` kept), or as
  "<Name> (mine)" for one of the app's. Saving makes the bundle saved the one in use. In the app its card says In use ·
  modified (its tip names what differs), and its preview offers Save changes (Save as "<Name> (mine)" for the app's)
  and Revert.
- Trying one (`apply --trial`, `.vaultite/bundles/trial.json`; Try on its preview): `vau bundle keep` ends it as an
  apply; restore puts back the setup from before. Another applied while trying ends the trial, and restore still goes
  back to before it. Meanwhile every window shows a bar at its foot, "Trying <Name>", with Revert and Keep.
- A bundle is in use (`inUse` in `GET /api/bundles`, "In use" on its card) while applying it would change nothing: a
  new vault's Standard, until a setting it sets changes.
- Saving names the installed plugins that are on by their source (`install`); the vault's own go as files only when
  asked. A plugin's page as it wrote it goes by its name (`Dashboards/Today.md`), other pinned dashboards as files. Sharing (export, Copy) leaves out its picture, pages with the user's own text and pins to their notes, unless
  asked (`--include`). A git repository is a bundle too: its folder at the top, or one `.bundle.json`;
  `vau bundle import owner/name` adds it (bundle.json's `from` keeps where). Getting it again is an update: its preview
  (`changes`: files added, changed, removed; installs re-pinned) says what's different, and it replaces the user's copy
  only with `replace` (`--replace`), never applied (a card's Check for updates… opens that preview).
- **A bundle's link**: once its file is in a public GitHub repository (one `.bundle.json` at its top, or the bundle's
  folder there), `https://vaultite.com/b/<owner>/<name>` (`/<folder>` after it for one in a folder of the repository)
  is a page that shows it and runs it live in the web demo, on its made-up vault: the visitor's browser fetches it from
  GitHub, and the demo leaves out what needs the app (terminals, agents) and plugins it installs (they run code). Its
  Open in Vaultite is `vaultite://bundle/<owner>/<name>`, which opens in the Mac and iPhone apps on its import preview:
  nothing is added or applied until the user does. The share sheet's Link copies it.
- **The directory**: `vau bundle browse [words]` (`GET /api/bundles/browse?q=`) lists shared bundles from the plugin
  directory's index: GitHub repositories with the topic `vaultite-bundle` (the bundle's folder at the top, or one
  .bundle.json) and those Vaultite/plugins' `directory/listed.json` names (`bundles`: owner/name or owner/name/folder),
  each pinned at the commit that last changed it. Its `address`, `owner/name[/folder]@<commit>`, imports exactly that
  commit (`vau bundle import <address>`), kept in bundle.json's `from`; `imported` names the user's bundle from the same
  place, `current` whether it's at that commit. The blocklist leaves one out. Setup's Bundles tab lists them under Get bundles (with
  a search), each Imported or Update available; opening one is its import preview at that commit.
- `vau bundle --help` (each is an op, `POST /api/ops/bundle.<name>`). An export is one JSON file:
  `{"vaultite": "bundle", "format": 1, "id", "files": {"<path>": <JSON, text, or {"base64": ...} for bytes>}}`.
- To make one for the user, write the folder (pick blocks for its dashboards from `vau docs design`) and its guide, check it
  with `vau bundle show <id>`, and let them apply it: never apply one without asking, and never one that runs code.
