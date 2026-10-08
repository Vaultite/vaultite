## Dashboards
A dashboard is a page made of blocks: a Markdown file with `type: dashboard` (the pages plugins bring are in
`Dashboards/`, or wherever the user moved them: Today, People...; make your own anywhere). Frontmatter: `icon` (any Lucide name: sun, users, guitar...; or an emoji),
`tint` (a colour: today, people, orange...), `plugin` (the plugin that brought it; the page hides from lists while that
plugin is off), `subtitle` (`{date}` is today's date). The body is blocks, shown as a grid of cards: a block's
`wide: true` takes the whole row, `stack: true` puts it under the block before it; Markdown between blocks (a
`## Heading`, a line) takes a row. To change a page, edit its file: add, move or remove blocks. To make a new page,
write a dashboard (`vau dashboard new <Name>`) and pin it. The app never changes a page by itself: a plugin's newer
version is offered (`vau dashboard updates`, `diff`, `update`, `dismiss`; ask before updating one the user changed),
and a page the user deleted isn't brought back. Pick blocks from `Dashboards/Design.md`, which shows every one.
`/api/render` gives a dashboard as text: its title, its subtitle, then its blocks filled in.
