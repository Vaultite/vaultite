## Dashboards
A dashboard is a page made of blocks: a Markdown file with `type: dashboard` (the pages plugins bring are built in, in
`.vaultite/pages/Dashboards/`: Today, People...; make your own anywhere). Frontmatter: `icon` (any Lucide name: sun, users, guitar...; or an emoji),
`tint` (a colour: today, people, orange...), `plugin` (the plugin that brought it; the page hides from lists while that
plugin is off), `subtitle` (`{date}` is today's date). The body is blocks, shown as a grid of cards: a block's
`wide: true` takes the whole row, `stack: true` puts it under the block before it; Markdown between blocks (a
`## Heading`, a line) takes a row. To change a page, edit its file: add, move or remove blocks. A plugin's built-in page is read-only and updates with its
plugin: copy it into the vault first (`vau dashboard copy Today`; its pins and links follow the copy, which is then the
user's and no longer updates). To make a new page, write a dashboard (`vau dashboard new <Name>`) and pin it. Pick
blocks from the Design page (`.vaultite/pages/Dashboards/Design.md`), which shows every one.
`/api/render` gives a dashboard as text: its title, its subtitle, then its blocks filled in.
