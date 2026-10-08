## Vim
Vim's keys in the whole app, off until turned on: `vau plugin on vim` (it's listed in `enabled` in
`.vaultite/plugins.json`), `vau plugin off vim`. Every device with a mouse or trackpad gets it;
phones type as usual, and each device can turn it on or off for itself (Vim's settings, On this device).
- In the editor: Vim's modes, motions, registers, macros and `/` search, plus `]]` / `[[` (headings), `gl` / `gL`
  (links), `gf` (follow a link; `gF` new tab, `K` to the right, `gx` browser), folds (`za`, `zc`, `zo`, `zM`, `zR`)
  and `:` commands that drive the app: `:e <name>`, `:tabe <name>`, `:sp`, `:vs`, `:q`, `:only`, `:bn`, `:bp`, `:new`,
  `:cmd <command id or name>` (also `:obcommand`), `:vimrc`, `:help`.
- Outside the editor: `j` / `k` scroll (or move in the file tree and the sidebar's lists), `d` / `u` half a page,
  `gg` / `G`, `]]` / `[[`, `f` link hints, `/` find, `:` the command line, `?` the keys, `i` edit where you're reading
  (or, on a note in editing, back into its text).
  Space is the leader (`Space F F` the quick switcher...) and `Ctrl+W h/j/k/l` moves between panes. These are commands
  (ids `vim:*`, or keys Vim gives the app's commands), so `.vaultite/hotkeys.json` rebinds them.
- Reading and editing are one mode for every file (⌘E switches every pane). Switching to editing, or opening a note in
  editing (⌘O, `gf`, `:e`, the file tree), puts the cursor in its text in normal mode: where it was left in that file
  when that's in sight, else the first line in sight. Back to reading, `j` / `k` scroll the page again.
- Settings, `.vaultite/plugins/vim/data.json` (each on unless false): `{"app": false}` turns Vim's keys outside the
  editor off, `{"leader": false}` Space as the leader, `{"clipboard": false}` yanking to the system clipboard.
- The vimrc, `.vaultite/plugins/vim/init.vim`: Vim commands run in every editor before you type, one per line, `"`
  for a comment: `map`, `nmap`, `vmap`, `imap`, `noremap`, `nnoremap`... (`<leader>` is `let mapleader = ","`, `\` by
  default), `unmap`, `mapclear`, `set <option>`, `exmap <name> <command line>`. The app's `:` commands work in
  mappings: `nmap <leader>s :cmd switcher:open<CR>`. A `.obsidian.vimrc` (Vimrc Support's) can be copied in as it is
  (lines it can't run, like `surround`, are reported). It runs again when the file changes.
