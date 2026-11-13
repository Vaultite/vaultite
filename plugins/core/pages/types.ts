import { Pin, PinOff, type LucideIcon } from "lucide-react"
import {
  currentWorkspace, fileAt, getStore, isDoc, isFolder, isHidden, mutate, notify, offPlugin, PIN_SEARCH, pinInWorkspace, pinKind, pinOfView, placePin, plural, post, shownName, stem, viewInfo,
  viewShown, workspacePins, type Store,
} from "@vaultite"

export type VaultFile = Store["files"]["files"][number]

declare module "@vaultite" {
  interface PluginState {
    pinned: string[]
    pinLabels?: Record<string, string>
  }
}

export const pinnedOf = (s: Store | null | undefined): string[] => s?.pinned ?? []
export const currentPins = (s: Store | null | undefined = getStore()): string[] => workspacePins() ?? pinnedOf(s)
export const isPinned = (path: string) => currentPins().includes(path)

function pinnedFile(store: Store, p: string): { file?: VaultFile } | null {
  const f = fileAt(store.files.files, p)
  if (f) return !offPlugin(f) && !f.archived ? { file: f } : null
  return fileAt(store.files.others, p) ? {} : null
}

export function shownPinned(store: Store, list = currentPins(store)) {
  return list.flatMap((p): { key: string; file?: VaultFile }[] => { const f = pinnedFile(store, p); return f ? [{ key: p, ...f }] : [] })
}
export const pinName = (path: string) => (isDoc(path) ? stem(path) : shownName(path))

export type PinEntry = { key: string; label: string } & (
  { kind: "file"; path: string; file?: VaultFile } | { kind: "heading"; file: VaultFile; heading: string } | { kind: "folder"; path: string; parent: string }
  | { kind: "search"; query: string } | { kind: "view"; target: string })

export const viewLabel = (key: string, s: Store | null | undefined = getStore()) => s?.pinLabels?.[key] || viewInfo(key).label

export function shownEntries(store: Store, list = currentPins(store)): PinEntry[] {
  return list.flatMap((p): PinEntry[] => {
    const k = pinKind(p)
    if ("search" in k) return k.search.trim() ? [{ key: p, kind: "search", query: k.search, label: k.search }] : []
    if ("view" in k) return viewShown(k.view) ? [{ key: p, kind: "view", target: k.view, label: viewLabel(p, store) }] : []
    if (!k.heading) {
      const shown = pinnedFile(store, p)
      if (shown) return [{ key: p, kind: "file", path: p, ...shown, label: pinName(p) }]
      if (!isFolder(store.files, p)) return []
      const at = p.lastIndexOf("/")
      return [{ key: p, kind: "folder", path: p, parent: at < 0 ? "" : p.slice(0, at), label: p.slice(at + 1) }]
    }
    const f = fileAt(store.files.files, k.file)
    if (!f || offPlugin(f) || f.archived) return []
    const block = k.heading.startsWith("^")
    return [{ key: p, kind: "heading", file: f, heading: k.heading, label: block ? `${stem(k.file).replace(/^.*\//, "")} ${k.heading}` : k.heading }]
  })
}

export function pinVault(path: string, on = true, before?: string | null) {
  const next = placePin(pinnedOf(getStore()), path, on, before)
  mutate((s) => ({ ...s, pinned: next }))
  return post<{ pinned: string[] }>("pins", { path, pinned: on, ...(before !== undefined ? { before } : {}) })
    .then(() => {}, () => {})
}

export function pin(path: string, on = true, before?: string | null, label?: string): Promise<unknown> {
  if (on && label && path.startsWith("view:")) relabel(path, label)
  return currentWorkspace() ? pinInWorkspace(path, on, before, pinnedOf(getStore())) : pinVault(path, on, before)
}

export function relabel(key: string, label: string) {
  mutate((s) => ({ ...s, pinLabels: { ...s.pinLabels, [key]: label } }))
  void post("pins/label", { path: key, label }).catch(() => {})
}

export function viewPin(target: string): { key: string; label: string } | null {
  const search = /^view:search(?:\/(.*))?$/s.exec(target)
  if (search) { const q = search[1]?.trim(); return q ? { key: PIN_SEARCH + q, label: q } : null }
  const folder = /^view:folder(?:\/(.*))?$/s.exec(target)
  if (folder) return folder[1] ? { key: folder[1], label: folder[1].split("/").pop()! } : null
  return pinOfView(target)
}

export function pinNoted(path: string, on: boolean, label?: string) {
  const k = pinKind(path)
  const name = "search" in k ? `the search ${k.search}` : "view" in k ? label ?? viewLabel(path) : k.heading ?? pinName(path).split("/").pop()!
  const list = currentPins()
  if (!on) {
    const after = list[list.indexOf(path) + 1] ?? null
    notify(`Unpinned ${name}`, { action: { label: "Undo", run: () => void pin(path, true, after) } })
    return pin(path, false)
  }
  notify(`Pinned ${name}`, { action: { label: "Undo", run: () => void pin(path, false) } })
  return pin(path, true, undefined, label)
}

export async function pinMany(keys: string[], on: boolean, before?: string | null) {
  const was = currentPins()
  const after = (k: string) => was.slice(was.indexOf(k) + 1).find((x) => !keys.includes(x)) ?? null
  const places = new Map(keys.map((k) => [k, after(k)]))
  for (const k of keys) await pin(k, on, on ? before : undefined)
  return places
}
export async function pinManyNoted(keys: string[], on: boolean) {
  const todo = keys.filter((k) => isPinned(k) !== on)
  if (!todo.length) return
  const places = await pinMany(todo, on)
  const n = `${plural(todo.length, "page")}`
  notify(`${on ? "Pinned" : "Unpinned"} ${n}`, { action: { label: "Undo", run: async () => {
    for (const k of todo) await pin(k, !on, on ? undefined : places.get(k))
  } } })
}

export function pinItems(path: string): { label: string; icon: LucideIcon; run: () => void; section: string; many: (paths: string[]) => void }[] {
  return [isPinned(path)
    ? { label: "Unpin", icon: PinOff, section: "navigate", run: () => void pinNoted(path, false), many: (paths: string[]) => void pinManyNoted(paths, false) }
    : { label: "Pin", icon: Pin, section: "navigate", run: () => void pinNoted(path, true), many: (paths: string[]) => void pinManyNoted(paths, true) }]
}

export function movePinned(from: string, to: string) {
  const all = currentPins()
  const a = all.indexOf(from), b = all.indexOf(to)
  if (a < 0 || b < 0 || a === b) return
  return pin(from, true, a > b ? to : all[b + 1] ?? null)
}

export const pinnable = (path: string) => !!path && !path.startsWith("/") && !isHidden(path)
