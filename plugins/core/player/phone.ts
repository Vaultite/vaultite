// Files kept on the iPhone (the app's Downloads), to play without the server: what's kept, polled while one is on its
// way, and where offline playback stopped, sent to the server once it's back.
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
export const useKept = () => useSyncExternalStore((f) => { subs.add(f); if (subs.size === 1) refresh(); return () => { subs.delete(f) } }, () => items)
export const keptOf = (list: PhoneDownload[], path: string) => list.find((i) => i.path === path)

export function keep(path: string) {
  phoneFiles!.download({ url: new URL(rawUrl(path), location.href).href, path, title: titleOf(path) })
    .then(refresh, (e) => notifyError(e, "Couldn't download it to this iPhone"))
}
export const unkeep = (path: string) => phoneFiles!.remove({ path }).then(refresh, () => {})

/** Where offline playback stopped (the first screen's), to the server. */
export function sendOfflinePlaces() {
  phoneFiles?.takePlaces().then(async ({ places }) => {
    for (const p of places ?? []) await put("player/places", { path: p.path, t: p.t, d: p.d }).catch(() => {})
    if (places?.length) loadPlaces(true)
  }, () => {})
}
