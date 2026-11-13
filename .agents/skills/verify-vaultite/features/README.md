# Vaultite verification map

What a user can do in Vaultite, one file per feature: how to reach it, how to drive it with `vv`, what proves it.

## Baseline
- `vv up` on a fresh sandbox (the sample vault: `Projects/Lighthouse.md`, `People/Alice Martin.md`, `Start here.md`,
  dated to today), `vv doctor` ok.
- Start each feature from its own `vv open '#...'`: a bare `vv open` shows whatever tab is kept. A feature that changes
  files says how to put them back, or needs a fresh `vv down`, `vv up`.

## Conventions
- Commands are literal: names and selectors as written.
- Roles and names first; the app's data attributes (`data-tree-path`, `data-tab-id`, `data-pane`) when there's no name.
- A tab hidden behind another stays in the page: scope what's in a pane to the shown one,
  `[data-pane-frame][data-focused] ...`.
- Setup through `vv vau` (an agent's write, a panel shown) is fine before the proof, never as it.
- Proof is the screen (`vv shot`, `vv aria --out`) and where it lasts (`vv vau read`, `vv vau tabs`, `vv vau appearance`).
- An entry point you couldn't reach is reported as unreached, with the command and what was missing: never as proved
  through another one.

## Features
- [Edit a note](./edit-note.md): typing in the editor saves to the file.
- [Rename a file](./rename-file.md): from the file tree's menu, links across the vault follow.
- [Theme](./theme.md): Settings' Appearance switches light and dark, kept in `.vaultite/appearance.json`.
- [Command palette](./command-palette.md): find a command by name and run it.
- [Tabs](./tabs.md): new, switch, close, reopen, pin, Undo on closing several, reorder by dragging.
- [Split panes](./split-panes.md): split right and down, open into and focus a pane, close one, split by dragging a tab.
- [File tree](./file-tree.md): fold folders, new folder and note, move by drag and Move file to…, delete with Undo.
- [Find notes](./find-notes.md): the quick switcher by name and text, search in a tab, opening a line.
- [Tasks in a note](./tasks.md): tick and untick boxes into the file, make tasks by slash, key and menu; Do it offered.
- [Links and backlinks](./links.md): follow, the link menu, `[[` suggestions, the Links panel and its Link button.
- [Settings](./settings.md): sections, search, a switch kept in `.vaultite/editor.json`, the palette, plugins off and on.
- [Daily notes](./daily-notes.md): today's and tomorrow's note, the Daily note panel, routines ticked on the Today page.
- [Inbox](./inbox.md): asks answered, results pinned and settled, a session's reply box, the keys.
- [Phone layout](./phone.md): the header, bar, drawer, back, tab cards at a phone's width.
