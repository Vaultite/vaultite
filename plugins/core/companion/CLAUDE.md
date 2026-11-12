# Notes for `plugins/core/companion/`

## One UI model
A thing on screen is one shape everywhere (`core/desktop/uimodel.ts`): role (ARIA's words), name, state (expanded, selected,
checked, disabled, focused, value), actions and the labelled things it's in, nearest first. Vaultite's window reads it
from its ARIA (`uidom.ts`: `domTree`, `domThings`, `resolveDom`, `domView`), other apps from Accessibility (the helper's
`near` in electron/screen.swift; `axThings` in electron/helper.ts, the `things` request, `takeovers().things()`). A
target resolves to the part that acts (`resolve`, `actingPart`); a condition is checked once against a View (`check`;
`parseCondition`, `conditionText`); `checkNow(ctx, name, condition)` (inpanes.ts) checks one where an agent's last ask
was, what `companion check` runs. A control the app's UI gives no role, state or name is fixed there, in its ARIA (the
kit's components first), never with a case here.

## Its backend's parts
`plugin.ts` imports the last of its parts, and each part imports the one before it first, so they run in one order
(self.ts, settings.ts, state.ts ... people.ts) and its ops, hooks and services register in it. A new part joins that chain.
