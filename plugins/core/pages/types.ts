// Pinned's store keys and its changes, one per pin, unpin or move, applied by the server to the list as it is then and
// shown at once. With Workspaces, the current workspace's list (the vault's until its first change).
import { Pin, PinOff, type LucideIcon } from "lucide-react"
import { currentWorkspace, fileAt, getStore, isHidden, mutate, notify, offPlugin, pinInWorkspace, pinKind, post, stem, workspacePins, type Store } from "@vaultite"

/** A file of the vault, as the store lists it. */
export type VaultFile = Store["files"]["files"][number]

declare module "@vaultite" {
  interface PluginState {
    /** The pinned entries, in order: vault paths. */
    pinned: string[]
  }
}

/** The vault's list (pages.json): without Workspaces the sidebar's, with it the default a workspace starts from. */
export const pinnedOf = (s: Store | null | undefined): string[] => s?.pinned ?? []
/** The sidebar's list now: the current workspace's (its own, else the vault's), or the vault's without workspaces. */
export const currentPins = (s: Store | null | undefined = getStore()): string[] => workspacePins() ?? pinnedOf(s)
export const isPinned = (path: string) => currentPins().includes(path)

/** The pinned pages that show: files that exist, whose plugin is on, not archived. (An archived one stays pinned, so
 *  unarchiving it brings it back where it was.) `list`: another list than the sidebar's. */
export function shownPinned(store: Store, list = currentPins(store)) {
  return list.flatMap((p): { key: string; file: VaultFile }[] => {
    const f = fileAt(store.files.files, p)
    return f && !offPlugin(f) && !f.archived ? [{ key: p, file: f }] : []
  })
}

/** A pinned entry as it shows: a file (a page), a heading or block in a note, or a search (bookmarks). */
export type PinEntry = { key: string; label: string } & (
  { kind: "file"; file: VaultFile } | { kind: "heading"; file: VaultFile; heading: string } | { kind: "search"; query: string })

/** Every pinned entry that shows, in order: the pages (shownPinned), and the headings of notes that are there and are
 *  shown, and the searches. */
export function shownEntries(store: Store, list = currentPins(store)): PinEntry[] {
  return list.flatMap((p): PinEntry[] => {
    const k = pinKind(p)
    if ("search" in k) return k.search.trim() ? [{ key: p, kind: "search", query: k.search, label: k.search }] : []
    const f = fileAt(store.files.files, k.file)
    if (!f || offPlugin(f) || f.archived) return []
    if (!k.heading) return [{ key: p, kind: "file", file: f, label: stem(p) }]
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
 *  else the vault's. */
export function pin(path: string, on = true, before?: string | null): Promise<unknown> {
  return currentWorkspace() ? pinInWorkspace(path, on, before, pinnedOf(getStore())) : pinVault(path, on, before)
}
export const togglePin = (path: string) => pin(path, !isPinned(path))

/** Pin or unpin from a menu or command, where the sidebar may not be in view (folded, a phone): a toast says so, with
 *  Undo (back in its place). Drags and the checkbox menus show it where it happens, so they use pin. */
export function pinNoted(path: string, on: boolean) {
  const k = pinKind(path)
  const name = "search" in k ? `the search ${k.search}` : k.heading ?? path.split("/").pop()!.replace(/\.(md|html?|csv)$/i, "")
  const list = currentPins()
  if (!on) {
    const after = list[list.indexOf(path) + 1] ?? null
    notify(`Unpinned ${name}`, { action: { label: "Undo", run: () => void pin(path, true, after) } })
    return pin(path, false)
  }
  notify(`Pinned ${name}`, { action: { label: "Undo", run: () => void pin(path, false) } })
  return pin(path, true)
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
  const n = `${todo.length} page${todo.length === 1 ? "" : "s"}`
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

/** A file that can be pinned: in the vault and not hidden (.trash, .vaultite). */
export const pinnable = (path: string) => !!path && !path.startsWith("/") && !isHidden(path)
