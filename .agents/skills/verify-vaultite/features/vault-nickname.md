# Vault nickname

A vault can show under a nickname instead of its folder's name, everywhere the app names it; the folder isn't renamed.

## Sub-features
- `nickname-sidebar`: the vault button's right-click and the vault menu, Set nickname….
- `nickname-manage`: a click on a vault's name in Manage vaults, or its row's … menu.
- `nickname-clear`: a blank field, back to the folder's name.

## How to get to it (user POV)
- The vault's name at the bottom of the left sidebar, or the palette's Set vault nickname….

## Driving it with vv
Preconditions:
- `vv doctor` ok, then `rm "$VAULT/.vaultite/sandbox.json"` (the playground has no nickname) and `vv open`.

- **Set.** `vv click --sel "[data-vault-button]" --right`, `vv menu "Set nickname…"`, `vv type Harbour`,
  `vv press Enter`. The button says Harbour; `vv eval 'document.title'` is `Harbour · Vaultite`.
- **Manage vaults.** `vv click --sel "[data-vault-button]"`, `vv menu "Manage vaults"`,
  `vv click --label "Set nickname for Harbour"`: a field in the row, the folder's name its placeholder.
- **Clear.** `vv press ControlOrMeta+a`, `vv press Backspace`, `vv press Enter`: the folder's name is back.
- **Kept.** `vv vau settings vault`: `name` while set, none once cleared.

## Gotchas
- Without its marker `vv doctor` says the vault isn't a sandbox: expected here.
- The desktop app's window title, Dock and menu: `npm run qa -- nickname`.
