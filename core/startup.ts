export type Phase = "imports" | "plugins" | "vault" | "opening" | "ready"
const PHASE_AFTER_MARK = new Map<string, Phase>([["imports", "plugins"], ["plugins", "vault"], ["vault read", "opening"]])

export type Health = { ok: true; ready: boolean; phase: Phase; pid: number; startedAt: number; readyAt: number | null; commit: string | null }

export const startShared = new SharedArrayBuffer(8 + 16)
const readyFlag = new Int32Array(startShared, 0, 1), phaseLength = new Int32Array(startShared, 4, 1), phaseBytes = new Uint8Array(startShared, 8)
const encoder = new TextEncoder()
export const startedAt = Math.round(performance.timeOrigin)
let phase: Phase = "imports", readyAt: number | null = null, commit: string | null = null

function enter(p: Phase) {
  phase = p
  Atomics.store(phaseLength, 0, encoder.encodeInto(p, phaseBytes).written)
}
enter("imports")

export function markPassed(mark: string) {
  const next = PHASE_AFTER_MARK.get(mark)
  if (next && phase !== "ready") enter(next)
}

let served = () => {}
export const whenReady = new Promise<void>((resolve) => { served = resolve })

export function ready() {
  readyAt = Date.now()
  enter("ready")
  Atomics.store(readyFlag, 0, 1)
  served()
}

export function runsCommit(sha: string | null) {
  commit = sha
}

export const health = (): Health => ({ ok: true, ready: readyAt !== null, phase, pid: process.pid, startedAt, readyAt, commit })
