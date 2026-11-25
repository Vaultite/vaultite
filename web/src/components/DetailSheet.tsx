import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, X } from "lucide-react"
import { confirmDialog } from "@/components/ConfirmDialog"
import { onAway } from "@/core/away"
import { whereNow } from "@/core/files"
import { holdFocus } from "@/core/focus"
import { closePalette } from "@/components/Palette"
import { lockPage } from "@/core/pagelock"
import { isDesktop } from "@/core/platform"
import { trackUnsaved } from "@/core/unsaved"
import { BOTTOM_BAR, BAR_SLOT } from "@/components/PhoneBar"
import { cn } from "@/lib/utils"
import { closestOf, focusableOf } from "@/core/dom"

const guards = new Set<{ current: () => string[] }>()
const InSheet = createContext(false)
const Wide = createContext(false)

export const useWideSheet = () => useContext(Wide)

/** Buttons for the sheet's header, left of Close (a glance's Open in tab). */
export function SheetActions({ children }: { children: ReactNode }) {
  const host = document.getElementById("sheet-actions")
  return host ? createPortal(children, host) : null
}

/** A form in a sheet that isn't saved as you type: closing the sheet while `lost()` has lines asks first, showing them. */
export function useSheetGuard(lost: () => string[]) {
  const ref = useRef(lost)
  ref.current = lost
  const inSheet = useContext(InSheet)
  useEffect(() => {
    if (!inSheet) return
    guards.add(ref)
    const untrack = trackUnsaved(() => ref.current().length > 0)
    return () => { guards.delete(ref); untrack() }
  }, [inSheet])
}

async function leave(go: () => void) {
  const lost = [...guards].flatMap((g) => g.current())
  if (lost.length && !(await confirmDialog({ title: "Discard what you wrote?", body: lost.join("\n"), confirm: "Discard", danger: true }))) return
  guards.clear()
  go()
}

function onBackdrop(e: ReactMouseEvent<HTMLDialogElement>) {
  if (e.target !== e.currentTarget) return false
  const r = e.currentTarget.getBoundingClientRect()
  return e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right
}

function movedTo(detail: string) {
  if (!detail.startsWith("file/")) return detail
  try { return `file/${encodeURIComponent(whereNow(decodeURIComponent(detail.slice(5)), 0))}` } catch { return detail }
}

export function DetailSheet({ open, onClose, onBack, backLabel, title, path, depth, still, own, wide, fill, children }: {
  open: boolean; onClose: () => void
  wide?: boolean
  fill?: boolean
  own?: boolean
  still?: boolean
  onBack?: () => void; backLabel?: string
  title?: string
  path: string; depth: number
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const close = () => void leave(onClose)
  const back = onBack && (() => void leave(onBack))
  const scroller = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; t: number; quit: () => void } | null>(null)
  const [dy, setDy] = useState(0)
  const [compact, setCompact] = useState(false)
  // A long-press opens it with the finger still down, and lifting it then clicks the backdrop.
  const openedAt = useRef(0)

  useEffect(() => {
    const d = ref.current
    if (!d || !open) return
    closePalette()
    const release = isDesktop() ? holdFocus() : null
    // Phones: closing a dialog refocuses what had focus, which would pop the keyboard, so blur first.
    focusableOf(document.activeElement)?.blur()
    const unlock = lockPage()
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "") // pre-15.4 iOS: no <dialog>
      d.focus(); openedAt.current = performance.now()
    }
    setDy(0)
    return () => { if (d.open) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open") } unlock(); release?.() }
  }, [open])

  const key = `${depth}:${path}`
  const pos = useRef(new Map<string, number>())
  const shown = useRef<{ key: string; depth: number; path: string } | null>(null)
  const dir = !shown.current || shown.current.key === key ? "" : depth > shown.current.depth ? "push" : depth < shown.current.depth ? "pop" : ""
  const [anim, setAnim] = useState("")
  // Offsets, not rects: they ignore the open animation's transform, and are 0 while the dialog is still hidden.
  const syncCompact = () => {
    const sc = scroller.current, t = sc?.querySelector<HTMLElement>("#sheet-title")
    ref.current?.toggleAttribute("data-scrolled", !!sc && sc.scrollTop > 0)
    setCompact(!!sc && !!t && t.offsetHeight > 0 && sc.scrollTop > t.offsetTop + t.offsetHeight - 4)
  }
  useLayoutEffect(() => {
    const sc = scroller.current
    if (!open || !sc) { shown.current = null; return }
    const was = shown.current
    if (!was || depth > was.depth) for (const k of [...pos.current.keys()]) if (Number(k.split(":")[0]) >= depth) pos.current.delete(k)
    const moved = was && was.depth === depth && was.key !== key && movedTo(was.path) === path
    const want = pos.current.get(key) ?? (moved ? pos.current.get(was.key) : 0) ?? 0
    sc.scrollTop = want
    shown.current = { key, depth, path }
    setAnim(dir)
    syncCompact()
    if (want && Math.abs(sc.scrollTop - want) > 2 && sc.firstElementChild) {
      const ro = new ResizeObserver(() => {
        sc.scrollTop = want
        pos.current.set(key, sc.scrollTop)
        if (Math.abs(sc.scrollTop - want) <= 2) stop()
      })
      const stop = () => { ro.disconnect(); clearTimeout(t); sc.removeEventListener("wheel", stop); sc.removeEventListener("touchstart", stop) }
      const t = setTimeout(stop, 2500)
      sc.addEventListener("wheel", stop, { passive: true })
      sc.addEventListener("touchstart", stop, { passive: true })
      ro.observe(sc.firstElementChild)
      return stop
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restores scroll only when the entry or open changes
  }, [key, open])

  const bar = !!wide && isDesktop()
  const floating = !onBack && !bar && !fill
  const letGo = () => { drag.current?.quit(); drag.current = null; setDy(0) }
  const header = {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === "mouse" || closestOf(e.target, "button")) return
      drag.current?.quit()
      drag.current = { y: e.clientY, t: e.timeStamp, quit: onAway(letGo) }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: PointerEvent) => { if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y)) },
    onPointerUp: (e: PointerEvent) => {
      if (!drag.current) return
      const flick = dy > 24 && dy / Math.max(e.timeStamp - drag.current.t, 1) > 0.6
      letGo()
      if (dy > 90 || flick) close()
    },
    onPointerCancel: () => letGo(),
  }

  return (
    <dialog ref={ref} aria-labelledby="sheet-title" tabIndex={-1}
      onCancel={(e) => { e.preventDefault(); close() }}
      onClick={(e) => { if (onBackdrop(e) && performance.now() - openedAt.current >= 400) close() }}
      style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}
      className={cn(
        "sheet-h m-0 flex w-full max-w-none flex-col overflow-hidden overscroll-none border-0 p-0 text-foreground outline-none max-md:pr-[env(safe-area-inset-right)] max-md:pl-[env(safe-area-inset-left)]",
        "bg-card md:shadow-2xl md:ring-1 md:ring-border/40 md:bg-card/90 md:backdrop-blur-2xl md:backdrop-saturate-200",
        "inset-0 transition-transform duration-(--motion)",
        "md:inset-0 md:m-auto md:max-h-[80dvh] md:w-[calc(100%-2rem)] md:max-w-[560px] md:rounded-[12px]",
        wide && "md:max-h-none md:max-w-none md:rounded-[14px]", wide && (fill ? "md:h-[92dvh] md:w-[92vw]" : "md:h-[86dvh] md:w-[80vw]"),
        "backdrop:bg-black/35",
        !still && "open:animate-in open:slide-in-from-bottom open:duration-300",
        "md:open:fade-in md:open:zoom-in-95 md:open:slide-in-from-bottom-0 md:open:duration-(--motion)",
        "[&:not([open])]:hidden",
      )}>
      <header className={cn(
        "z-10 shrink-0 touch-none select-none",
        floating ? "absolute inset-x-0 top-0" : "relative", own && "max-md:pointer-events-none",
        (compact || bar) && "shadow-[0_0.5px_0_var(--border)]", compact && floating && "bg-card",
      )} {...header}>
        <div className="h-[env(safe-area-inset-top)] md:hidden" aria-hidden />
        <div className={cn("group relative flex h-11 items-center justify-between pr-[7px] pl-1.5 md:h-14 md:pr-[11px] md:pl-3", bar && "gap-1 md:h-12")}>
          {onBack ? (
            <button type="button" onClick={back} aria-label={backLabel && backLabel !== "Back" ? `Back to ${backLabel}` : "Back"}
              className="flex min-h-11 max-w-[44%] cursor-pointer items-center gap-0.5 rounded-[8px] pr-2 text-[17px] text-primary active:opacity-50">
              <ChevronLeft className="size-[26px] shrink-0" strokeWidth={2.25} />
              <span className="truncate">{backLabel || "Back"}</span>
            </button>
          ) : <span />}
          {bar && <div className={cn("min-w-0 flex-1 truncate text-[15px] font-semibold", !onBack && "pl-2")}>{title}</div>}
          {title && !bar && (
            <div aria-hidden className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 truncate text-center text-[17px] font-semibold transition-opacity duration-(--motion-fast)",
              onBack ? "inset-x-[128px]" : "inset-x-14 group-has-[#sheet-actions:not(:empty)]:inset-x-[100px]",
              compact || fill ? "opacity-100" : "opacity-0",
            )}>{title}</div>
          )}
          <div id="sheet-actions" className="ml-auto flex items-center empty:hidden" />
          <button type="button" aria-label="Close" onClick={close}
            className="hidden size-11 cursor-pointer md:grid place-items-center text-muted-foreground transition-colors hover:text-foreground active:opacity-50">
            <X className="size-[18px]" strokeWidth={2.25} />
          </button>
        </div>
      </header>
      {/* flex-auto, not flex-1: the sheet has no height of its own, and iOS WebKit sizes a 0% basis in it as 0. */}
      <div ref={scroller} onScroll={(e) => { pos.current.set(key, e.currentTarget.scrollTop); syncCompact() }}
        className={fill ? "relative min-h-0 flex-auto overflow-hidden max-md:pb-(--phone-bar)" : cn(
          "relative min-h-0 flex-auto overflow-x-hidden overflow-y-auto overscroll-contain px-5 pb-[calc(var(--phone-bar)+1.5rem)] [scrollbar-gutter:stable] md:px-6 md:pb-7",
          "pr-[max(0px,calc(--spacing(5)-var(--scrollbar-room,0px)))] md:pr-[max(0px,calc(--spacing(6)-var(--scrollbar-room,0px)))]",
          floating ? cn("md:pt-[17px]", !own && "pt-[calc(env(safe-area-inset-top)+22px)]") : "pt-1",
        )}>
        {open && (
          <div key={key} className={cn(fill && "h-full", anim && "animate-in fade-in duration-(--motion)", anim === "push" && "slide-in-from-right-8", anim === "pop" && "slide-in-from-left-8")}>
            <InSheet.Provider value><Wide.Provider value={!!wide}>{children}</Wide.Provider></InSheet.Provider>
          </div>
        )}
      </div>
      <footer data-sheet-bar className={cn("sight-foot glass-strong z-10 grid grid-cols-5 gap-0.5 md:hidden", BOTTOM_BAR)}>
        <div id="sheet-bar" className="contents" />
        <button type="button" data-sheet-done onClick={close} className={cn(BAR_SLOT, "col-start-5 text-[17px] font-semibold")}>Done</button>
      </footer>
    </dialog>
  )
}
