## Bundles
A bundle is a whole setup of the app at once: which plugins are on, their settings, the sidebars' panels, the pinned
pages and the dashboards they need, the look, and optionally hotkeys and vault plugins. The user picks one on the
Bundles page (Your setup, atop Settings' menu; a new vault starts from Standard), saves their own setup as one, shares
it as a file or a repository, and imports others' (Import, or pasting or dropping one on the page: its preview first).
The app's own: Standard (`standard`, the app's defaults: notes and links, a terminal and Claude Code), Life OS
(`life-os`: days, people, health, books, and pages and databases over them), Agents (`agent-cockpit`: coding agents in
terminals, their activity, other machines and the server).
- A bundle is a folder shaped like `.vaultite/`, plus the vault files it needs. The user's are in
  `.vaultite/bundles/<id>/` (the id is the folder's name):
  ```
  bundle.json        {"name": "Writing desk", "description": "One line on what it's for", "icon": "pen", "tint": "purple"}
  plugins.json       {"disabled": [every app plugin that's off], "enabled": [opt-in ones that are on: its vault plugins, built-ins off by default like people],
                      "install": {"tasks": {"name": "Tasks", "source": "Vaultite/plugins/tasks", "tag": "tasks/v1.0.1"}}: installed from there when applied;
                      one of the app's own plugins that moved to Vaultite's plugins, named in `enabled`, is installed from there too}
  sidebars.json      the panels, as .vaultite/sidebars.json ({} is the default panels)
  pages.json         {"pinned": ["Dashboards/Desk.md", "Dashboards/Projects.md"]}
  appearance.json    {"theme": "system", "scheme": "everforest", "density": "comfortable"}
  hotkeys.json       optional
  newtab.json        what a new tab shows, as .vaultite/newtab.json (its `page`: a dashboard it brings, or a plugin's page)
  preview.png        its card's picture: a screenshot of the app it makes (the desktop app takes one when saving)
  plugins/<id>/data.json   a plugin's settings: only the keys that differ from its defaults
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
- Applying makes small edits: the plugin switches that change, the keys its files set (an appearance value that is the
  default removes the key), one pin at a time, and the files it brings only where there's none (nothing is ever
  deleted). A plugin's page it pins (`Dashboards/Today.md`) is written if the pages folder has none. Pins become the
  bundle's pages, then the user's own as they were; dashboards the app brings (plugins' and its own bundles') that it
  doesn't pin are unpinned, the files kept. Panels and pins become the vault's defaults
  (sidebars.json, pages.json) and the workspace the user is on follows them (its own panels go; its own pins get the
  same edits); other workspaces keep theirs, and tabs aren't touched.
- What it changed is kept in `.vaultite/bundles/previous.json` until the next apply: "Restore previous setup" (the
  toast's Undo, Settings, `vau bundle restore`) puts each key, pin and panel back and trashes the files it added if
  they're unchanged.
- Saving names the installed plugins that are on by their source (`install`); the vault's own go as files only when
  asked. A plugin's page as it wrote it goes by its name (`Dashboards/Today.md`), other pinned dashboards as files. Sharing (export, Copy) leaves out its picture, pages with the user's own text and pins to their notes, unless
  asked (`--include`). A git repository is a bundle too: its folder at the top, or one `.bundle.json`;
  `vau bundle import owner/name` adds it (bundle.json's `from` keeps where), again updates it.
- **A bundle's link**: once its file is in a public GitHub repository (one `.bundle.json` at its top, or the bundle's
  folder there), `https://vaultite.com/b/<owner>/<name>` (`/<folder>` after it for one in a folder of the repository)
  is a page that shows it and runs it live in the web demo, on its made-up vault: the visitor's browser fetches it from
  GitHub, and the demo leaves out what needs the app (terminals, agents) and plugins it installs (they run code). Its
  Open in Vaultite is `vaultite://bundle/<owner>/<name>`, which opens in the Mac and iPhone apps on its import preview:
  nothing is added or applied until the user does. The share sheet's Link copies it.
- `vau bundle --help` (each is an op, `POST /api/ops/bundle.<name>`). An export is one JSON file:
  `{"vaultite": "bundle", "format": 1, "id", "files": {"<path>": <JSON, text, or {"base64": ...} for bytes>}}`.
- To make one for the user, write the folder (pick blocks for its dashboards from `vau docs design`), check it
  with `vau bundle show <id>`, and let them apply it: never apply one without asking, and never one that runs code.
