// What the server asks a window for, by action (its commands, the dev tools: core/dev.ts), answered by core/live.ts.
// Imports nothing: modules register at load inside import cycles (live.ts' own), and a leaf is always set up first.

/** An action's answer: the result, sent back (an error's message if it throws). `ended` aborts when the server stops
 *  waiting (answered elsewhere). */
export type Asker = (m: Record<string, unknown>, ended: AbortSignal) => unknown
const askers = new Map<string, Asker>()
export const answerUi = (action: string, fn: Asker) => { askers.set(action, fn) }
/** A plugin's answer to an ask ("<plugin id>:<name>", its `answers`). Set by the app, which knows the plugins. */
let pluginAsker: (action: string) => Asker | null = () => null
export const setPluginAsker = (fn: (action: string) => Asker | null) => { pluginAsker = fn }
export const askerOf = (action: string) => askers.get(action) ?? pluginAsker(action)
