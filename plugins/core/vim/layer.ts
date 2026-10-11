// Which of Vim's overlays outside the editor is open (one at a time): link hints, the find bar or the command line.
import { cell } from "@vaultite"

export type Layer = { kind: "hints"; newTab: boolean } | { kind: "find" } | { kind: "ex" } | null

const layer = cell<Layer>(null)
export const { get: getLayer, set: setLayer, use: useLayer } = layer
