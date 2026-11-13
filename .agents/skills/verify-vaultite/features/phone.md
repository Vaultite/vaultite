# Phone layout

Under 768px wide the app is the phone's: a header with the tab's name, a bar at the bottom (Back, Forward, New tab, the
tabs, Menu), the sidebar a drawer over the page, and one tab on screen at a time, the rest as cards in a sheet.

## Sub-features
- `phone-pick`: the width alone picks the layout, live (no reload).
- `phone-drawer`: Open sidebar slides the drawer in; a file in its tree opens in this tab and the drawer goes.
- `phone-back`: the bar's Back and Forward move through this tab's history.
- `phone-menu`: the bar's Menu lists New note, Search, Commands, Plugins, Settings.
- `phone-tabs`: the tabs button opens the cards (`/tabs` on the address), Done closes them.
- `phone-new-tab`: the bar's New tab adds a tab and shows it.

## How to get to it (user POV)
- A phone, or any window narrower than 768px.
- The header's Open sidebar (or `Control+\` with a keyboard), a tree row in the drawer.
- The bar: Back, Forward, New tab, `Open tabs: N`, Menu.

## Driving it with vv
Preconditions:
- `vv doctor` ok; `vv viewport phone` (`vv viewport desktop` after: it lasts till then).

- **Layout.** `vv open '#file/Start%20here.md'`. `vv aria --sel "[data-phone-header]"`: buttons `Open sidebar`, `More`;
  `vv aria --sel "[data-phone-bar]"`: navigation `Navigation` with `Back`, `Forward`, `New tab`, `Open tabs: N`, `Menu`.
- **Drawer.** `vv click --label "Open sidebar"`. `vv aria --sel "[data-phone-drawer]"`: dialog `Sidebar` with the tree.
- **Open a note.** `vv click --sel "[data-phone-drawer] [data-tree-path='Projects/Lighthouse.md']"` (Projects open
  first: click `[data-phone-drawer] [data-tree-path='Projects']`). `vv eval '[location.hash,
  !!document.querySelector("[data-phone-drawer]"), document.querySelector("[data-phone-title]").textContent]'`:
  `#file/Projects%2FLighthouse.md`, `false`, `Lighthouse`. `vv shot phone-note`.
- **Back.** `vv click --sel "[data-bar=back]"`: the hash is `#file/Start%20here.md`; `vv click --sel "[data-bar=forward]"`:
  Lighthouse again.
- **Menu.** `vv click --sel "[data-bar=menu]"`. `vv aria --sel "#bar-menu"`: menuitems `New note`, `Search`, `Commands`,
  `Plugins`, `Settings`. `vv press Escape`.
- **Tabs.** `vv click --sel "[data-tabs-button]"`: the hash ends `/tabs`; `vv aria --sel "dialog[open]" --out phone-tabs`:
  a button per tab (`Lighthouse`, `Close Lighthouse`...), `New tab`, `Done`. `vv shot phone-tabs`.
  `vv click --sel "dialog[open] [data-sheet-done]"`: `!!document.querySelector("[data-tab-row]")` is `false`.
- **New tab.** `vv click --sel "[data-bar=new]"`: the hash is `#new`, the tabs button one more; `vv vau tabs`: a new tab
  shown (`*`), its pane `new`.

## Gotchas
- `vv viewport phone` sizes the window, not a phone: no touch, so no `pointer: coarse` (44px rows) and no swipes (the
  drawer's edge, a card's swipe to close, pull-down). Taps are clicks; that's what QA does too.
- From a blank tab (`#new`) a file opens in its place: Back stays disabled. Open a note first, then another.
- `New tab`, `More` and `Back` each name more than one button (the bar's, the tabs sheet's, a row's): use the `data-`
  selectors above.
- The drawer slides out for about 250ms even under Reduce motion: check it's gone, not `aria-hidden`.
- A click on a disabled button (Back with nowhere to go) waits 30 s before it fails.
- Nothing is written to the vault: what lasts is the tabs (`vv vau tabs`).
