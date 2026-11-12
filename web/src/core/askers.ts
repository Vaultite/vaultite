export type Asker = (m: Record<string, unknown>, ended: AbortSignal) => unknown
const askers = new Map<string, Asker>()
export const answerUi = (action: string, fn: Asker) => { askers.set(action, fn) }
let pluginAsker: (action: string) => Asker | null = () => null
export const setPluginAsker = (fn: (action: string) => Asker | null) => { pluginAsker = fn }
export const askerOf = (action: string) => askers.get(action) ?? pluginAsker(action)
