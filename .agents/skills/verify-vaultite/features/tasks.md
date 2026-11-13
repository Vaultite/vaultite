# Tasks in a note

A `- [ ]` line in a note's editor is a checkbox: a click ticks it in the file (`- [x]`), and the line is struck
through. Tasks are made by typing, the slash menu, `ControlOrMeta+l` or the editor's Paragraph menu. An open task offers
Do it, which hands it to an agent.

## Sub-features
- `task-tick`, `task-untick`: a click on the box writes `x` or a space on its own line.
- `task-undo`: `ControlOrMeta+z` puts the box back.
- `task-key`: `ControlOrMeta+l` (Toggle checkbox status) makes the caret's line a task, then ticks it.
- `task-slash`: `/check`, Enter inserts `- [ ] `; Enter after a task starts the next one.
- `task-menu`: right-click, Paragraph, Task list.
- `task-outside`: a file changed outside redraws its boxes in place.
- `doit-shown`: each open task has a Do it button (on hover) and a Do it menu item; none on done tasks.

## How to get to it (user POV)
- Open a note with tasks and click a box; type `- [ ] `, `/check`, or `ControlOrMeta+l` on a line.
- Right-click a line: Paragraph, Task list; Do it on an open task.

## Driving it with vv
Preconditions:
- `vv doctor` ok; the sample's `Projects/Lighthouse/Lighthouse launch checklist.md` (two done, `Ask [[Dave Kim]]...`
  and `Post the launch thread` open) and `Notes/Lisbon trip.md`.
- `T='[data-pane-frame][data-focused] input.cm-task'`, `F="Projects/Lighthouse/Lighthouse launch checklist.md"`.

- **Boxes.** `vv open '#file/Projects%2FLighthouse%2FLighthouse%20launch%20checklist.md'`. `vv eval
  "[...document.querySelectorAll('$T')].map(b=>b.checked+':'+b.ariaLabel)"`: `true:Done`, `true:Done`,
  `false:Not done`, `false:Not done`.
- **Do it shown.** `vv click --sel "[data-pane-frame][data-focused] .cm-line:has-text('Post the launch thread')" --right`:
  `vv aria --sel "[role=menu]"` has `Do it`. `vv press Escape` (never choose it).
- **Tick.** `vv click --sel "$T:not(:checked)"`: `vv vau read "$F"` has `- [x] Ask [[Dave Kim]] for a last look`; the
  eval reads three `true`. `vv shot task-ticked`.
- **Untick, undo.** `vv click --sel "$T >> nth=2"`: `- [ ] Ask [[Dave Kim]]...`. `vv press ControlOrMeta+z`: `- [x]` again.
- **Key.** `vv click --sel "[data-pane-frame][data-focused] .cm-line:has-text('Post the launch thread')"`,
  `vv press ControlOrMeta+l`: `- [x] Post the launch thread`.
- **Slash.** `vv open '#file/Notes%2FLisbon%20trip.md'`, `vv click --sel "[data-pane-frame][data-focused] .cm-content"`,
  `vv press ControlOrMeta+End`, `vv type /check`: `vv aria --sel ".cm-tooltip-autocomplete"` has option `Checklist`.
  `vv press Enter`, `vv type "Pack sunscreen"`, `vv press Enter`, `vv type "Buy a SIM"`. `vv vau read "Notes/Lisbon trip.md" | tail -2`:
  `- [ ] Pack sunscreen`, `- [ ] Buy a SIM`. `vv press ControlOrMeta+l`: `- [x] Buy a SIM`.
- **Menu.** `vv click --sel "[data-pane-frame][data-focused] .cm-line:has-text('Visiting')" --right`,
  `vv menu Paragraph "Task list Ctrl+Shift+9"`: `- [ ] Visiting [[Alice Martin]] for a week.`
- **Outside.** `vv vau edit "Notes/Lisbon trip.md" --old "- [ ] Book flights" --new "- [x] Book flights"`, `vv idle`:
  the eval's first box is `true` without reopening. `vv shot task-lisbon`.

## Gotchas
- Do it starts a real agent session: show it's offered, never choose it.
- A line's text includes its Do it button's: `--text "Post the launch thread"` finds nothing; select the line with
  `.cm-line:has-text(...)`.
- With the caret on a task's marker the raw `- [ ]` shows and that line has no box: counts drop by one.
- `--label "Not done"` matches the first box on the page, a hidden tab's too: scope to `$T`.
- A menu row with a shortcut is named with it (`Task list Ctrl+Shift+9` off a Mac): `vv menu` needs the whole name.
- Changes the sample: `vv down`, `vv up` after it.
