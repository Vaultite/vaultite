// Sites' icons for their tabs and the Web pages panel (the desktop app fetches and keeps them, electron/web.ts); the
// globe until one comes, and again if one can't be drawn.
import { forwardRef, useSyncExternalStore } from "react"
import { Globe, type LucideIcon, type LucideProps } from "lucide-react"
import { webPages } from "@vaultite"
import { hostOf } from "./address"

/** By host: a data URL, "" for none (yet, or one that couldn't be drawn). */
const icons = new Map<string, string>()
const subs = new Set<() => void>()
const changed = () => subs.forEach((f) => f())
let wanted: Set<string> | null = null
/** Asked for together: a tab bar's worth in one call. */
function want(host: string) {
  if (!host || icons.has(host) || !webPages?.icons) return
  if (!wanted) {
    wanted = new Set()
    queueMicrotask(() => {
      const hosts = [...wanted!]
      wanted = null
      for (const h of hosts) icons.set(h, "")
      void webPages!.icons!(hosts).then((r) => {
        for (const h of hosts) { const v = r?.[h]; if (typeof v === "string" && v.startsWith("data:image/") && !icons.get(h)) icons.set(h, v) }
        changed()
      }, () => { for (const h of hosts) icons.delete(h) })
    })
  }
  wanted.add(host)
}

/** A page told its site's icon (the plugin's events). */
export function iconCame(host: string, icon: string) {
  if (!host || typeof icon !== "string" || !icon.startsWith("data:image/") || icons.get(host) === icon) return
  icons.set(host, icon)
  changed()
}

function useIcon(host: string) {
  want(host)
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => icons.get(host) || "")
}

export function SiteIcon({ host, className }: { host: string; className?: string }) {
  const src = useIcon(host)
  return src
    ? <img src={src} alt="" draggable={false} className={`${className ?? ""} object-contain`}
        onError={() => { if (icons.get(host) === src) { icons.set(host, ""); changed() } }} />
    : <Globe className={className} strokeWidth={1.75} />
}

const components = new Map<string, LucideIcon>()
/** As a tab's icon (a lucide icon's props), one per site so a tab isn't drawn afresh. */
export function siteIcon(url: string): LucideIcon {
  const host = hostOf(url)
  let c = components.get(host)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(({ className }, _ref) => <SiteIcon host={host} className={className} />) as unknown as LucideIcon
    components.set(host, c)
  }
  return c
}
