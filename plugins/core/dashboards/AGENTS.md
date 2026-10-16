## Dashboards
A dashboard is a page made of blocks: a Markdown file with `type: dashboard`, anywhere (a plugin turned on writes its
pages, Today, People..., once into the pages folder, `Dashboards/` by default: then they're the user's). Frontmatter: `icon` (any Lucide name: sun, users, guitar...; or an emoji),
`tint` (a colour: today, people, orange...), `plugin` (the plugin that brought it; the page hides from lists while that
plugin is off). No subtitle: a line of text before the first block says what the page is. The body is blocks, shown as a grid of cards: a block's
`wide: true` takes the whole row, `stack: true` puts it under the block before it; Markdown between blocks (a
`## Heading`, a line) takes a row. The user edits a page as it reads (⌘E keeps the grid: text typed in place, cards
dragged, added and removed, which writes the same fences). To change a page, edit its file: add, move or remove blocks. `vau dashboard restore` writes a plugin's page again
when its file is gone. To make a new page, write a dashboard (`vau dashboard new <Name>`) and pin it. Pick blocks from
`vau docs design`, which shows every one.
`/api/render` gives a dashboard as text: its title, then its blocks filled in.
