// (roots.mjs' types, for the code and tests that import it)
type Shell = { channel?: string; release?: boolean; fingerprint?: string; appId?: string; productName?: string }
type Bad = Record<string, { why: string; t: number }>
export type Picked = { root: string; from: "bundle" | "checkout" | "dev" | "current" | "good"; passed: { root: string; from: string; why: string }[] }
export type ShellEvent = { t: number; kind: string; root: string; commit: string | null; why: string; ran?: string }
export const ENABLED: Readonly<{ dev: boolean; store: boolean }>
export const SETTLED_AFTER: number
export const MARKER: string
export const STORE: string
export function storeIn(userData: string): string | null
export function readShell(bundle: string): Shell
export function commitOf(root: string): string | null
export function userDataOf(name: string, env?: Record<string, string | undefined>, platform?: string, home?: string): string
export function rootProblem(root: string, o: { store?: string; fingerprint?: string; uid?: number }): string | null
export function pick(o: { bundle: string; packaged: boolean; platform: string; shell: Shell; env: Record<string, string | undefined>; uid?: number
  store?: string | null; bad?: Bad; enabled?: { dev: boolean; store: boolean } }): Picked
export function stateDir(userData: string): string
export function event(dir: string, e: Omit<ShellEvent, "t">, now?: number): void
export function unreported(dir: string): ShellEvent[]
export function badRoots(dir: string): Bad
export function settle(dir: string, o?: { alive?: (pid: number) => boolean; now?: number; bundle?: string }): void
export function begin(dir: string, a: { pid: number; root: string; commit?: string | null }, now?: number): void
export function ready(dir: string, pid: number, now?: number): void
export function settled(dir: string, pid: number): void
export function ended(dir: string, pid: number): void
export function failed(dir: string, o: { root: string; bundle: string; commit?: string | null; why: string; kind?: string }, now?: number): void
