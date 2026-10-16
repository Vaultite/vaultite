// Pinned's store keys and its changes, one per pin, unpin or move, applied by the server to the list as it is then and
// shown at once. With Workspaces, the current workspace's list (the vault's until its first change).
import { Pin, PinOff, type LucideIcon } from "lucide-react"
import {
  currentWorkspace, fileAt, getStore, isDoc, isFolder, isHidden, mutate, notify, offPlugin, PIN_SEARCH, pinInWorkspace, pinKind, pinOfView, plural, post, shownName, stem, viewInfo,
  viewShown, workspacePins, type Store,
} from "@vaultite"

/** A file of the vault, as the store lists it. */
export type VaultFile = Store["files"]["files"][number]

declare module "@vaultite" {
  interface PluginState {
    /** The pinned entries, in order: vault paths. */
    pinned: string[]
    /** A pinned view's name as it was when pinned (a conversation's), by its key. */
    pinLabels?: Record<string, string>
  }
}

/** The vault's list (pages.json): without Workspaces the sidebar's, with it the default a workspace starts from. */
export const pinnedOf = (s: Store | null | undefined): string[] => s?.pinned ?? []
/** The sidebar's list now: the current workspace's (its own, else the vault's), or the vault's without workspaces. */
export const currentPins = (s: Store | null | undefined = getStore()): string[] => workspacePins() ?? pinnedOf(s)
export const isPinned = (path: string) => currentPins().includes(path)

/** A pinned file as it shows: a note whose plugin is on, not archived (it stays pinned, back where it was once it's
 *  unarchived), or any other file that opens in a tab (`file` none: an image, a recording, a PDF); else null. */
function pinnedFile(store: Store, p: string): { file?: VaultFile } | null {
  const f = fileAt(store.files.files, p)
  if (f) return !offPlugin(f) && !f.archived ? { file: f } : null
  return fileAt(store.files.others, p) ? {} : null
}

/** The pinned files that show (pinnedFile), in order. `list`: another list than the sidebar's. */
export function shownPinned(store: Store, list = currentPins(store)) {
  return list.flatMap((p): { key: string; file?: VaultFile }[] => { const f = pinnedFile(store, p); return f ? [{ key: p, ...f }] : [] })
}
/** A pinned file's name: a note's without its extension, any other file's with it. */
export const pinName = (path: string) => (isDoc(path) ? stem(path) : shownName(path))

/** A pinned entry as it shows: a file (a page), a heading or block in a note, a search (bookmarks), or a view (its
 *  tab's target: a web page, a coding agent's conversation, Inbox). */
export type PinEntry = { key: string; label: string } & (
  { kind: "file"; path: string; file?: VaultFile } | { kind: "heading"; file: VaultFile; heading: string } | { kind: "folder"; path: string; parent: string }
  | { kind: "search"; query: string } | { kind: "view"; target: string })

/** A pinned view's name: as it was pinned, else its tab's. */
export const viewLabel = (key: string, s: Store | null | undefined = getStore()) => s?.pinLabels?.[key] || viewInfo(key).label

/** Every pinned entry that shows, in order: the files (shownPinned), folders, the headings of notes that are there and
 *  are shown, and the searches. */
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

/** Pin in the vault's list (pages.json), at the end, or before the entry `before` (null = the end: moved there if it's
 *  pinned already), or unpin there. */
export function pinVault(path: string, on = true, before?: string | null) {
  const was = pinnedOf(getStore())
  const rest = was.filter((p) => p !== path)
  const i = before ? rest.indexOf(before) : -1
  const at = was.indexOf(path)
  const next = !on ? rest : at >= 0 && before === undefined ? was : i < 0 ? [...rest, path] : [...rest.slice(0, i), path, ...rest.slice(i)]
  mutate((s) => ({ ...s, pinned: next }))
  return post<{ pinned: string[] }>("pins", { path, pinned: on, ...(before !== undefined ? { before } : {}) })
    .then(() => {}, () => { /* offline: the local copy still applies */ })
}

/** Pin (at the end, or before `before`) or unpin in the sidebar's list: the current workspace's with Workspaces on,
 *  else the vault's. `label`: a view's name, kept with it (a conversation's title, which its tab loses once it ends). */
export function pin(path: string, on = true, before?: string | null, label?: string): Promise<unknown> {
  if (on && label && path.startsWith("view:")) relabel(path, label)
  return currentWorkspace() ? pinInWorkspace(path, on, before, pinnedOf(getStore())) : pinVault(path, on, before)
}
export const togglePin = (path: string) => pin(path, !isPinned(path))

/** Name a pinned view (pages.json's `labels`): a conversation's title, a web page's. */
export function relabel(key: string, label: string) {
  mutate((s) => ({ ...s, pinLabels: { ...s.pinLabels, [key]: label } }))
  void post("pins/label", { path: key, label }).catch(() => {})
}

/** What pinning a view's tab pins (its key and name), or null: a search tab its search ("search:<query>"), any other
 *  view as it says (pinOfView). */
export function viewPin(target: string): { key: string; label: string } | null {
  const search = /^view:search(?:\/(.*))?$/s.exec(target)
  if (search) { const q = search[1]?.trim(); return q ? { key: PIN_SEARCH + q, label: q } : null }
  return pinOfView(target)
}

/** Pin or unpin from a menu or command, where the sidebar may not be in view (folded, a phone): a toast says so, with
 *  Undo (back in its place). Drags and the checkbox menus show it where it happens, so they use pin. */
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

/** Pin or unpin several (selected together), one after another so each lands, then one toast with Undo. `before`:
 *  where pinned ones go (they keep their order); unpinned, Undo puts each back where it was. */
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

/** A file's pin item, for its menus (the tree's, its tab's, the phone's …): Pin or Unpin, in the sidebar's list (the
 *  current workspace's, with Workspaces on), grouped with Open local graph and Open version history. */
export function pinItems(path: string): { label: string; icon: LucideIcon; run: () => void; section: string; many: (paths: string[]) => void }[] {
  return [isPinned(path)
    ? { label: "Unpin", icon: PinOff, section: "navigate", run: () => void pinNoted(path, false), many: (paths: string[]) => void pinManyNoted(paths, false) }
    : { label: "Pin", icon: Pin, section: "navigate", run: () => void pinNoted(path, true), many: (paths: string[]) => void pinManyNoted(paths, true) }]
}

/** Move `from` to where `to` is (both pinned entries; dragging in the list); hidden ones keep their places. */
export function movePinned(from: string, to: string) {
  const all = currentPins()
  const a = all.indexOf(from), b = all.indexOf(to)
  if (a < 0 || b < 0 || a === b) return
  // Up: it goes before `to`; down: after it (before whatever follows it, or at the end).
  return pin(from, true, a > b ? to : all[b + 1] ?? null)
}

/** A file or folder that can be pinned: in the vault and not hidden (.trash, .vaultite). */
export const pinnable = (path: string) => !!path && !path.startsWith("/") && !isHidden(path)
