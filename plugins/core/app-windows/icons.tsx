// Apps' own icons (the helper draws them from the Mac's), for their tabs and the picker; the generic one until one comes.
import { forwardRef, useSyncExternalStore } from "react"
import { AppWindow, type LucideIcon, type LucideProps } from "lucide-react"
import { appWindows } from "@vaultite"

const icons = new Map<string, string>()
const subs = new Set<() => void>()
let wanted: Set<string> | null = null
/** Asked for together: a list's worth in one call. */
function want(bundle: string) {
  // (an id the Mac app refuses, PrusaSlicer's "com.prusa3d.slic3r/", would fail the whole list: it keeps the generic one)
  if (icons.has(bundle) || !appWindows?.icons || !/^[\w.-]+$/.test(bundle)) return
  if (!wanted) {
    wanted = new Set()
    queueMicrotask(() => {
      const bundles = [...wanted!]
      wanted = null
      for (const b of bundles) icons.set(b, "")
      void appWindows!.icons!(bundles).then((r) => {
        for (const b of bundles) icons.set(b, r.icons?.[b] ?? "")
        subs.forEach((f) => f())
      }, () => { for (const b of bundles) icons.delete(b) })
    })
  }
  wanted.add(bundle)
}

function useIcon(bundle: string) {
  want(bundle)
  return useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => icons.get(bundle) || "")
}

export function AppIcon({ bundle, className }: { bundle: string; className?: string }) {
  const src = useIcon(bundle)
  return src ? <img src={src} alt="" draggable={false} className={className} /> : <AppWindow className={className} strokeWidth={1.75} />
}

const components = new Map<string, LucideIcon>()
/** As a tab's icon (a lucide icon's props), one per app so a tab isn't drawn afresh. */
export function appIcon(bundle: string): LucideIcon {
  let c = components.get(bundle)
  if (!c) {
    c = forwardRef<SVGSVGElement, LucideProps>(({ className }, _ref) => <AppIcon bundle={bundle} className={className} />) as unknown as LucideIcon
    components.set(bundle, c)
  }
  return c
}
