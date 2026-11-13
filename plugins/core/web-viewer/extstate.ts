import { useEffect } from "react"
import { cell, notify, notifyError, viewsChanged, webPages } from "@vaultite"

export type Ext = { id: string; name: string; version: string; on: boolean; pinned: boolean; from: "store" | "folder"; description: string; icon: string
  options: boolean; mv2: boolean; error: string
  settingsFrom: { browser: string; profile: string; name: string }[]
  managed: boolean }
export const engine = <T,>(name: string, ...args: unknown[]) => {
  if (!webPages?.engine) return Promise.reject(new Error("extensions need the desktop app"))
  return webPages.engine(name, ...args) as Promise<T>
}
export const hasExtensions = () => !!webPages?.engine

const list = cell<Ext[] | null>(null)
export const version = cell(0)
let asking: Promise<void> | null = null
function refresh() {
  asking ??= engine<Ext[]>("ext:list").then((l) => { list.set(l); viewsChanged() }, () => { list.set([]) }).finally(() => { asking = null })
}
export function extensionsChanged() { version.set(version.get() + 1); refresh() }
export function extensionPageName(url: string) {
  const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)?.[1]
  return id ? list.get()?.find((x) => x.id === id)?.name ?? "" : ""
}
export const popupOpen = cell("")
export const popupChanged = (ext: string, open: boolean) => { if (open) popupOpen.set(ext); else if (popupOpen.get() === ext) popupOpen.set("") }

export function changeExtension(id: string, change: Partial<Ext>, write: () => Promise<unknown>, failed: string) {
  list.update((l) => l && l.map((x) => (x.id === id ? { ...x, ...change } : x)))
  void write().catch((e) => { refresh(); notifyError(e, failed) })
}

export function useExtensions() {
  useEffect(() => { if (list.get() === null) refresh() }, [])
  return list.use((l) => l)
}

export function storeIdOf(url: string) {
  return /^https:\/\/(chromewebstore\.google\.com\/detail|chrome\.google\.com\/webstore\/detail)\/(?:[^/?#]+\/)?([a-p]{32})(?:[/?#]|$)/.exec(url)?.[2] ?? ""
}

export async function addExtension(input: string) {
  try {
    const r = await engine<{ id: string; name: string }>("ext:install", input)
    notify(`Added ${r.name}`)
    return true
  } catch (e) { notifyError(e, "Couldn't add the extension"); return false }
}

let opener: () => void = () => {}
export const openExtensions = () => opener()
export const setExtensionsOpener = (fn: () => void) => { opener = fn }

