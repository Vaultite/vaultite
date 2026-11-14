import { useSyncExternalStore } from "react"
import { notifyError, phoneFiles, put, rawUrl, type PhoneDownload } from "@vaultite"
import { loadPlaces, titleOf } from "./now"

let items: PhoneDownload[] = []
const subs = new Set<() => void>()
let polling: ReturnType<typeof setTimeout> | null = null
function refresh() {
  if (!phoneFiles) return
  phoneFiles.list().then((r) => {
    items = r.items ?? []
    for (const f of subs) f()
    if (polling) clearTimeout(polling)
    polling = items.some((i) => !i.done && !i.error) && subs.size ? setTimeout(refresh, 1500) : null
  }, () => {})
}
const subscribe = (f: () => void) => { subs.add(f); if (subs.size === 1) refresh(); return () => { subs.delete(f) } }
const snapshot = () => items
export const useKept = () => useSyncExternalStore(subscribe, snapshot)
export const keptOf = (list: PhoneDownload[], path: string) => list.find((i) => i.path === path)

export function keep(path: string) {
  phoneFiles!.download({ url: new URL(rawUrl(path), location.href).href, path, title: titleOf(path) })
    .then(refresh, (e) => notifyError(e, "Couldn't download it to this iPhone"))
}
export const unkeep = (path: string) => phoneFiles!.remove({ path }).then(refresh, () => {})

export function sendOfflinePlaces() {
  phoneFiles?.takePlaces().then(async ({ places }) => {
    for (const p of places ?? []) await put("player/places", { path: p.path, t: p.t, d: p.d }).catch(() => {})
    if (places?.length) loadPlaces(true)
  }, () => {})
}
