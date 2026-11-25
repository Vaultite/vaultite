import { confirmDialog, notify, notifyError, plural, type MenuItem } from "@vaultite"
import { FolderInput, Undo2 } from "lucide-react"
import { groupChoices } from "./tree"
import { call, deleting, lockedNow, refresh, selected, state } from "./store"
import type { Row } from "./types"

const nameOf = (rows: Row[]) => (rows.length === 1 ? `“${rows[0].title || "Untitled"}”` : plural(rows.length, "password"))
export const isBinned = (e: Row) => !!state.get().groups.find((g) => g.id === e.group)?.bin
const placesOf = (rows: Row[]) => rows.map((e) => ({ id: e.id, group: e.group }))

export async function attempt<T>(work: () => Promise<T>, failed: string): Promise<boolean> {
  try { await work(); return true } catch (e) { if (!lockedNow(e)) notifyError(e, failed); return false }
}

const put = (moves: { id: string; group: string }[]) => attempt(async () => {
  const to = new Map(moves.map((m) => [m.id, m.group]))
  state.update((s) => ({ ...s, entries: s.entries && s.entries.map((e) => ({ ...e, group: to.get(e.id) ?? e.group })) }))
  try { await call("move", moves) } catch (e) { void refresh(); throw e }
}, "Couldn't move it")

export async function moveTo(rows: Row[], group: string) {
  const going = rows.filter((e) => e.group !== group), to = state.get().groups.find((g) => g.id === group)
  if (!going.length || !to) return
  if (to.bin) return void remove(going)
  const back = placesOf(going)
  if (await put(going.map((e) => ({ id: e.id, group })))) notify(`Moved ${nameOf(going)} to ${to.name || "the top level"}`, { action: { label: "Undo", run: () => put(back).then(() => {}) } })
}
export async function restoreFromBin(rows: Row[]) {
  const back = placesOf(rows), to = state.get().groups.find((g) => g.id === rows[0].from)
  if (await put(rows.map((e) => ({ id: e.id, group: e.from ?? e.group })))) notify(rows.length > 1 || !to ? `Restored ${nameOf(rows)}` : `Restored ${nameOf(rows)} to ${to.parent ? to.name : "the top level"}`, { action: { label: "Undo", run: () => put(back).then(() => {}) } })
}

function pickNext(gone: string[]) {
  if (!gone.includes(selected.get() ?? "")) return
  const shown = Array.from(document.querySelectorAll<HTMLElement>("[data-passwords-list] [data-select-key]"), (el) => el.dataset.selectKey ?? "")
  const at = shown.findIndex((id) => gone.includes(id)), stays = (id: string) => !gone.includes(id)
  selected.set(shown.slice(at).find(stays) ?? shown.slice(0, at).findLast(stays) ?? null)
}

export async function remove(rows: Row[]) {
  const forever = !state.get().recycles || rows.every(isBinned), ids = rows.map((e) => e.id)
  if (!forever && rows.some(isBinned)) return remove(rows.filter((e) => !isBinned(e)))
  const body = rows.every(isBinned) ? "It's in the recycle bin: deleting it there can't be undone." : "This file keeps no recycle bin: it can't be undone."
  if (forever && !(await confirmDialog({ title: `Delete ${nameOf(rows)} for good?`, body, confirm: "Delete", danger: true }))) return
  const back = placesOf(rows)
  pickNext(ids)
  if (!(await deleting.remove(ids, () => call("delete", { ids, forever }), "Couldn't delete it"))) return void refresh()
  if (forever) return notify(`Deleted ${nameOf(rows)}`)
  notify(`Moved ${nameOf(rows)} to the recycle bin`, { action: { label: "Undo", run: async () => { deleting.back(ids); await put(back) } } })
}

export function moveItems(rows: Row[]): MenuItem[] {
  const at = new Set(rows.map((e) => e.group))
  const items = groupChoices(state.get().groups).map((g) => ({ label: g.label, checked: at.size === 1 && at.has(g.id), run: () => moveTo(rows, g.id) }))
  const move = { label: "Move to", icon: FolderInput, run: () => {}, items }
  return rows.every((e) => e.from) ? [{ label: "Restore", icon: Undo2, run: () => restoreFromBin(rows) }, move] : [move]
}
