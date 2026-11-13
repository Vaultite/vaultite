# Links and backlinks

A `[[link]]` in a note opens its file; typing `[[` suggests files to link; a link's right-click menu opens, copies, edits
or removes it. The Links panel lists what links to the open file (linked mentions), where its name is written without a
link (unlinked mentions, each with a Link button), and what it links to (outgoing).

## Sub-features
- `follow`: a click on a link opens its file in the same tab.
- `link-menu`: Open in new tab, Copy link, Edit link, Remove link, More file actions.
- `suggest`: `[[` and a few letters list files; Enter inserts `[[Name]]`.
- `panel-show`: the Links panel, shown from a sidebar's menu, is kept in `.vaultite/sidebars.json`.
- `panel-lists`: Linked mentions, Unlinked mentions, Outgoing links, each with its count.
- `panel-link`: an unlinked mention's Link rewrites that file with `[[Name]]`.
- `panel-open`: a row opens its file, and the panel follows it.
- `links-tab`: the palette's Open links in right split shows the panel as a pane.

## How to get to it (user POV)
- Click a link in a note; right-click it for its menu; type `[[` in a note.
- Right-click a sidebar's heading (`Pinned`), Panels, More, Links.
- Palette: Open links in a tab, Open links in right split.

## Driving it with vv
Preconditions:
- `vv doctor` ok; the sample's `Projects/Lighthouse.md` links `Alice Martin`, `Lighthouse pitch`...; the Links panel
  hidden.
- `W='[data-pane-frame][data-focused] .cm-content .cm-line [data-wiki'`;
  `G='[...document.querySelectorAll("aside [data-links-panel] [data-links-group]")].map(g=>g.dataset.linksGroup+" "+g.querySelector("[data-count]")?.textContent)'`.

- **Links.** `vv open '#file/Projects%2FLighthouse.md'`. `vv eval "[...document.querySelectorAll('$W]')].map(e=>e.dataset.wiki)"`:
  `Lighthouse launch checklist`, `Alice Martin`, `Bob Carter`, `Launch plan.canvas`, `Lighthouse pitch`.
- **Follow.** `vv click --sel "$W='Alice Martin']"`: the hash is `#file/People%2FAlice%20Martin.md`, `vv vau tabs` one tab.
  `vv click --role button --name "Navigate back"`: Lighthouse.
- **Menu.** `vv click --sel "$W='Lighthouse pitch']" --right`. `vv aria --sel "[role=menu]" --out link-menu`: `Open in new
  tab`, `Copy link`, `Edit link`, `Remove link`, `More file actions`. `vv menu "Copy link"`: a toast `Copied the link`.
  Again, `vv menu "Open in new tab"`: `vv vau tabs` has `file:Projects/Lighthouse/Lighthouse pitch.md`, shown.
- **Suggest.** `vv click --role tab --name Lighthouse`, `vv click --sel "[data-pane-frame][data-focused] .cm-content"`,
  `vv press ControlOrMeta+End`, `vv type "[[Bob Car"`: `vv aria --sel ".cm-tooltip-autocomplete"` has `Bob Carter People`.
  `vv press Enter`: `vv vau read Projects/Lighthouse.md | tail -1` is `[[Bob Carter]]`.
- **Panel.** `vv click --text Pinned --right`, `vv menu Panels More Links`, then `vv press Escape` till
  `vv eval 'document.querySelectorAll("[role=menu]").length'` is 0. `vv vau panels`: `backlinks:links (Links)` in the
  left sidebar. `vv aria --sel "aside [data-links-panel]" --out links-panel`; `vv eval "$G"`: `linked 4`, `unlinked 5`,
  `outgoing 5`.
- **Link a mention.** `vv click --sel "aside [data-links-group='unlinked'] [data-link-item='Alice Martin'] [data-link-action]"`:
  `vv vau read "People/Alice Martin.md" | grep icons` has `the [[Lighthouse]] icons`; `$G`: `linked 5`, `unlinked 4`.
- **Open from it.** `vv click --sel "aside [data-links-group='linked'] [data-link-item='ME']"`: the hash is `#file/ME.md`
  and `aside [data-links-for='ME.md']` is there.
- **As a pane.** `vv open '#file/Projects%2FLighthouse.md'`, palette `Open links in right split`: `vv eval
  'document.querySelector("[data-links-view] h1")?.textContent'` is `Lighthouse`; `vv vau tabs`: `split of 2`, one pane
  `view:links`. `vv shot links-split`.

## Gotchas
- A click into a line shows its links as source, where a plain click places the caret: follow and right-click links
  before typing in the note.
- Type `[[Bob Car`, not `[[Bob`: `Bob` is an alias and would insert `[[Bob Carter|Bob]]`. Wait for the list before Enter.
- The Panels submenus stay open after a pick: Escape until no `[role=menu]` is left, or the next click hits the menu's
  backdrop.
- An unlinked mention's Link is shown on hover only, and named `Link`: select it by `[data-link-item]`.
- Unlinked mentions are listed newest first and the sandbox dates its files to today: don't count on their order.
- The journal's unlinked mention is the name inside its tag `#lighthouse/launch`, not text: link Alice Martin's.
- vv has no clipboard permission: prove Copy link by its toast.
- Changes `Projects/Lighthouse.md`, `People/Alice Martin.md`, `.vaultite/sidebars.json`: `vv down`, `vv up` after it.
