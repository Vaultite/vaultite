// The module graph (closure.ts, a parser) as its host gives it: server.ts does. The web demo bundles the core for a
// browser and gives none, so it never carries the parser (tools/check_plugins.ts checks its reach).
import type * as Closure from "./closure.ts"

let source: (() => Promise<typeof Closure>) | null = null
/** The host's way to the graph: `() => import("./core/update/closure.ts")`. */
export const giveGraph = (load: () => Promise<typeof Closure>) => { source = load }
/** The graph's module, loading; null when the host gave none. */
export const graphModule = (): Promise<typeof Closure> | null => source?.() ?? null
