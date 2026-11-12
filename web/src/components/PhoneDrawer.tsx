import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronsUpDown } from "lucide-react"
import { APP_PAGES, appPageOf, hrefOf, openAppPage } from "@/core/apppages"
import { onAway } from "@/core/away"
import type { Store } from "@/core/data"
import { fingerHolding } from "@/core/drag"
import { haptic } from "@/core/haptics"
import { route } from "@/core/nav"
import { usePageLock } from "@/core/pagelock"
import { drawerPanels, phoneDock, setDrawerOpener, useSidebars, type Side } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { menuFor } from "@/components/ContextMenu"
import { Drawn, Guard } from "@/components/Guard"
import { panelMenu, SidebarPanels } from "@/components/Sidebar"
import { cn } from "@/lib/utils"
import { share } from "@/core/share"
import { SharedWith } from "@/components/SharedWith"
import { selecting } from "@/core/select"
import { signal } from "@/core/signal"

let out: Side | null = null
const subs = signal()
setDrawerOpener((side) => openDrawer(side))

export function openDrawer(side: Side | null) {
  if (out === side) return
  out = side
  subs.notify()
}
export const drawerOut = () => out
const useDrawer = () => subs.use(() => out)
export function useHasDrawer(side: Side) {
  const { disabled } = usePrefs()
  const s = useSidebars()
  return drawerPanels(side, s, disabled).length > 0 || (side === "left" && phoneDock(s, disabled).length > 0)
}

const EASE = "cubic-bezier(.2,.8,.2,1)"
const width = () => Math.min(innerWidth * 0.86, 360)
const EDGE = 18

export function PhoneDrawers({ store, file, tab, vaultName, vaultMenu }: { store: Store; file: string; tab: string; vaultName: string
  vaultMenu: (e: React.MouseEvent) => void }) {
  const side = useDrawer()
  usePageLock(!!side)
  useEffect(() => { if (side) document.documentElement.dataset.drawer = side; else delete document.documentElement.dataset.drawer }, [side])
  const has = { left: useHasDrawer("left"), right: useHasDrawer("right") }
  const [drawn, setDrawn] = useState<Side | null>(null)
  const panel = useRef<HTMLDivElement>(null), shade = useRef<HTMLDivElement>(null)
  const drag = useRef<{ side: Side; x: number; y: number; axis: "x" | "y" | null; from: number; p: number; t: number; v: number; quit?: () => void } | null>(null)
  const pos = useRef(0)

  const place = (s: Side, p: number, ms = 0) => {
    pos.current = p
    const el = panel.current, bg = shade.current
    if (!el || !bg) return
    const t = ms ? `${ms}ms ${EASE}` : ""
    // Put there at once: a running slide would carry on from where it was.
    if (!ms) for (const a of [...el.getAnimations(), ...bg.getAnimations()]) a.cancel()
    el.style.transition = t && `transform ${t}`
    el.style.transform = `translateX(${(s === "left" ? -1 : 1) * (1 - p) * 100}%)`
    bg.style.transition = t && `opacity ${t}`
    bg.style.opacity = String(p)
    bg.style.pointerEvents = p > 0 ? "auto" : "none"
  }

  // Before paint, layout forced: a leftover transition would slide the right drawer in from the left.
  useLayoutEffect(() => {
    const s = side ?? drawn
    if (!s) return
    place(s, pos.current)
    panel.current?.getBoundingClientRect()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when the drawn side changes
  }, [side ?? drawn])

  useEffect(() => {
    if (side) { setDrawn(side); requestAnimationFrame(() => place(side, 1, 280)); return }
    if (!drawn) return
    place(drawn, 0, 240)
    const t = setTimeout(() => { if (!out && !drag.current) { place(drawn, 0); setDrawn(null) } }, 260)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs only when a drawer opens or closes
  }, [side])

  useEffect(() => {
    let was = route().tab
    const on = () => {
      const now = route().tab
      if (now === was) return
      was = now
      const typing = document.activeElement?.closest("[data-phone-drawer]") && document.activeElement.matches("input, textarea, [contenteditable]")
      if (out && !typing) openDrawer(null)
    }
    addEventListener("hashchange", on)
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && out) openDrawer(null) }
    addEventListener("keydown", esc)
    return () => { removeEventListener("hashchange", on); removeEventListener("keydown", esc) }
  }, [])

  const start = (e: React.PointerEvent, s: Side, from: number) => {
    if (e.pointerType === "mouse" && e.button) return
    drag.current?.quit?.()
    drag.current = { side: s, x: e.clientX, y: e.clientY, axis: null, from, p: from, t: e.timeStamp, v: 0 }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    if (fingerHolding()) { drag.current = null; return }
    const mx = e.clientX - d.x, my = e.clientY - d.y
    if (!d.axis) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
        d.axis = "x"
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch {}
        d.quit = onAway(end)
        if (drawn !== d.side) setDrawn(d.side)
      } else if (Math.abs(my) > 8) { d.axis = "y"; drag.current = null; return }
    }
    if (d.axis !== "x") return
    const p = Math.max(0, Math.min(1, d.from + ((d.side === "left" ? 1 : -1) * mx) / width()))
    const dt = Math.max(1, e.timeStamp - d.t)
    d.v = (p - d.p) / dt
    d.p = p; d.t = e.timeStamp
    place(d.side, p)
  }
  const end = () => {
    const d = drag.current
    drag.current = null
    d?.quit?.()
    if (!d || d.axis !== "x") return
    const open = Math.abs(d.v) > 0.0015 ? d.v > 0 : d.from ? d.p > 0.66 : d.p > 0.33
    if (open !== (out === d.side)) haptic("soft")
    if (open && out === d.side) place(d.side, 1, 220)
    else if (!open && !out) { place(d.side, 0, 220); setTimeout(() => { if (!out && !drag.current) { place(d.side, 0); setDrawn(null) } }, 240) }
    else openDrawer(open ? d.side : null)
  }
  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end }

  const shown = side ?? drawn
  return (
    <>
      {!side && (["left", "right"] as const).filter((s) => has[s]).map((s) => (
        <div key={s} aria-hidden data-drawer-edge={s} onPointerDown={(e) => start(e, s, 0)} {...handlers}
          className={cn("fixed inset-y-0 z-20 md:hidden", s === "left" ? "left-0" : "right-0")} style={{ width: EDGE, touchAction: "pan-y" }} />
      ))}
      <div ref={shade} aria-hidden onPointerDown={(e) => shown && start(e, shown, 1)} {...handlers}
        onClick={() => { if (pos.current === 1) openDrawer(null) }}
        className="fixed inset-0 z-40 bg-black/40 md:hidden" style={{ opacity: 0, pointerEvents: "none", touchAction: "pan-y" }} />
      <div ref={panel} data-phone-drawer={shown ?? undefined} role="dialog" aria-label={shown === "right" ? "Right sidebar" : "Sidebar"} aria-hidden={!side}
        onPointerDown={(e) => shown && start(e, shown, 1)} {...handlers}
        onClick={(e) => {
          const t = e.target as Element
          if (e.defaultPrevented || selecting()) return
          if (t.closest("[data-tree-path]:not([data-tree-folder]), a[href^='#']") && !t.closest("[aria-haspopup], [data-no-drag]")) setTimeout(() => openDrawer(null))
        }}
        className={cn("fixed inset-y-0 z-40 flex flex-col bg-sidebar shadow-xl md:hidden", shown === "right" ? "right-0" : "left-0", !shown && "invisible")}
        style={{ width: "min(86vw, 360px)", transform: `translateX(${shown === "right" ? 100 : -100}%)`, touchAction: "pan-y" }}>
        {shown && has[shown] && <DrawerBody side={shown} store={store} file={file} tab={tab} vaultName={vaultName} vaultMenu={vaultMenu} />}
      </div>
    </>
  )
}

function DrawerBody({ side, store, file, tab, vaultName, vaultMenu }: { side: Side; store: Store; file: string; tab: string; vaultName: string
  vaultMenu: (e: React.MouseEvent) => void }) {
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
          <button type="button" onClick={vaultMenu} aria-haspopup="menu"
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
}

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
