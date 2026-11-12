// This page's build and the server's (core/webbuild.ts, heard by live.ts). A new one is offered with Reload, and taken
// by itself while nobody's looking and a reload loses nothing (unsaved.ts): the next look is the new build.
import { useSyncExternalStore } from "react"
import { notify } from "@/core/notify"
import { safeToReload } from "@/core/unsaved"
import { buildName, STAMP_META, stampOf, type Stamp } from "../../../core/buildstamp.ts"

/** This page's build: its entry script's name and its import map's hash, as the server names it (core/webbuild.ts; in
 *  development there's none). */
export const BUILD: string | null = (() => {
  try {
    const src = document.querySelector<HTMLScriptElement>('script[type="module"][src*="assets/"]')?.src
    return src ? buildName(src.slice(src.lastIndexOf("/") + 1), document.querySelector('script[type="importmap"]')?.textContent ?? undefined) : null
  } catch { return null }
})()
/** The commit this page was built from (vite.config.ts stamps it). */
export const PAGE_STAMP: Stamp | null = (() => {
  try { return stampOf(document.querySelector<HTMLMetaElement>(`meta[name="${STAMP_META}"]`)?.content) } catch { return null }
})()

let served: string | null = null
const subs = new Set<() => void>()
const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
/** The build the server serves, as it last said (null: not yet, or none: development). */
export const useServedBuild = () => useSyncExternalStore(subscribe, () => served)
/** This page runs an older build than the server serves. */
const behind = () => !!BUILD && !!served && served !== BUILD

/** The offer to reload into the new build (here, and where a chunk of this one is gone: errors.ts). */
export const offerNewBuild = () => notify("A new version of Vaultite is ready", { id: "update", duration: Infinity, action: { label: "Reload", run: () => location.reload() } })

/** What the server says it serves (its hello, and `web` when that changes). */
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

/** A new build's files the app starts with, fetched now (each kept for good: named by content), so the reload or next
 *  launch into it starts warm, not as a first visit over a phone's network. */
let fetched: string | null = null
function fetchBuild(entry: string) {
  if (fetched === entry) return
  fetched = entry
  fetch(new URL(".", location.href), { cache: "no-cache" }).then((r) => r.text()).then((html) => {
    for (const [, f] of html.matchAll(/<(?:script|link)\b[^>]*?(?:src|href)="\.?\/?(assets\/[^"]+\.(?:js|css))"/g))
      void fetch(new URL(f, location.href), { priority: "low" }).then((r) => r.arrayBuffer()).catch(() => {})
  }).catch(() => { fetched = null })
}

// Hidden (the phone app in the background, the window minimized or covered), it reloads into the new build once a
// reload loses nothing: a moment after it hid (not on a glance away), and again later while something holds it.
const AWAY_MS = 2000, AGAIN_MS = 5000
const RELOADED = "vaultite.reloadedInto"
let watching = false, timer = 0
function whenAway() {
  if (timer || !behind() || document.visibilityState !== "hidden") return
  timer = window.setTimeout(() => {
    timer = 0
    if (!behind() || document.visibilityState !== "hidden") return
    if (!safeToReload()) { timer = window.setTimeout(() => { timer = 0; whenAway() }, AGAIN_MS); return }
    // Once per build: a reload that didn't bring it (a cache in the way) leaves the offer, not a loop.
    try {
      if (sessionStorage.getItem(RELOADED) === served) return
      sessionStorage.setItem(RELOADED, served!)
    } catch { return }
    location.reload()
  }, AWAY_MS)
}
