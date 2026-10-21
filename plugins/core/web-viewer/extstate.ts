// The Browser's extensions in the app: the engine's list (electron/browser/extensions.ts), what changed, the Web
// Store's addresses; Extensions.tsx draws them.
import { useEffect } from "react"
import { cell, notify, notifyError, viewsChanged, webPages } from "@vaultite"

/** An installed extension, as the Extensions view lists it. */
export type Ext = { id: string; name: string; version: string; on: boolean; pinned: boolean; from: "store" | "folder"; description: string; icon: string
  options: boolean; mv2: boolean; error: string
  /** Profiles of this Mac's other browsers that have its settings (electron/browser/extsettings.ts brings them). */
  settingsFrom: { browser: string; profile: string; name: string }[]
  /** Forced on by this Mac's policy (electron/browser/extpolicy.ts): no switch, no Remove. */
  managed: boolean }
export const engine = <T,>(name: string, ...args: unknown[]) => {
  if (!webPages?.engine) return Promise.reject(new Error("extensions need the desktop app"))
  return webPages.engine(name, ...args) as Promise<T>
}
export const hasExtensions = () => !!webPages?.engine

/** The list, and a count that goes up whenever the engine says something changed (buttons ask again). */
const list = cell<Ext[] | null>(null)
export const version = cell(0)
let asking: Promise<void> | null = null
function refresh() {
  asking ??= engine<Ext[]>("ext:list").then((l) => { list.set(l); viewsChanged() }, () => { list.set([]) }).finally(() => { asking = null })
}
/** The engine said they changed (the plugin's Background hears it). */
export function extensionsChanged() { version.set(version.get() + 1); refresh() }
/** An extension's own page (its options) names its tab by the extension, till the page says its title. */
export function extensionPageName(url: string) {
  const id = /^chrome-extension:\/\/([a-p]{32})\//.exec(url)?.[1]
  return id ? list.get()?.find((x) => x.id === id)?.name ?? "" : ""
}
/** Which extension's popup is open, by its button. */
export const popupOpen = cell("")
export const popupChanged = (ext: string, open: boolean) => { if (open) popupOpen.set(ext); else if (popupOpen.get() === ext) popupOpen.set("") }

export function useExtensions() {
  useEffect(() => { if (list.get() === null) refresh() }, [])
  return list.use((l) => l)
}

/** "https://chromewebstore.google.com/detail/name/<id>" (or the old store's) → the id. */
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
/** Open the Extensions view (index.tsx says how). */
export const openExtensions = () => opener()
export const setExtensionsOpener = (fn: () => void) => { opener = fn }

