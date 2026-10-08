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
  plugins.json       {"disabled": [every app plugin that's off], "enabled": [opt-in ones that are on: its vault plugins, Vaultite plugins like today]}
  sidebars.json      the panels, as .vaultite/sidebars.json ({} is the default panels)
  pages.json         {"pinned": ["Dashboards/Desk.md", "Dashboards/Projects.md"]}
  appearance.json    {"theme": "system", "scheme": "everforest", "density": "comfortable"}
  hotkeys.json       optional
  plugins/<id>/data.json   a plugin's settings: only the keys that differ from its defaults
  plugins/<id>/      with a manifest.json: a vault plugin it brings (it runs code: applying asks the user, and their yes
                     allows it on that machine; one already in the vault keeps waiting until allowed on its own)
  themes/<Name>/, snippets/<name>.css   themes and CSS snippets it uses
  Dashboards/Desk.md any other file: a vault file at the same path (the dashboards it pins), added if there's none
  ```
  Each file is optional: a part left out stays as it is when the bundle is applied (no plugins.json: plugins aren't
  touched). `icon` is a lucide name, `tint` a colour's name. Settings marked "this machine's own" (who may reach it: allowUsers,
  allowRemote, a port) are never saved in a bundle nor set by one.
- Applying makes small edits: the plugin switches that change, the keys its files set (an appearance value that is the
  default removes the key), one pin at a time, and the files it brings only where there's none (nothing is ever
  deleted). Pins become the bundle's pages, then the user's own as they were; dashboards the app brings (plugins' and
  its own bundles') that it doesn't pin are unpinned, the files kept. Panels and pins become the vault's defaults
  (sidebars.json, pages.json) and the workspace the user is on follows them (its own panels go; its own pins get the
  same edits); other workspaces keep theirs, and tabs aren't touched.
- What it changed is kept in `.vaultite/bundles/previous.json` until the next apply: "Restore previous setup" (the
  toast's Undo, Settings, `vau bundle restore`) puts each key, pin and panel back and trashes the files it added if
  they're unchanged.
- `vau bundle list | show <id> | apply <id> | restore | save <name> | export <id> | import <file> | delete <id>`, or the
  API: `GET /api/bundles`, `GET /api/bundles/<id>?workspace=<n>` (what applying would change: `plan`), `POST
  /api/bundles/<id>/apply {workspace}`, `POST /api/bundles/restore`, `POST /api/bundles {name, description, hotkeys,
  vaultPlugins, workspace}` (save the current setup), `GET /api/bundles/<id>/export` (one JSON file:
  `{"vaultite": "bundle", "format": 1, "id", "files": {"<path>": <JSON or text>}}`), `POST /api/bundles/import`.
- To make one for the user, write the folder (pick blocks for its dashboards from `Dashboards/Design.md`), check it
  with `vau bundle show <id>`, and let them apply it: never apply one without asking, and never one that runs code.
