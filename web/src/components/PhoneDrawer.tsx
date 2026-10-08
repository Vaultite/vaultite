// Phones: the sidebars as drawers, with the same panels a size up. Screen edges are always the
// drawers' (Back and Forward are the bar's buttons); panels draw only while a drawer is out.
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronsUpDown, Puzzle, Settings as SettingsIcon } from "lucide-react"
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
import { selecting } from "@/core/select"
import { signal } from "@/core/signal"

let out: Side | null = null
const subs = signal()
setDrawerOpener((side) => openDrawer(side))

/** Open a drawer (null: close the one that's out). */
export function openDrawer(side: Side | null) {
  if (out === side) return
  out = side
  subs.notify()
}
/** The drawer that's out, if one is. */
export const drawerOut = () => out
const useDrawer = () => subs.use(() => out)
/** Whether a sidebar has panels to show (the right one often has none: then there's no right drawer); the left one
 *  has the dock too. */
export function useHasDrawer(side: Side) {
  const { disabled, order } = usePrefs()
  const s = useSidebars()
  return drawerPanels(side, s, disabled, order).length > 0 || (side === "left" && phoneDock(s, disabled, order).length > 0)
}

const EASE = "cubic-bezier(.2,.8,.2,1)"
/** How wide a drawer is: most of the screen, never wider than a sidebar needs. */
const width = () => Math.min(innerWidth * 0.86, 360)
/** The strip along each edge a swipe starts in (px). */
const EDGE = 18

export function PhoneDrawers({ store, file, tab, vaultName, vaultMenu }: { store: Store; file: string; tab: string; vaultName: string
  /** The vault menu (App's), when it has items. */
  vaultMenu: (e: React.MouseEvent) => void }) {
  const side = useDrawer()
  usePageLock(!!side)
  const has = { left: useHasDrawer("left"), right: useHasDrawer("right") }
  // Which drawer is drawn: the one out, or the one a finger is pulling, until it has slid away.
  const [drawn, setDrawn] = useState<Side | null>(null)
  const panel = useRef<HTMLDivElement>(null), shade = useRef<HTMLDivElement>(null)
  const drag = useRef<{ side: Side; x: number; y: number; axis: "x" | "y" | null; from: number; p: number; t: number; v: number; quit?: () => void } | null>(null)
  const pos = useRef(0)

  /** Put the drawer `p` of the way out (0 in, 1 out), animated over `ms`. */
  const place = (s: Side, p: number, ms = 0) => {
    pos.current = p
    const el = panel.current, bg = shade.current
    if (!el || !bg) return
    const t = ms ? `${ms}ms ${EASE}` : ""
    // Put there at once: a slide still running (or one a layout read started) would carry on from where it was.
    if (!ms) for (const a of [...el.getAnimations(), ...bg.getAnimations()]) a.cancel()
    el.style.transition = t && `transform ${t}`
    el.style.transform = `translateX(${(s === "left" ? -1 : 1) * (1 - p) * 100}%)`
    bg.style.transition = t && `opacity ${t}`
    bg.style.opacity = String(p)
    bg.style.pointerEvents = p > 0 ? "auto" : "none"
  }

  // The drawer changed sides (one element): place it on its edge before paint with no leftover transition, or the right
  // one slides in from the left. Panels' layout effects run first and may start a slide, so this cancels it.
  useLayoutEffect(() => {
    const s = side ?? drawn
    if (!s) return
    place(s, pos.current)
    panel.current?.getBoundingClientRect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side ?? drawn])

  // Opened or closed (a button, a swipe let go, something opened from it): slide there; once in, stop drawing it.
  useEffect(() => {
    if (side) { setDrawn(side); requestAnimationFrame(() => place(side, 1, 280)); return }
    if (!drawn) return
    place(drawn, 0, 240)
    const t = setTimeout(() => { if (!out && !drag.current) { place(drawn, 0); setDrawn(null) } }, 260)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [side])

  // Something opened from it (a file, a page, a terminal) or Back: it closes. Typing in it (its search field may
  // change the address as it goes) doesn't.
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

  // ---------- the finger ----------
  const start = (e: React.PointerEvent, s: Side, from: number) => {
    if (e.pointerType === "mouse" && e.button) return
    drag.current?.quit?.()
    drag.current = { side: s, x: e.clientX, y: e.clientY, axis: null, from, p: from, t: e.timeStamp, v: 0 }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) return
    // A finger that held a row picked it up (core/drag.ts): it's moving that, not the drawer.
    if (fingerHolding()) { drag.current = null; return }
    const mx = e.clientX - d.x, my = e.clientY - d.y
    if (!d.axis) {
      if (Math.abs(mx) > 8 && Math.abs(mx) > Math.abs(my)) {
        d.axis = "x"
        try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* not a live pointer */ }
        // The app sent away mid-swipe (core/away.ts): it settles as if let go there.
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
    // A flick decides; otherwise where it was let go: past a third out from the edge, past two thirds in from open.
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
      {/* The edges a swipe starts from, while no drawer is out (vertical scrolling passes through: pan-y). */}
      {!side && (["left", "right"] as const).filter((s) => has[s]).map((s) => (
        <div key={s} aria-hidden data-drawer-edge={s} onPointerDown={(e) => start(e, s, 0)} {...handlers}
          className={cn("fixed inset-y-0 z-20 md:hidden", s === "left" ? "left-0" : "right-0")} style={{ width: EDGE, touchAction: "pan-y" }} />
      ))}
      <div ref={shade} aria-hidden onPointerDown={(e) => shown && start(e, shown, 1)} {...handlers}
        onClick={() => { if (pos.current === 1) openDrawer(null) }}
        className="fixed inset-0 z-40 bg-black/40 md:hidden" style={{ opacity: 0, pointerEvents: "none", touchAction: "pan-y" }} />
      <div ref={panel} data-phone-drawer={shown ?? undefined} role="dialog" aria-label={shown === "right" ? "Right sidebar" : "Sidebar"} aria-hidden={!side}
        onPointerDown={(e) => shown && start(e, shown, 1)} {...handlers}
        // A page or a file tapped closes it even when it's the one on screen already (the address doesn't change).
        onClick={(e) => {
          const t = e.target as Element
          // (Selecting, a tap picks a row: it stays out.)
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

/** A drawer's panels, as the desktop sidebar draws them (a stack, each panel under its heading), a size up. */
function DrawerBody({ side, store, file, tab, vaultName, vaultMenu }: { side: Side; store: Store; file: string; tab: string; vaultName: string
  vaultMenu: (e: React.MouseEvent) => void }) {
  const { tab: on } = route()
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col px-2 pt-[max(env(safe-area-inset-top),0.5rem)] [zoom:1.2]">
        <SidebarPanels side={side} store={store} open phone file={file} tab={tab} />
      </div>
      {side === "left" && (
        <div className="shrink-0 border-t-[0.5px] border-border pt-1.5">
        <Dock store={store} file={file} tab={tab} />
        <nav aria-label="App" className="flex items-center gap-1 px-3 pb-[max(env(safe-area-inset-bottom),0.5rem)]">
          <button type="button" onClick={vaultMenu} aria-haspopup="menu"
            className="-ml-1.5 flex h-11 min-w-0 flex-1 cursor-pointer items-center gap-1.5 rounded-[10px] px-1.5 text-left active:bg-foreground/[0.06]">
            <span className="min-w-0 truncate text-[15px] font-semibold">{vaultName}</span>
            <ChevronsUpDown className="size-4 shrink-0 text-tertiary" strokeWidth={2} />
          </button>
          {([["plugins", "Plugins", Puzzle], ["settings", "Settings", SettingsIcon]] as const).map(([id, label, Icon]) => (
            <a key={id} href={`#${id}`} aria-label={label} aria-current={on === id ? "page" : undefined}
              className={cn("grid size-11 shrink-0 place-items-center rounded-[10px] active:bg-foreground/[0.06]", on === id ? "text-primary" : "text-muted-foreground")}>
              <Icon className="size-[21px]" strokeWidth={2} />
            </a>
          ))}
        </nav>
        </div>
      )}
    </>
  )
}

/** The dock: the docked panels' icons above the vault's row, where a thumb reaches them without scrolling the drawer. */
function Dock({ store, file, tab }: { store: Store; file: string; tab: string }) {
  const { disabled, order } = usePrefs()
  const docked = phoneDock(useSidebars(), disabled, order)
  if (!docked.length) return null
  return (
    // Its icons in line with the vault's name.
    <div aria-label="Dock" role="toolbar" data-phone-dock className="flex flex-col px-0.5">
      {docked.map(({ key, panel }) => (
        <div key={key} data-panel={key} onContextMenu={menuFor(() => panelMenu(key))}>
          <Guard what={`The ${panel.title} panel`}><Drawn draw={() => panel.render({ store, open: false, phone: true, dock: true, file, tab, panel: key })} /></Guard>
        </div>
      ))}
    </div>
  )
}
