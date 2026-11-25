import { useEffect } from "react"
import { cell, detailPath, get, isMac, notify, notifyError, openDetail, removals, secretDialog, webPages } from "@vaultite"
import { needEngine } from "../engine"
import { byHand } from "./byhand"
import type { Group, Health, Row, Status, Use } from "./types"

export const FREE_TAG = "agent-free"
export const entryTitle = (id: string) => state.get().entries?.find((e) => e.id === id)?.title || "Password"
export const ENTRY_DETAIL = "password", EDIT_DETAIL = "password-edit", NEW_DETAIL = "password-new"

export const hasPasswords = () => !!webPages?.engine
export const fileName = (file: string) => file.split(/[\\/]/).pop() ?? file
const HERE = isMac ? "this Mac" : "this computer"

const engine = needEngine("passwords need the desktop app")
export const call = <N extends string>(name: N, ...args: unknown[]) => engine(`passwords:${name}`, ...args)
export const isLocked = (e: unknown) => e instanceof Error && /(^|: )locked$/.test(e.message)

type State = { status: Status | undefined; groups: Group[]; entries: Row[] | null; health: ReadonlyMap<string, Health>; leaks: ReadonlyMap<string, number> | null; recycles: boolean }
const NONE: Pick<State, "groups" | "entries" | "health" | "leaks" | "recycles"> = { groups: [], entries: null, health: new Map(), leaks: null, recycles: true }
export const state = cell<State>({ status: undefined, ...NONE })
export const deleting = removals()
export const selected = cell<string | null>(null)
export const showsBeside = cell(false)

export function openEntry(id: string) {
  selected.set(id)
  if (!showsBeside.get()) openDetail(detailPath(ENTRY_DETAIL, id))
}
export const editEntry = (id: string) => openDetail(detailPath(EDIT_DETAIL, id))

let reading: Promise<void> | null = null, again = false
export function refresh(): Promise<void> {
  if (reading) { again = true; return reading }
  reading = read().finally(() => { reading = null; if (again) { again = false; void refresh() } })
  return reading
}
function stillLeaked(was: State, health: State["health"]) {
  return was.leaks && new Map([...was.leaks].filter(([id]) => was.health.get(id)?.since === health.get(id)?.since))
}
async function read() {
  let status: Status
  try { status = await call("status") } catch { status = null }
  if (!status || status.locked || status.error) return state.set({ status, ...NONE })
  try {
    const { groups, entries, recycles } = await call("list")
    state.update((s) => ({ ...s, status, groups, entries, recycles }))
    const health = new Map((await call("health")).map((h) => [h.id, h]))
    state.update((s) => (s.entries ? { ...s, health, leaks: stillLeaked(s, health) } : s))
  } catch (e) {
    if (isLocked(e)) return state.set({ status: { ...status, locked: true }, ...NONE })
    state.update((s) => ({ ...s, status, entries: s.entries ?? [] }))
    notifyError(e, "Couldn't read your passwords")
  }
}

export function lockedNow(e: unknown) {
  if (!isLocked(e)) return false
  const s = state.get().status
  if (s) state.set({ status: { ...s, locked: true }, ...NONE })
  return true
}

let users = 0, off: (() => void) | undefined
export function usePasswordsLive() {
  useEffect(() => {
    if (!webPages) return
    if (!users++) {
      off = webPages.on((m) => { if (m.type === "engine:passwords:changed") void refresh() })
      void refresh()
    }
    return () => { if (!--users) { off?.(); off = undefined } }
  }, [])
  return state.use()
}

export async function chooseFile(chosen?: string) {
  let file: string | null
  try { file = chosen ?? await call("choose") } catch (e) { return notifyError(e, "Couldn't open the file picker") }
  if (!file) return
  const given = await secretDialog({ title: `Password of ${fileName(file)}`, confirm: "Open", field: "secret",
    body: isMac ? "Kept on this Mac, opened by Touch ID where it has it, never in the vault." : "Kept in this computer's keyring (with none, only till the app quits), never in the vault." })
  if (!given) return
  try {
    const r = await call("set", file, given.value)
    if (r?.error) notify(`Couldn't open ${fileName(file)}: ${r.error}`, { kind: "error" })
    else if (r?.held) notify(`Opened ${fileName(file)}: its password is kept till the app quits (no keyring here)`)
    await refresh()
  } catch (e) { notifyError(e, `Couldn't open ${fileName(file)}`) }
}

export async function forgetFile() {
  try { await call("forget"); notify(`Vaultite no longer opens your passwords on ${HERE}`); await refresh() } catch (e) { notifyError(e, "Couldn't stop it") }
}

export const lockNow = () => void call("lock").catch((e) => notifyError(e, "Couldn't lock it"))

async function copied<T>(what: string, copy: () => Promise<T>) {
  if (!byHand()) return
  try { await copy() } catch (e) { if (!lockedNow(e)) notifyError(e, `Couldn't copy the ${what}`); return }
  notify(`Copied the ${what}: cleared in 30 seconds`)
}
export const copyText = (text: string, what: string) => copied(what, () => call("copy", text))
export const copyPassword = (id: string, at?: number) => copied("password", () => call("copy-password", id, at))
export const copyCode = (id: string) => copied("one-time code", () => call("copy-code", id))

export const fetchUses = () => get<{ uses?: Use[] }>("web-viewer/login-uses").then((r) => (Array.isArray(r?.uses) ? r.uses : null), () => null)
export const usesOf = (uses: Use[], e: Pick<Row, "id" | "title" | "username">) =>
  uses.filter((u) => (u.entry.id ? u.entry.id === e.id : u.entry.title === e.title && u.entry.username === e.username))
export function approvedText(u: Use) {
  if (u.status === "denied") return "denied"
  if (u.status !== "filled") return u.status
  const a = u.approved ?? ""
  if (/^free\b/.test(a)) return "without asking"
  const key = /passkey \((.+)\)/.exec(a)?.[1]
  return key ? `approved with ${key}` : a ? `approved: ${a}` : "filled"
}

export const webUrl = (u: string) => (/^[a-z][a-z\d+.-]*:/i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`)
