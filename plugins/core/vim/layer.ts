// Which of Vim's overlays outside the editor is open (one at a time): link hints, the find bar or the command line.
import { useSyncExternalStore } from "react"

export type Layer = { kind: "hints"; newTab: boolean } | { kind: "find" } | { kind: "ex" } | null

let layer: Layer = null
const subs = new Set<() => void>()
export const getLayer = () => layer
export function setLayer(l: Layer) { layer = l; subs.forEach((f) => f()) }
export const useLayer = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => layer)
