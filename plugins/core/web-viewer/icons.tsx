// Sites' icons for their tabs and the Web pages panel (the desktop app fetches and keeps them, electron/web.ts); the
// globe until one comes, and again if one can't be drawn.
import { forwardRef } from "react"
import { Globe, type LucideIcon, type LucideProps } from "lucide-react"
import { cell, webPages } from "@vaultite"
import { hostOf } from "./address"

/** By host: a data URL, "" for none (yet, or one that couldn't be drawn). */
const icons = cell(new Map<string, string>())
const setIcons = (f: (m: Map<string, string>) => void) => icons.update((m) => { const next = new Map(m); f(next); return next })
let wanted: Set<string> | null = null
/** Asked for together: a tab bar's worth in one call. */
function want(host: string) {
  if (!host || icons.get().has(host) || !webPages?.icons) return
  if (!wanted) {
    wanted = new Set()
    queueMicrotask(() => {
      const hosts = [...wanted!]
      wanted = null
      setIcons((m) => { for (const h of hosts) m.set(h, "") })
      void webPages!.icons!(hosts).then((r) => setIcons((m) => {
        for (const h of hosts) { const v = r?.[h]; if (typeof v === "string" && v.startsWith("data:image/") && !m.get(h)) m.set(h, v) }
      }), () => setIcons((m) => { for (const h of hosts) m.delete(h) }))
    })
  }
  wanted.add(host)
}

/** A page told its site's icon (the plugin's events). */
export function iconCame(host: string, icon: string) {
  if (!host || typeof icon !== "string" || !icon.startsWith("data:image/") || icons.get().get(host) === icon) return
  setIcons((m) => { m.set(host, icon) })
}

function useIcon(host: string) {
  want(host)
  return icons.use((m) => m.get(host) || "")
}

export function SiteIcon({ host, className }: { host: string; className?: string }) {
  const src = useIcon(host)
  return src
    ? <img src={src} alt="" draggable={false} className={`${className ?? ""} object-contain`}
        onError={() => { if (icons.get().get(host) === src) setIcons((m) => { m.set(host, "") }) }} />
    : <Globe className={className} strokeWidth={1.75} />
}

const components = new Map<string, LucideIcon>()
/** As a tab's icon (a lucide icon's props), one per site and container colour so a tab isn't drawn afresh; a tab in a
 *  container has its colour as a bar under the icon, as Firefox's do. */
export function siteIcon(url: string, color?: string): LucideIcon {
  const host = hostOf(url), key = `${host} ${color ?? ""}`
  let c = components.get(key)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(({ className }, _ref) => color
      ? <span className={`${className ?? ""} relative inline-grid`} data-container-tint>
          <SiteIcon host={host} className="size-full" />
          <span className="absolute inset-x-0 -bottom-[3px] h-[2px] rounded-full" style={{ background: color }} />
        </span>
      : <SiteIcon host={host} className={className} />) as unknown as LucideIcon
    components.set(key, c)
  }
  return c
}
