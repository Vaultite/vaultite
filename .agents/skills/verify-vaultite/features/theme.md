# Theme

Settings' Appearance switches the app between system, light and dark; the choice is a vault preference other devices
follow.

## Sub-features
- `theme-pick`: the Theme radios in Settings, Appearance.
- `theme-kept`: the choice is in `.vaultite/appearance.json` (`vau appearance`).

## How to get to it (user POV)
- The gear at the bottom of the left sidebar, or the palette's Open settings; Appearance is first.

## Driving it with vv
Preconditions:
- `vv doctor` ok; the sample's theme is System.

- **Settings.** `vv open '#settings'`. `vv aria --sel "[data-pane]"` has a radiogroup `Theme` with `System` checked.
- **Dark.** `vv click --role radio --name Dark`. `vv eval 'document.documentElement.classList.contains("dark")'` is
  `true`; `vv shot theme-dark`.
- **Kept.** `vv vau appearance | grep theme`: `theme: "dark"`.
- **Back.** `vv click --role radio --name System`.

## Gotchas
- The sample's Colour scheme (Gruvbox) stays: theme is light or dark, scheme is the palette.
- Chromium's own colour scheme is light: System shows light.
