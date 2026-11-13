# Split panes

A tab splits into panes side by side or stacked; a file opened goes to the pane with the focus, keys move the focus
between panes, and a pane closes without the others moving. The bar shows a split tab as one chip with a half per pane.

## Sub-features
- `split-right`, `split-down`: the same file again in a new pane beside or below, the new one focused.
- `split-open`: a file opened (quick switcher, tree, link) fills the focused pane; the address follows it.
- `split-focus`: `Alt+Shift+Arrow` moves the focus to the pane on that side.
- `split-close`: Close pane (palette, `ControlOrMeta+Alt+Shift+KeyW`, the pane's X) leaves the rest.
- `split-reopen`: Reopen closed tab brings a closed pane back.
- `split-drag`: a tab dropped on a pane's side splits it.

## How to get to it (user POV)
- Right-click a tab: Split right, Split down (Open in split right for a tab not shown).
- Palette: Split right (`ControlOrMeta+d`), Split down (`ControlOrMeta+Shift+KeyD`), Close pane, Close split.
- A pane's X at the end of its strip (on hover).
- Drag a tab onto a pane's side.

## Driving it with vv
Preconditions:
- `vv doctor` ok; `vv open '#file/Projects%2FLighthouse.md'`, then the palette's Close all other tabs.
- `P='[...document.querySelectorAll("[data-pane-area] > section[data-pane-frame]:not([data-away])")].map(s=>s.getAttribute("aria-label")+(s.hasAttribute("data-focused")?"*":"")+"@"+Math.round(s.getBoundingClientRect().x))'`:
  the panes, focused one starred, and where each starts.

- **Split right.** `vv click --sel "[data-tab-strip] [data-tab-id] [role=tab]" --right`, `vv menu "Split right"`.
  `vv eval "$P"`: `Lighthouse`, `Lighthouse*`. `vv vau tabs`: `split of 2`, `>` on the new pane.
- **Open in it.** `vv press ControlOrMeta+o`, `vv type "Alice Martin"`, `vv press Enter`. `$P`: `Lighthouse`,
  `Alice Martin*`; `vv eval location.hash` is `#file/People%2FAlice%20Martin.md`.
- **Focus.** `vv press Alt+Shift+ArrowLeft`: `$P` stars Lighthouse; the hash is Lighthouse's.
- **Split down.** `vv press ControlOrMeta+Shift+KeyD`: three panes, two of them `Lighthouse` at the same x;
  `vv aria | grep "Resize the split"` has two separators; `vv vau tabs`: `split of 3`. `vv shot split-three`.
- **Close pane.** `vv press Alt+Shift+ArrowUp`, palette `Close pane`: two panes. `vv click --sel
  "[data-pane-frame][data-focused] [data-pane-close]"`: one; `vv vau tabs` one line.
- **Reopen.** Palette `Reopen closed tab`: two panes again. `vv press ControlOrMeta+Alt+Shift+KeyW`: one.
- **Drag.** With a second tab (`New tab`, then `ControlOrMeta+o` `Lisbon trip` `Enter`): `vv drag --sel "[data-tab-bar]
  [data-tab-id]:has-text('Alice Martin')" --to-sel "[data-pane-frame][data-focused] [data-pane-body]" --at right`.
  `$P`: `Alice Martin*@760`, `Lisbon trip@240`; `vv vau tabs`: one tab, `split of 2`. `vv shot split-drag`.

## Gotchas
- Focus keys need the keyboard in a pane. After a tree click it's in the sidebar, where `ControlOrMeta+d` is Duplicate
  the row (a copy of the file). Open with the quick switcher, or click a pane's tab, before split or focus keys.
- Don't click a pane's middle to focus it: a link there opens in it.
- `$P` lists panes in the page's order, not the screen's: read the x. `vv vau tabs` lists them in the split's tree order.
- `[data-pane-body]` alone may be a hidden tab's (0 wide): scope it to a shown pane, as above.
- Focus left from the leftmost pane goes into the left sidebar, not round.
- On the web, Close pane is `ControlOrMeta+Alt+Shift+KeyW` (Ctrl+W is the browser's).
- Splits change no file: what lasts is `vv vau tabs`. Close them (palette Close split) before another feature.
