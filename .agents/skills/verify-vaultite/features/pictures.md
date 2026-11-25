# Pictures

An image, a diagram or a video is zoomed and panned where it shows, or in the viewer a click opens.

## Sub-features
- `image-tab`: an image's tab shows all of it; a click zooms to 100% at the pointer, a drag moves it, keys and buttons step.
- `note-viewer`: an image in a note opens the viewer; Escape closes it, Open in new tab opens its tab.
- `diagram-viewer`: a diagram's Look closer (editing) or a click on it (reading) opens the viewer.

## How to get to it (user POV)
- Click an image in the file tree; or an image or a diagram in a note.

## Driving it with vv
Preconditions:
- `vv doctor` ok; an image larger than the window in the vault (`vv vau files` lists none in the sample: write one first).

- **Open it.** `vv open '#file/<path>.png'`. `[data-zoom-view]` has no `data-zoomed`.
- **Zoom.** `vv click --sel "[data-zoom-view] img"`, `vv eval 'document.querySelector("[data-zoom-tools] span").textContent'`
  is `100%`. `vv press Shift+Digit1`: `data-zoomed` is gone. `vv shot pictures`.
- **In a note.** `vv open '#file/<note>.md'`, `vv click --sel ".cm-image"`: the address ends `/viewer/<path>`.

## Gotchas
- `web/qa/viewer.mjs` drives what vv can't (wheel, pinch, fingers).
