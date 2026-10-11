// Apps' own icons (the helper draws them from the Mac's), for their tabs and the picker; the generic one until one comes.
import { forwardRef } from "react"
import { AppWindow, type LucideIcon, type LucideProps } from "lucide-react"
import { appWindows, cell } from "@vaultite"

const icons = cell(new Map<string, string>())
const setIcons = (f: (m: Map<string, string>) => void) => icons.update((m) => { const next = new Map(m); f(next); return next })
let wanted: Set<string> | null = null
/** Asked for together: a list's worth in one call. */
function want(bundle: string) {
  // (an id the Mac app refuses, PrusaSlicer's "com.prusa3d.slic3r/", would fail the whole list: it keeps the generic one)
  if (icons.get().has(bundle) || !appWindows?.icons || !/^[\w.-]+$/.test(bundle)) return
  if (!wanted) {
    wanted = new Set()
    queueMicrotask(() => {
      const bundles = [...wanted!]
      wanted = null
      setIcons((m) => { for (const b of bundles) m.set(b, "") })
      void appWindows!.icons!(bundles).then((r) => setIcons((m) => { for (const b of bundles) m.set(b, r.icons?.[b] ?? "") }),
        () => setIcons((m) => { for (const b of bundles) m.delete(b) }))
    })
  }
  wanted.add(bundle)
}

function useIcon(bundle: string) {
  want(bundle)
  return icons.use((m) => m.get(bundle) || "")
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
