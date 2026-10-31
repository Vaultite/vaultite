// The keepers' tally, import()ed by the logbook and a worker's script too (as Excalidraw's font subsetting): it shares
// `beam` with the logbook, and must not import the logbook's chunk for it, which reads globalThis.__vaultite (no worker has it).
import { beam } from "./beam.ts"

export const WorkerUrl = new URL(import.meta.url)
export const tally = (hour: number) => `The beam was ${beam(20, hour)} at ${hour}`
if (typeof window === "undefined" && typeof self !== "undefined") self.onmessage = (e: MessageEvent<number>) => self.postMessage(tally(e.data))
