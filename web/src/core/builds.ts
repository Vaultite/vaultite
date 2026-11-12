import { useSyncExternalStore } from "react"
import { notify } from "@/core/notify"
import { safeToReload } from "@/core/unsaved"
import { buildName, STAMP_META, stampOf, type Stamp } from "../../../core/buildstamp.ts"

export const BUILD: string | null = (() => {
  try {
    const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/"]')?.src
    return src ? buildName(src.slice(src.lastIndexOf("/") + 1), document.querySelector('script[type="importmap"]')?.textContent ?? undefined) : null
  } catch { return null }
})()
export const PAGE_STAMP: Stamp | null = (() => {
  try { return stampOf(document.querySelector<HTMLMetaElement>(`meta[name="${STAMP_META}"]`)?.content) } catch { return null }
})()

let served: string | null = null
const subs = new Set<() => void>()
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const useServedBuild = () => useSyncExternalStore(subscribe, () => served)
const behind = () => !!BUILD && !!served && served !== BUILD

export const offerNewBuild = () => notify("A new version of Vaultite is ready", { id: "update", duration: Infinity, action: { label: "Reload", run: () => location.reload() } })

export function heardBuild(entry: string | null | undefined) {
  if (!entry || entry === served) return
  served = entry
  for (const f of [...subs]) f()
  if (!behind()) return
  offerNewBuild()
  fetchBuild(entry)
  if (!watching) { watching = true; document.addEventListener("visibilitychange", whenAway) }
  whenAway()
}

let fetched: string | null = null
function fetchBuild(entry: string) {
  if (fetched === entry) return
  fetched = entry
  fetch(new URL(".", location.href), { cache: "no-cache" }).then((r) => r.text()).then((html) => {
    for (const [, f] of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g))
      void fetch(new URL(f, location.href), { priority: "low" }).then((r) => r.arrayBuffer()).catch(() => {})
  }).catch(() => { fetched = null })
}

const AWAY_MS = 2000, AGAIN_MS = 5000
const RELOADED = "vaultite.reloadedInto"
let watching = false, timer = 0
function whenAway() {
  if (timer || !behind() || document.visibilityState !== "hidden") return
  timer = window.setTimeout(() => {
    timer = 0
    if (!behind() || document.visibilityState !== "hidden") return
    if (!safeToReload()) { timer = window.setTimeout(() => { timer = 0; whenAway() }, AGAIN_MS); return }
    try {
      if (sessionStorage.getItem(RELOADED) === served) return
      sessionStorage.setItem(RELOADED, served!)
    } catch { return }
    location.reload()
  }, AWAY_MS)
}
