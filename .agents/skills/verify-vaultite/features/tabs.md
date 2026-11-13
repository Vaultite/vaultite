# Tabs

Each open file or page is a tab in the bar above the panes: new, switch, close, bring back, pin, and reorder by
dragging. Closing several at once offers Undo.

## Sub-features
- `tab-new`: New tab adds a blank tab at the end and shows it; a file opened from it fills it.
- `tab-switch`: a click on a tab shows it and the address follows.
- `tab-close`: a tab's X closes it.
- `tab-reopen`: Reopen closed tab brings the last closed back in its place.
- `tab-pin`: a pinned tab shows a pin for its X, stays on Close all other tabs and only rests on Close current tab.
- `tab-close-others`: two or more closed at once toast `Closed N tabs` with Undo.
- `tab-menu`: a tab's right-click menu.
- `tab-drag`: a tab dragged onto another's left lands before it.

## How to get to it (user POV)
- The bar's `New tab` button, or the palette's Open new tab.
- Click a tab; its X on hover; right-click it for its menu.
- Palette: Reopen closed tab, Close current tab, Pin tab, Close all other tabs (`ControlOrMeta+Alt+w`).
- Drag a tab along the bar.

## Driving it with vv
Preconditions:
- `vv doctor` ok; `vv open '#file/Projects%2FLighthouse.md'`, then the palette's Close all other tabs: `vv vau tabs` is
  one line.

- **New.** `vv click --role button --name "New tab"`. `vv aria --sel "[data-tab-bar]"`: tabs `Lighthouse`, `New tab`
  [selected]. `vv press ControlOrMeta+o`, `vv type "Alice Martin"`, `vv press Enter`: `vv vau tabs` shows the second tab
  as `file:People/Alice Martin.md`, no third.
- **Another.** `vv press ControlOrMeta+p`, `vv type "Open new tab"`, `vv press Enter`, then `ControlOrMeta+o`,
  `Lisbon trip`, `Enter`: three tabs.
- **Switch.** `vv click --role tab --name Lighthouse`. `vv eval 'document.querySelector("[data-tab-bar]
  [role=tab][aria-selected=true]").textContent+" "+location.hash'`: `Lighthouse #file/Projects%2FLighthouse.md`.
- **Close.** `vv click --sel "[aria-label='Close Alice Martin']"`: `vv vau tabs` has no Alice Martin.
- **Reopen.** Palette `Reopen closed tab`: Alice Martin back second.
- **Menu.** `vv click --role tab --name Lighthouse --right`. `vv aria --sel "[role=menu]" --out tab-menu`: `Close`,
  `Close others`, `Close tabs to the right`, `Close all`, `Pin tab`, `Open in split right`...
- **Pin.** `vv menu "Pin tab"`. `vv vau tabs`: Lighthouse `(pinned)`; `vv eval '[document.querySelectorAll("[data-tab-pin]").length,
  !!document.querySelector("[aria-label=\"Close Lighthouse\"]")]'`: `[1, false]`.
- **Close others, Undo.** `vv click --role tab --name Lighthouse`, `vv press ControlOrMeta+Alt+w`. `vv eval
  '[...document.querySelectorAll("[data-sonner-toast]")].map(t=>t.innerText)'`: `Closed 2 tabs` with `Undo`. At once,
  `vv click --role button --name Undo`: `vv vau tabs` has all three again. `vv shot tabs-undo`.
- **Pinned rests.** Palette `Close current tab` on Lighthouse: it stays, the `*` moves to the next tab. Unpin it:
  `vv click --role tab --name Lighthouse --right`, `vv menu "Unpin tab"`.
- **Drag.** `vv drag --sel "[data-tab-bar] [data-tab-id]:has-text('Lisbon trip')" --to-sel "[data-tab-bar]
  [data-tab-id]:has-text('Lighthouse')" --at left`. `vv vau tabs`: Lisbon trip first.

## Gotchas
- In a browser Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab and Ctrl+1..9 are the browser's, not the app's (the desktop app
  only): use the palette's names.
- A tab's X and pin are `aria-hidden`: `--role button --name "Close ..."` finds nothing; use `--sel "[aria-label='Close
  <name>']"`. A lone blank tab has no X.
- A right-click doesn't show the tab: Close all other tabs keeps the shown one, so click the tab first.
- The toast comes only for two or more tabs closed at once, and goes after 8 s: Undo is the very next command.
- `vv open '#file/...'` on a fresh page may open the file as another tab beside the ones kept: close the others first.
- From a pinned tab, the quick switcher and links open beside it: open files before pinning.
- Nothing is written to the vault: `vv vau tabs` is where tabs show outside the screen.
