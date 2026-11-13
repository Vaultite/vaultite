import type * as Closure from "./closure.ts"

let source: (() => Promise<typeof Closure>) | null = null
export const giveGraph = (load: () => Promise<typeof Closure>) => { source = load }
/** null when the host gave none. */
export const graphModule = (): Promise<typeof Closure> | null => source?.() ?? null
