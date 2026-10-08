## Templates (`Templates/<Name>.md`)
Notes the user starts new notes from ("New note from template") or puts into the one they're writing ("Insert
template", or `/` in the editor). Any Markdown file in `Templates/` (the folder is `folder` in
`.vaultite/plugins/templates/data.json`) is one; write them like any other file of their kind. When one is used,
`{{title}}` (the new file's name), `{{date}}`, `{{time}}` (in data.json's `dateFormat`, `timeFormat`: YYYY-MM-DD, HH:mm)
and formats like `{{date:dddd D MMMM}}` are filled in, and
`id`, `created` and `updated` (and an old `added`) are left out so the new file gets its own. A new note goes to the folder where
files of its `type` live (a `type: person` template: People), else next to the open file, else where new notes go. Files in
`Templates/` are plain notes whatever their `type`: nothing reads them as people or logs.
