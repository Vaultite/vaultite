// The one sheet for every detail view: don't add other modals; open things with openDetail(). A native modal <dialog>;
// on phones a bottom bar with Done, which asks first when the content has unsaved input (useSheetGuard).
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from "react"
import { ChevronLeft, X } from "lucide-react"
import { confirmDialog } from "@/components/ConfirmDialog"
import { onAway } from "@/core/away"
import { whereNow } from "@/core/files"
import { holdFocus } from "@/core/focus"
import { lockPage } from "@/core/pagelock"
import { isDesktop } from "@/core/workspace"
import { cn } from "@/lib/utils"

/** The open sheet's content that would be lost, as lines ("Name: My setup"), from each form's guard. */
const guards = new Set<{ current: () => string[] }>()
const InSheet = createContext(false)

/** A form in a sheet that isn't saved as you type: closing the sheet while `lost()` has lines asks first, showing them. */
export function useSheetGuard(lost: () => string[]) {
  const ref = useRef(lost)
  ref.current = lost
  const inSheet = useContext(InSheet)
  useEffect(() => { if (!inSheet) return; guards.add(ref); return () => { guards.delete(ref) } }, [inSheet])
}

/** Run `go` (close, back) unless the content has something unsaved and the user keeps it. */
async function leave(go: () => void) {
  const lost = [...guards].flatMap((g) => g.current())
  if (lost.length && !(await confirmDialog({ title: "Discard what you wrote?", body: lost.join("\n"), confirm: "Discard", danger: true }))) return
  guards.clear()
  go()
}

/** Where a sheet's file ("file/<path>") is now, after the moves the app followed. */
function movedTo(detail: string) {
  if (!detail.startsWith("file/")) return detail
  try { return `file/${encodeURIComponent(whereNow(decodeURIComponent(detail.slice(5)), 0))}` } catch { return detail }
}

export function DetailSheet({ open, onClose, onBack, backLabel, title, path, depth, still, own, children }: {
  open: boolean; onClose: () => void
  /** Phones: its content draws its own top line (the tab list), so the floating header takes no taps. */
  own?: boolean
  /** Phones: it doesn't slide up (the tab list: the page shrinks into it instead, core/motion.ts). */
  still?: boolean
  /** Set when this sheet sits on top of another one. */
  onBack?: () => void; backLabel?: string
  /** Shown small in the header once the sheet's own title has scrolled away. */
  title?: string
  /** The open detail and its stack depth: together they key scroll memory and the content transition. */
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
  // A long-press opens the sheet while the finger is still down; lifting it then "clicks" the backdrop.
  // Ignore backdrop clicks right after opening so that doesn't close it again.
  const openedAt = useRef(0)

  useEffect(() => {
    const d = ref.current
    if (!d || !open) return
    // Desktop: closed, the keyboard goes back where it was (the editor: core/focus.ts). Phones: blur first: closing a
    // dialog refocuses what had focus, and refocusing the Notes search field would pop the keyboard.
    const release = isDesktop() ? holdFocus() : null
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    const unlock = lockPage()
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal(); else d.setAttribute("open", "") // pre-15.4 iOS: no <dialog>
      d.focus(); openedAt.current = performance.now()
    }
    setDy(0)
    return () => { if (d.open) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open") } unlock(); release?.() }
  }, [open])

  // Scroll memory per history entry ("depth:path").
  const key = `${depth}:${path}`
  const pos = useRef(new Map<string, number>())
  const shown = useRef<{ key: string; depth: number; path: string } | null>(null)
  const dir = !shown.current || shown.current.key === key ? "" : depth > shown.current.depth ? "push" : depth < shown.current.depth ? "pop" : ""
  const [anim, setAnim] = useState("")
  // Offsets, not rects: they ignore the open animation's transform, and are 0 while the dialog is still hidden.
  const syncCompact = () => {
    const sc = scroller.current, t = sc?.querySelector<HTMLElement>("#sheet-title")
    setCompact(!!sc && !!t && t.offsetHeight > 0 && sc.scrollTop > t.offsetTop + t.offsetHeight - 4)
  }
  useLayoutEffect(() => {
    const sc = scroller.current
    if (!open || !sc) { shown.current = null; return }
    const was = shown.current
    // A new sheet (or a fresh open) forgets positions at its depth and deeper: those entries are gone from history.
    if (!was || depth > was.depth) for (const k of [...pos.current.keys()]) if (Number(k.split(":")[0]) >= depth) pos.current.delete(k)
    // (the same entry, its file moved: a report archived by a reply sent from it is still being read)
    const moved = was && was.depth === depth && was.key !== key && movedTo(was.path) === path
    const want = pos.current.get(key) ?? (moved ? pos.current.get(was.key) : 0) ?? 0
    sc.scrollTop = want
    shown.current = { key, depth, path }
    setAnim(dir)
    syncCompact()
    // Content that draws after it opens (a file loading into the editor) may not be tall enough yet: keep putting the
    // reading position back as it grows, for a moment, unless you start scrolling yourself.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, open])

  const floating = !onBack
  const letGo = () => { drag.current?.quit(); drag.current = null; setDy(0) }
  const header = {
    onPointerDown: (e: PointerEvent) => {
      if (e.pointerType === "mouse" || (e.target as Element).closest("button")) return
      drag.current?.quit()
      // The app sent away mid-drag (core/away.ts): the sheet goes back up.
      drag.current = { y: e.clientY, t: e.timeStamp, quit: onAway(letGo) }
      ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: PointerEvent) => { if (drag.current) setDy(Math.max(0, e.clientY - drag.current.y)) },
    onPointerUp: (e: PointerEvent) => {
      if (!drag.current) return
      const fast = dy > 24 && dy / Math.max(e.timeStamp - drag.current.t, 1) > 0.6 // a flick
      letGo()
      if (dy > 90 || fast) close()
    },
    onPointerCancel: () => letGo(),
  }

  return (
    <dialog ref={ref} aria-labelledby="sheet-title" tabIndex={-1}
      onCancel={(e) => { e.preventDefault(); close() }}
      onClick={(e) => {
        // The backdrop: a click on the dialog element itself that lands outside its box.
        if (e.target !== e.currentTarget || performance.now() - openedAt.current < 400) return
        const r = e.currentTarget.getBoundingClientRect()
        if (e.clientY < r.top || e.clientY > r.bottom || e.clientX < r.left || e.clientX > r.right) close()
      }}
      style={dy ? { transform: `translateY(${dy}px)`, transition: "none" } : undefined}
      className={cn(
        "sheet-h m-0 flex w-full max-w-none flex-col overflow-hidden overscroll-none border-0 p-0 text-foreground outline-none",
        "bg-card md:shadow-2xl md:ring-1 md:ring-border/40 md:bg-card/90 md:backdrop-blur-2xl md:backdrop-saturate-200",
        "inset-0 transition-transform duration-200",
        "md:inset-0 md:m-auto md:max-h-[80dvh] md:w-[calc(100%-2rem)] md:max-w-[560px] md:rounded-[12px]",
        "backdrop:bg-black/35",
        !still && "open:animate-in open:slide-in-from-bottom open:duration-300",
        "md:open:fade-in md:open:zoom-in-95 md:open:slide-in-from-bottom-0 md:open:duration-200",
        "[&:not([open])]:hidden",
      )}>
      {/* Without Back, the header floats over the content (no empty strip on top): the X lines up with the sheet's first
          line, and the bar only gets a background once the title scrolls away. With Back, it's a normal bar. */}
      <header className={cn(
        "z-10 shrink-0 touch-none select-none",
        floating ? "absolute inset-x-0 top-0" : "relative", own && "max-md:pointer-events-none",
        compact && "shadow-[0_0.5px_0_var(--border)]", compact && floating && "bg-card",
      )} {...header}>
        <div className="h-[env(safe-area-inset-top)] md:hidden" aria-hidden />
        <div className="group relative flex h-11 items-center justify-between pr-[7px] pl-1.5 md:h-14 md:pr-[11px] md:pl-3">
          {onBack ? (
            <button type="button" onClick={back} aria-label={backLabel && backLabel !== "Back" ? `Back to ${backLabel}` : "Back"}
              className="flex min-h-11 max-w-[44%] cursor-pointer items-center gap-0.5 rounded-[8px] pr-2 text-[17px] text-primary active:opacity-50">
              <ChevronLeft className="size-[26px] shrink-0" strokeWidth={2.25} />
              <span className="truncate">{backLabel || "Back"}</span>
            </button>
          ) : <span />}
          {title && (
            <div aria-hidden className={cn(
              "pointer-events-none absolute top-1/2 -translate-y-1/2 truncate text-center text-[17px] font-semibold transition-opacity duration-150",
              onBack ? "inset-x-[128px]" : "inset-x-14 group-has-[#sheet-actions:not(:empty)]:inset-x-[100px]",
              compact ? "opacity-100" : "opacity-0",
            )}>{title}</div>
          )}
          {/* Buttons the content puts in the header (a file's view toggle: FileView's ViewToggle), left of Close. */}
          <div id="sheet-actions" className="ml-auto flex items-center empty:hidden" />
          {/* A plain X in a 44pt hit area; the glyph's right edge lines up with the content's (20px phone, 24px desktop). */}
          <button type="button" aria-label="Close" onClick={close}
            className="hidden size-11 cursor-pointer md:grid place-items-center text-muted-foreground transition-colors hover:text-foreground active:opacity-50">
            <X className="size-[18px]" strokeWidth={2.25} />
          </button>
        </div>
      </header>
      {/* flex-auto, not flex-1: the sheet has no height of its own (its content's, up to sheet-h), and iOS WebKit sizes
          a 0% basis in it as 0, which left only the header showing. Sized from its content, it shrinks to fit instead. */}
      <div ref={scroller} onScroll={(e) => { pos.current.set(key, e.currentTarget.scrollTop); syncCompact() }}
        className={cn(
          "relative min-h-0 flex-auto overflow-x-hidden overflow-y-auto overscroll-contain px-5 pb-7 md:px-6",
          floating ? "pt-[calc(env(safe-area-inset-top)+22px)] md:pt-[17px]" : "pt-1",
        )}>
        {open && (
          <div key={key} className={cn(anim && "animate-in fade-in duration-200", anim === "push" && "slide-in-from-right-8", anim === "pop" && "slide-in-from-left-8")}>
            <InSheet.Provider value>{children}</InSheet.Provider>
          </div>
        )}
      </div>
      {/* Phones: the bottom bar. The content's own buttons go in #sheet-bar (a portal), Done closes the sheet. */}
      <footer data-sheet-bar className="relative mt-auto flex shrink-0 items-center gap-1 border-t-[0.5px] border-border px-2 pt-1 pb-[max(env(safe-area-inset-bottom),0.25rem)] md:hidden">
        <div id="sheet-bar" className="flex h-11 min-w-0 flex-1 items-center" />
        <button type="button" data-sheet-done onClick={close}
          className="h-11 shrink-0 cursor-pointer rounded-[12px] px-3 text-[17px] font-semibold text-primary active:bg-foreground/[0.06]">
          Done
        </button>
      </footer>
    </dialog>
  )
}
