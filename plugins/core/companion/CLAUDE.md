# Notes for `plugins/core/companion/`

## One UI model
A thing on screen is one shape everywhere (`uimodel.ts`): role (ARIA's words), name, state (expanded, selected,
checked, disabled, focused, value), actions and the labelled things it's in, nearest first. Vaultite's window reads it
from its ARIA (`uidom.ts`: `domTree`, `domThings`, `resolveDom`, `domView`), other apps from Accessibility (the helper's
`near` in electron/screen.swift; `axThings` in electron/helper.ts, the `things` request, `takeovers().things()`). A
target resolves to the part that acts (`resolve`, `actingPart`); a condition is checked once against a View (`check`;
`parseCondition`, `conditionText`); `checkNow(ctx, name, condition)` (plugin.ts) checks one where an agent's last ask
was, what `companion check` runs. A control the app's UI gives no role, state or name is fixed there, in its ARIA (the
kit's components first), never with a case here.
