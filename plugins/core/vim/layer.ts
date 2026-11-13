import { cell } from "@vaultite"

export type Layer = { kind: "hints"; newTab: boolean } | { kind: "find" } | { kind: "ex" } | null

const layer = cell<Layer>(null)
export const { get: getLayer, set: setLayer, use: useLayer } = layer
