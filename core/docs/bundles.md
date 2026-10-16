## Bundles
A bundle is a whole setup of the app at once: which plugins are on, their settings, the sidebars' panels, the pinned
pages and the dashboards they need, the look, and optionally hotkeys and vault plugins. The user picks one on the
Bundles page (the command "Choose a bundle…", Settings > Setup, the Plugins page; a vault opened for the first time
starts from Minimal, core/start.ts, as does one skipping the offer), saves their own setup as one, and shares it as a file. The app's own: Minimal (`minimal`), Life OS
(`life-os`), Agents (`agent-cockpit`), and under More: Pages and databases (`pages`), Self-hosted on Tailscale
(`self-hosted`), Everything (`everything`, every plugin on).
- A bundle is a folder shaped like `.vaultite/`, plus the vault files it needs. The user's are in
  `.vaultite/bundles/<id>/` (the id is the folder's name):
  ```
  bundle.json        {"name": "Writing desk", "description": "One line on what it's for", "icon": "pen", "tint": "purple"}
  plugins.json       {"disabled": [every app plugin that's off], "enabled": [opt-in ones that are on: its vault plugins, built-ins off by default like today],
                      "install": {"tasks": {"name": "Tasks", "source": "Vaultite/plugins/tasks", "tag": "tasks/v1.0.1"}}: installed from there when applied}
  sidebars.json      the panels, as .vaultite/sidebars.json ({} is the default panels)
  pages.json         {"pinned": ["Dashboards/Desk.md", "Dashboards/Projects.md"]}
  appearance.json    {"theme": "system", "scheme": "everforest", "density": "comfortable"}
  hotkeys.json       optional
  newtab.json        what a new tab shows, as .vaultite/newtab.json (its `page`: a dashboard it brings, or a plugin's page)
  preview.png        its card's picture: a screenshot of the app it makes (the desktop app takes one when saving)
  plugins/<id>/data.json   a plugin's settings: only the keys that differ from its defaults
  plugins/<id>/      with a manifest.json: a vault plugin made in the vault that it brings (it runs code: applying asks the user, and their yes
                     allows it on that machine; one already in the vault keeps waiting until allowed on its own)
  themes/<Name>/, snippets/<name>.css   themes and CSS snippets it uses
  Dashboards/Desk.md any other file: a vault file at the same path (the dashboards it pins; Dashboards/ is the vault's
                     pages folder), added if there's none
  ```
  Each file is optional: a part left out stays as it is when the bundle is applied (no plugins.json: plugins aren't
  touched). `icon` is a lucide name, `tint` a colour's name. Settings marked "this machine's own" (who may reach it: allowUsers,
  allowRemote, a port) are never saved in a bundle nor set by one, and a number the user set higher (a history's days)
  is never lowered. Files may be text or not (an image, a font), up to 64 MB in all; one that can't be read is listed
  with why.
- **A look** is a bundle with only the look: appearance.json, newtab.json, themes, snippets, the dashboard its new tab
  shows, and its preview.png (no plugins.json, sidebars.json, pages.json, hotkeys.json, settings or vault plugins). It's
  applied over any setup, listed under Looks; "Save the look" (`vau bundle save <name> --look`) makes one. To make one
  from a picture (a screenshot someone shared): pick the scheme closest to its colours or write a theme
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
  asked (`--include`); `GET /api/bundles/<id>/share` lists the parts. A git repository is a bundle too: its folder at the
  top, or one `.bundle.json`; `vau bundle import owner/name` adds it (bundle.json's `from` keeps where), again updates it.
- `vau bundle list | show <id> | apply <id> | restore | save <name> | export <id> | import <file|owner/name> | delete <id>`, or the
  API: `GET /api/bundles`, `GET /api/bundles/<id>?workspace=<n>` (what applying would change: `plan`), `POST
  /api/bundles/<id>/apply {workspace}`, `POST /api/bundles/restore`, `POST /api/bundles {name, description, hotkeys,
  vaultPlugins, workspace}` (save the current setup), `GET /api/bundles/<id>/export` (`POST` with `{include, leave, all}`; one JSON file:
  `{"vaultite": "bundle", "format": 1, "id", "files": {"<path>": <JSON, text, or {"base64": ...} for bytes>}}`), `POST /api/bundles/import` (an export, or `{from}`).
- To make one for the user, write the folder (pick blocks for its dashboards from `vau docs design`), check it
  with `vau bundle show <id>`, and let them apply it: never apply one without asking, and never one that runs code.
