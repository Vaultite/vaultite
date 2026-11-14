import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject, type SyntheticEvent } from "react"
import { createPortal } from "react-dom"
import { closeHoverCard, keepHoverCard, leaveHoverCard, shushHoverCard, type CardPlace, type HoverShown, type PlaceCard } from "@/core/hovercard"
import { nodeOf } from "@/core/dom"
import { cn } from "@/lib/utils"
import { Picture, PreviewCard } from "@/components/PreviewCard"

let last: { left: number; top: number } | null = null
const GAP_SIDE = { right: "pl-1.5", left: "pr-1.5", below: "pt-1.5", above: "pb-1.5" }
const notTheAnchors = (e: SyntheticEvent) => e.stopPropagation()
const overModalSheets = (el: HTMLElement) => { if (!el.matches(":popover-open")) el.showPopover?.() }

export function HoverCard({ shown, anchor, place, again, className, children, ...attrs }: { shown: HoverShown; anchor: RefObject<HTMLElement | null>; place: PlaceCard
  again?: unknown; className?: string; children: ReactNode } & { [data: `data-${string}`]: string | undefined }) {
  const el = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<(CardPlace & { glide?: boolean }) | null>(null)
  useLayoutEffect(() => {
    if (el.current) overModalSheets(el.current)
    if (!anchor.current || !box.current) return
    const to = place(anchor.current, box.current.offsetWidth, box.current.offsetHeight, shown)
    const from = at ?? (shown.glideFromLast ? last : null)
    if (!from || (Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1)) { setAt(to); return }
    if (at) { setAt({ ...to, glide: true }); return }
    setAt({ ...to, left: from.left, top: from.top })
    const f = requestAnimationFrame(() => setAt({ ...to, glide: true }))
    return () => cancelAnimationFrame(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- not `at`: it is where the card is, not why it moves
  }, [anchor, again, shown.preferAbove, shown.part, shown.glideFromLast])
  useEffect(() => { if (at) last = { left: at.left, top: at.top } }, [at])
  useEffect(() => {
    const scroll = (e: Event) => { if (e.target instanceof Node && e.target.contains(anchor.current)) closeHoverCard() }
    const down = (e: PointerEvent) => { const t = nodeOf(e.target); if (!anchor.current?.contains(t) && !el.current?.contains(t)) closeHoverCard() }
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); shushHoverCard() } }
    const off = new AbortController(), { signal } = off
    addEventListener("scroll", scroll, { capture: true, signal }); addEventListener("pointerdown", down, { capture: true, signal }); addEventListener("keydown", key, { capture: true, signal })
    addEventListener("blur", closeHoverCard, { signal }); addEventListener("resize", closeHoverCard, { signal })
    return () => off.abort()
  }, [anchor])
  return createPortal(
    <div ref={el} popover="manual" aria-hidden data-hover-card="" {...attrs} data-side={at?.side} data-cold={shown.cold || undefined}
      onPointerEnter={keepHoverCard} onPointerLeave={(e) => { if (e.pointerType === "mouse") leaveHoverCard() }}
      onPointerDown={notTheAnchors} onMouseDown={notTheAnchors} onClick={notTheAnchors} onAuxClick={notTheAnchors} onDoubleClick={notTheAnchors}
      onContextMenu={(e) => { e.preventDefault(); notTheAnchors(e) }}
      className={cn("fixed inset-auto m-0 overflow-visible border-0 bg-transparent p-0 text-foreground", GAP_SIDE[at?.side ?? "below"], !at && "invisible")}
      style={{ left: at?.left ?? 0, top: at?.top ?? 0, transition: at?.glide ? "left var(--motion-spring) var(--spring), top var(--motion-spring) var(--spring)" : undefined }}>
      <PreviewCard ref={box} className={className} style={{ transformOrigin: at ? `${at.growFromX}px ${at.growFromY}px` : "top left" }}>{children}</PreviewCard>
    </div>, anchor.current?.closest("dialog") ?? document.body) // (a sheet's in its dialog: the modal sheet makes the rest inert)
}

export function Captioned({ picture, title, icon, about, width = 280, height = 175 }: { picture: ReactNode; title: string; icon?: ReactNode; about?: string | null
  width?: number; height?: number }) {
  return (
    <div className="flex flex-col gap-2" style={{ width }}>
      <Picture width={width} height={height}><span data-card-picture className="relative block size-full overflow-hidden bg-background">{picture}</span></Picture>
      <div className="flex min-w-0 flex-col gap-0.5 px-0.5">
        <span className="flex min-w-0 items-center gap-1.5">
          {icon}
          <span data-card-title className="min-w-0 flex-1 truncate text-[13px] leading-[18px] font-medium">{title}</span>
        </span>
        {about && <span data-card-about className="line-clamp-2 text-[12px] leading-[16px] text-muted-foreground">{about}</span>}
      </div>
    </div>
  )
}
