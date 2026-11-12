# Edit a note

Typing in a note's editor saves it to its Markdown file without a save step; reopened, the text is there.

## Sub-features
- `edit-type`: text typed in the editor is in the file once the app is idle.
- `edit-reopen`: the note opened again shows it.

## How to get to it (user POV)
- Click a note in the file tree, or open it from the palette (`ControlOrMeta+o`, its name), then click into the text.

## Driving it with vv
Preconditions:
- `vv doctor` ok; `Projects/Lighthouse.md` as the sample has it.

- **Open the note.** `vv open '#file/Projects%2FLighthouse.md'`. The pane shows the heading `Lighthouse`.
- **Type.** `vv click --sel "[data-pane] .cm-content"`, `vv press ControlOrMeta+End`, `vv type " Verified by vv."`.
- **Saved.** `vv idle`, then `vv vau read Projects/Lighthouse.md | tail -2`: the last line is ` Verified by vv.`
- **Reopened.** `vv open '#file/Start%20here.md'`, `vv open '#file/Projects%2FLighthouse.md'`,
  `vv eval 'document.querySelector("[data-pane] .cm-content").innerText.includes("Verified by vv")'` is `true`.
  `vv shot edit-note`.

## Gotchas
- `ControlOrMeta+End` lands on the file's last line, after its final newline: the typed text starts a line.
- Until `idle`, the text may be typed and not yet saved (autosave waits a moment): read the file after it.
- The editor's lines aren't in the ARIA tree (its textbox has only the blocks' buttons): read them with `eval`.
- Changes the sample: `vv down`, `vv up` before a feature that reads `Lighthouse.md`.
