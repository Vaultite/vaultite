import { type ButtonHTMLAttributes, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react"
import { ChevronRight } from "lucide-react"
import { menuShowing, useMenuShowing } from "@/components/ContextMenu"
import { slideFrom } from "@/core/animation"
import { useScopedState } from "@/core/scope"
import { trackSoon } from "@/core/unsaved"
import { cn } from "@/lib/utils"
import { nodeOf } from "@/core/dom"

const LINGER = 600, TOUCH_LINGER = 2000

/** Whether the user is in the list, so nothing moves under them: the pointer over it, the keyboard in it, a menu opened
 *  from a row, a finger on it or its sidebar scrolling (a phone has no hover). Let go a moment after the last ends. */
export function useHold(box: RefObject<HTMLElement | null>) {
  const [held, setHeld] = useState(false)
  const menu = useMenuShowing()
  const by = useRef({ over: false, keys: false, menu: false, touch: false, settle: () => {} })
  useEffect(() => {
    const el = box.current
    if (!el) return
    const at = by.current
    const hover = matchMedia("(hover: hover)")
    let timer = 0, due = 0, untrack = trackSoon("a list letting go", () => due !== 0)
    const settle = (after = LINGER) => {
      clearTimeout(timer)
      if (at.over || at.keys || at.menu || at.touch) { due = 0; return setHeld(true) }
      due = Math.max(due, Date.now() + after)
      timer = window.setTimeout(() => {
        due = 0
        // A menu closing over the list leaves the pointer here without a pointerenter.
        if (hover.matches && el.matches(":hover")) at.over = true
        else setHeld(false)
      }, due - Date.now())
    }
    at.settle = settle
    const mouse = (e: PointerEvent) => e.pointerType !== "touch"
    const enter = (e: PointerEvent) => { if (mouse(e)) { at.over = true; settle() } }
    const leave = (e: PointerEvent) => { if (mouse(e)) { at.over = false; settle() } }
    const key = () => { at.keys = true; settle() }
    const focusOut = (e: FocusEvent) => { if (!el.contains(nodeOf(e.relatedTarget))) { at.keys = false; settle() } }
    const menued = () => { at.menu = true; settle(); requestAnimationFrame(() => { if (!menuShowing()) { at.menu = false; settle() } }) }
    const down = () => { at.touch = true; settle() }
    const up = () => { at.touch = false; settle(TOUCH_LINGER) }
    const scrolled = (e: Event) => { if (e.target instanceof Node && e.target.contains(el) && (at.touch || !hover.matches)) { setHeld(true); settle(TOUCH_LINGER) } }
    el.addEventListener("pointerenter", enter)
    el.addEventListener("pointerleave", leave)
    el.addEventListener("keydown", key)
    el.addEventListener("focusout", focusOut)
    el.addEventListener("contextmenu", menued, true)
    el.addEventListener("touchstart", down, { passive: true })
    el.addEventListener("touchend", up)
    el.addEventListener("touchcancel", up)
    document.addEventListener("scroll", scrolled, { capture: true, passive: true })
    return () => {
      clearTimeout(timer); untrack()
      el.removeEventListener("pointerenter", enter)
      el.removeEventListener("pointerleave", leave)
      el.removeEventListener("keydown", key)
      el.removeEventListener("focusout", focusOut)
      el.removeEventListener("contextmenu", menued, true)
      el.removeEventListener("touchstart", down)
      el.removeEventListener("touchend", up)
      el.removeEventListener("touchcancel", up)
      document.removeEventListener("scroll", scrolled, true)
    }
  }, [box])
  useEffect(() => { if (!menu && by.current.menu) { by.current.menu = false; by.current.settle() } }, [menu])
  return held
}

/** The rows in their order and which fold under Earlier (`old`); while `held`, as they last were: each keeps its place
 *  and its side of the fold (what it shows still changes), new ones come last. */
export function useSteady<T extends { id: string }>(sorted: T[], held: boolean, old: (x: T) => boolean) {
  const last = useRef<{ front: string[]; earlier: string[] }>({ front: [], earlier: [] })
  if (!held) {
    const front = sorted.filter((x) => !old(x)), earlier = sorted.filter(old)
    last.current = { front: front.map((x) => x.id), earlier: earlier.map((x) => x.id) }
    return { front, earlier }
  }
  const now = new Map(sorted.map((x) => [x.id, x]))
  const kept = (ids: string[]) => ids.flatMap((id) => now.get(id) ?? [])
  const known = new Set([...last.current.front, ...last.current.earlier])
  const fresh = sorted.filter((x) => !known.has(x.id))
  return { front: [...kept(last.current.front), ...fresh.filter((x) => !old(x))], earlier: [...kept(last.current.earlier), ...fresh.filter(old)] }
}

/** The rows in `box` that change places (each `data-glide`, its key) glide there, so the eye can follow where one went.
 *  `order`: their keys in order, so it looks only when that changes. */
export function useGlide(box: RefObject<HTMLElement | null>, order: string) {
  const tops = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const el = box.current
    if (!el) return
    const top = el.getBoundingClientRect().top, was = tops.current, now = new Map<string, number>()
    for (const it of el.querySelectorAll<HTMLElement>("[data-glide]")) {
      const key = it.dataset.glide!, r = it.getBoundingClientRect(), from = was.get(key)
      now.set(key, r.top - top)
      if (from !== undefined && Math.abs(from - (r.top - top)) > 0.5) slideFrom(it, new DOMRect(r.left, top + from, r.width, r.height), "base")
    }
    tops.current = now
  }, [box, order])
}

/** Whether a list's Earlier is open (closed to start, kept per workspace under `key`), and what opens or closes it. */
export function useEarlier(key: string) {
  const [open, set] = useScopedState<boolean>(key, false)
  return [!!open, () => set(open ? undefined : true)] as const
}

/** A list's fold: "Earlier" and how many it holds, its chevron turned while open. */
export function EarlierRow({ count, open, className, ...rest }: { count: number; open: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button type="button" data-keyrow data-glide="earlier" aria-expanded={open} {...rest}
      className={cn("flex h-7 min-w-0 cursor-pointer items-center gap-2 truncate rounded-[5px] pl-1.5 text-left text-[12px] whitespace-nowrap text-tertiary hover:text-muted-foreground max-md:min-h-11 max-md:text-[15px]", className)}>
      <ChevronRight aria-hidden className={cn("size-4 shrink-0 p-0.5 transition-transform duration-(--motion-fast)", open && "rotate-90")} strokeWidth={2} />
      <span>Earlier</span><span className="tabular-nums">{count}</span>
    </button>
  )
}
