import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import { APP_PAGES, appPageOf, hrefOf, openAppPage } from "@/core/apppages"
import type { Store } from "@/core/data"
import { route } from "@/core/nav"
import { usePageLock } from "@/core/pagelock"
import { useDesktop } from "@/core/platform"
import { phoneDock, useSidebars, type Side } from "@/core/plugins"
import { nicknameItems } from "@/core/nickname"
import { drawerOut, openDrawer, useDrawer, useHasDrawer } from "@/core/drawer"
import { usePrefs } from "@/core/prefs"
import { menuFor } from "@/components/ContextMenu"
import { shift, useDrawerMotion } from "@/components/drawerMotion"
import { Drawn, Guard } from "@/components/Guard"
import { panelMenu, SidebarPanels } from "@/components/Sidebar"
import { cn } from "@/lib/utils"
import { share } from "@/core/share"
import { SharedWith } from "@/components/SharedWith"
import { selecting } from "@/core/select"
import { closestOf } from "@/core/dom"

const SIDES = ["left", "right"] as const

type BodyProps = { store: Store; file: string; tab: string; vaultName: string; vaultMenu: (e: React.MouseEvent) => void }

function useTouched() {
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (touched) return
    const quit = new AbortController()
    const wake = () => setTimeout(() => startTransition(() => setTouched(true)))
    for (const t of ["pointerup", "pointercancel"]) addEventListener(t, wake, { capture: true, passive: true, signal: quit.signal })
    return () => quit.abort()
  }, [touched])
  return touched
}

/** Both drawers, drawn ahead once the first touch ends (not under a finger) and kept drawn while shut. */
export function PhoneDrawers({ vaultMenu, ...props }: BodyProps) {
  const side = useDrawer()
  const menu = useRef(vaultMenu)
  useLayoutEffect(() => { menu.current = vaultMenu })
  const [stableMenu] = useState(() => (e: React.MouseEvent) => menu.current(e))
  const touched = useTouched(), ahead = !useDesktop() && touched
  usePageLock(!!side)
  useEffect(() => { if (side) document.documentElement.dataset.drawer = side; else delete document.documentElement.dataset.drawer }, [side])
  const has = { left: useHasDrawer("left"), right: useHasDrawer("right") }
  const { boxes, shade, drawn, begin } = useDrawerMotion({ has, side, out: drawerOut, open: openDrawer })
  useEffect(closesOnLeaving, [])

  return (
    <>
      <div ref={shade} aria-hidden onPointerDown={(e) => drawn && begin(e, drawn)}
        onClick={() => { if (drawerOut()) openDrawer(null) }}
        className="fixed inset-0 z-40 bg-black/40 md:hidden" style={{ opacity: 0, pointerEvents: "none", touchAction: "pan-y" }} />
      {SIDES.map((s) => has[s] && (
        <div key={s} ref={boxes[s]} data-phone-drawer={drawn === s ? s : undefined} data-drawer-box role="dialog" aria-label={s === "right" ? "Right sidebar" : "Sidebar"} aria-hidden={side !== s} inert={side !== s}
          onPointerDown={(e) => begin(e, s)}
          onClick={(e) => {
            if (e.defaultPrevented || selecting()) return
            if (closestOf(e.target, "[data-tree-path]:not([data-tree-folder]), a[href^='#']") && !closestOf(e.target, "[aria-haspopup], [data-no-drag]")) setTimeout(() => openDrawer(null))
          }}
          className={cn("fixed inset-y-0 z-40 flex flex-col bg-sidebar shadow-xl md:hidden", s === "right" ? "right-0 pr-[env(safe-area-inset-right)]" : "left-0 pl-[env(safe-area-inset-left)]")}
          style={{ width: "min(86vw, 360px)", transform: shift(s, 0), touchAction: "pan-y" }}>
          {(ahead || drawn === s) && <DrawerBody side={s} vaultMenu={stableMenu} {...props} />}
        </div>
      ))}
    </>
  )
}

function closesOnLeaving() {
  let was = route().tab
  const on = () => {
    const now = route().tab
    if (now === was) return
    was = now
    const typing = document.activeElement?.closest("[data-phone-drawer]") && document.activeElement.matches("input, textarea, [contenteditable]")
    if (drawerOut() && !typing) openDrawer(null)
  }
  const quit = new AbortController()
  addEventListener("hashchange", on, quit)
  addEventListener("keydown", (e) => { if (e.key === "Escape" && drawerOut()) openDrawer(null) }, quit)
  return () => quit.abort()
}

const DrawerBody = memo(function DrawerBody({ side, store, file, tab, vaultName, vaultMenu }: BodyProps & { side: Side }) {
  const { tab: on } = route()
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col px-2 pt-[max(env(safe-area-inset-top),0.5rem)]">
        <div data-size-up className="flex min-h-0 flex-1 flex-col">
          <SidebarPanels side={side} store={store} open phone file={file} tab={tab} />
        </div>
      </div>
      {side === "left" && (
        <div className="shrink-0 border-t-[0.5px] border-border pt-1.5">
        <Dock store={store} file={file} tab={tab} />
        <nav aria-label="App" className="flex items-center gap-1 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          {share ? <SharedWith phone /> : (
          <button type="button" onClick={vaultMenu} onContextMenu={menuFor(nicknameItems)} aria-haspopup="menu"
            className="-ml-1.5 flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[10px] px-1.5 text-left active:bg-foreground/[0.06]">
            <span className="min-w-0 truncate text-[15px] font-semibold">{vaultName}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-tertiary" strokeWidth={2} />
          </button>)}
          {APP_PAGES.map((p) => (
            <a key={p.id} href={hrefOf(p)} aria-label={p.label} aria-current={appPageOf(on) === p ? "page" : undefined} data-app-page={p.id}
              onClick={(e) => { e.preventDefault(); openAppPage(p) }}
              className={cn("grid size-11 shrink-0 place-items-center rounded-[10px] active:bg-foreground/[0.06]", appPageOf(on) === p ? "text-primary" : "text-muted-foreground")}>
              <p.icon className="size-[21px]" strokeWidth={2} />
            </a>
          ))}
        </nav>
        </div>
      )}
    </>
  )
})

function Dock({ store, file, tab }: { store: Store; file: string; tab: string }) {
  const { disabled } = usePrefs()
  const docked = phoneDock(useSidebars(), disabled)
  if (!docked.length) return null
  return (
    <div aria-label="Dock" role="toolbar" data-phone-dock className="flex flex-col px-0.5">
      {docked.map(({ key, panel }) => (
        <div key={key} data-panel={key} data-ui={`panel:${key}`} onContextMenu={menuFor(() => panelMenu(key))}>
          <Guard what={`The ${panel.title} panel`}><Drawn draw={() => panel.render({ store, open: false, phone: true, dock: true, file, tab, panel: key })} /></Guard>
        </div>
      ))}
    </div>
  )
}
