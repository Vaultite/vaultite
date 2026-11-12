# Vaultite verification map

What a user can do in Vaultite, one file per feature: how to reach it, how to drive it with `vv`, what proves it.

## Baseline
- `vv up` on a fresh sandbox (the sample vault: `Projects/Lighthouse.md`, `People/Alice Martin.md`, `Start here.md`,
  dated to today), `vv doctor` ok.
- Start each feature from `vv open` (the start page) unless it says otherwise; a feature that changes files says how
  to put them back, or needs a fresh `vv down`, `vv up`.

## Conventions
- Commands are literal: names and selectors as written.
- Roles and names first; the app's data attributes (`data-tree-path`, `data-tab-id`, `data-pane`) when there's no name.
- Proof is the screen (`vv shot`, `vv aria --out`) and where it lasts (`vv vau read`, `vv vau tabs`, `vv vau appearance`).
- An entry point you couldn't reach is reported as unreached, with the command and what was missing: never as proved
  through another one.

## Features
- [Edit a note](./edit-note.md): typing in the editor saves to the file.
- [Rename a file](./rename-file.md): from the file tree's menu, links across the vault follow.
- [Theme](./theme.md): Settings' Appearance switches light and dark, kept in `.vaultite/appearance.json`.
- [Command palette](./command-palette.md): find a command by name and run it.
