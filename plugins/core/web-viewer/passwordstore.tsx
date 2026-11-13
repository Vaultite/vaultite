import { useEffect, useState } from "react"
import { afterSheets, cell, get, isMac, isViewOpen, notify, notifyError, openView, removals, secretDialog, Section, SettingRow, webPages } from "@vaultite"

export type Status = null | { file: string; locked: boolean; touchId: boolean; held?: boolean; error?: string }
export type Group = { id: string; name: string; parent: string | null; share: string | null; bin: boolean }
export type Row = {
  id: string; group: string; title: string; username: string; urls: string[]; tags: string[]
  free: boolean; shared: boolean; expired: boolean; otp: boolean; modified: number
}
export type Full = Row & { password: string; notes: string; otpUri: string; code: string | null }
export type Change = { id?: string; group?: string; title: string; username: string; password: string; urls: string[]; tags: string[]; notes: string; otp?: string }
export type Use = { t: number; entry: { id?: string; title: string; username: string }; site: string; agent: string; task?: string; status: string; approved?: string; machine?: string }

export const FREE_TAG = "agent-free"
export const entryTitle = (id: string) => state.get().entries?.find((e) => e.id === id)?.title || "Password"
export const ENTRY_DETAIL = "password", EDIT_DETAIL = "password-edit", NEW_DETAIL = "password-new"

export const hasPasswords = () => !!webPages?.engine
export const fileName = (file: string) => file.split(/[\\/]/).pop() ?? file
const HERE = isMac ? "this Mac" : "this computer"

export const call = <T,>(name: string, ...args: unknown[]) => {
  const p = Promise.resolve(webPages?.engine?.(`passwords:${name}`, ...args)) as Promise<T>
  if (OPENING.has(name)) void p.then(() => lapses(), () => {})
  return p
}
const OPENING = new Set(["list", "get", "save", "delete", "unlock", "set"])
let lapse = 0
const lapses = () => { clearTimeout(lapse); lapse = window.setTimeout(() => void refresh(), 10 * 60_000 + 2000) }
export const isLocked = (e: unknown) => e instanceof Error && /(^|: )locked$/.test(e.message)

type State = { status: Status | undefined; groups: Group[]; entries: Row[] | null }
export const state = cell<State>({ status: undefined, groups: [], entries: null })
export const deleting = removals()

let reading: Promise<void> | null = null, again = false
export function refresh(): Promise<void> {
  if (reading) { again = true; return reading }
  reading = (async () => {
    let status: Status
    try { status = await call<Status>("status") } catch { status = null }
    if (!status || status.locked || status.error) return state.set({ status, groups: [], entries: null })
    try {
      const { groups, entries } = await call<{ groups: Group[]; entries: Row[] }>("list")
      state.set({ status, groups, entries })
    } catch (e) {
      state.set({ status: { ...status, locked: isLocked(e) || status.locked }, groups: [], entries: isLocked(e) ? null : [] })
      if (!isLocked(e)) notifyError(e, "Couldn't read your passwords")
    }
  })().finally(() => { reading = null; if (again) { again = false; void refresh() } })
  return reading
}

export function lockedNow(e: unknown) {
  if (!isLocked(e)) return false
  const s = state.get().status
  if (s) state.set({ status: { ...s, locked: true }, groups: [], entries: null })
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
  try { file = chosen ?? await call<string | null>("choose") } catch (e) { return notifyError(e, "Couldn't open the file picker") }
  if (!file) return
  const given = await secretDialog({ title: `Password of ${fileName(file)}`, confirm: "Open", field: "secret",
    body: isMac ? "Kept in this Mac's Keychain, never in the vault." : "Kept in this computer's keyring (with none, only till the app quits), never in the vault." })
  if (!given) return
  try {
    const r = await call<Status & { error?: string }>("set", file, given.value)
    if (r?.error) notify(`Couldn't open ${fileName(file)}: ${r.error}`, { kind: "error" })
    else if (r?.held) notify(`Opened ${fileName(file)}: its password is kept till the app quits (no keyring here)`)
    await refresh()
  } catch (e) { notifyError(e, `Couldn't open ${fileName(file)}`) }
}

export async function forgetFile() {
  try { await call("forget"); notify(`Vaultite no longer opens your passwords on ${HERE}`); await refresh() } catch (e) { notifyError(e, "Couldn't stop it") }
}

export const lockNow = () => void call("lock").catch((e) => notifyError(e, "Couldn't lock it"))

export async function copySecret(text: string, what: string) {
  try { await call("copy", text) } catch (e) { return notifyError(e, `Couldn't copy the ${what}`) }
  notify(`Copied the ${what}: cleared in 30 seconds`)
}

export const fetchUses = () => (get("web-viewer/login-uses") as Promise<{ uses?: Use[] }>).then((r) => (Array.isArray(r?.uses) ? r.uses : null), () => null)
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

export function groupPath(groups: Map<string, Group>, id: string) {
  const names: string[] = []
  for (let g = groups.get(id); g && g.parent; g = g.parent ? groups.get(g.parent) : undefined) names.unshift(g.name)
  return names.join(" / ")
}

export function sharedGroups(groups: Group[], entries: Row[]) {
  return new Set([...groups.filter((g) => g.share && !g.bin).map((g) => g.id), ...entries.filter((e) => e.shared).map((e) => e.group)])
}

export const webUrl = (u: string) => (/^[a-z][a-z\d+.-]*:/i.test(u) ? u : `https://${u.replace(/^\/+/, "")}`)

const showPasswords = () => afterSheets(() => openView("passwords", { newTab: !isViewOpen("view:passwords") }))

export function PasswordsSetting() {
  const [status, setStatus] = useState<Status | undefined>(undefined)
  useEffect(() => { if (hasPasswords()) void call<Status>("status").then(setStatus, () => setStatus(null)) }, [])
  return (
    <div data-setting="passwords" className="mt-6">
      <Section title="Passwords">
        {!hasPasswords() ? <p className="text-[15px] text-muted-foreground">Your passwords open in Vaultite's desktop app.</p>
          : <SettingRow label="Your passwords" value={status === undefined ? "" : status ? fileName(status.file) : "Not set up"} onClick={showPasswords} />}
      </Section>
    </div>
  )
}
