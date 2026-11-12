import { useEffect, useLayoutEffect, useRef, type ReactNode } from "react"
import { namedIcon, tintOf } from "@/core/pages"
import { cell } from "@/core/signal"
import { usePane } from "@/core/pane"
import { cn } from "@/lib/utils"

export const TITLE = "title-font block w-full text-[24px] leading-[30px] font-bold text-balance break-words md:text-[28px] md:leading-[34px]"

export const titleInSight = cell(false)
/** A page with no name to say yet (a chat while it loads): the phone's header shows none meanwhile, not a stand-in. */
export function useNoPhoneTitle(on: boolean) {
  useEffect(() => { if (!on) return; titleInSight.set(true); return () => titleInSight.set(false) }, [on])
}

export const ICON_BUTTON = "relative isolate grid shrink-0 cursor-pointer before:absolute before:-inset-1 before:-z-10 before:rounded-[6px] " +
  "before:transition-colors hover:before:bg-foreground/[0.06] active:before:bg-foreground/[0.09]"

export function TitleRow({ icon, tint, phone, onIcon, children }: { icon?: unknown; tint?: unknown; phone?: boolean; onIcon?: () => void; children: ReactNode }) {
  const Icon = typeof icon === "string" ? namedIcon(icon) : null
  const row = useRef<HTMLDivElement>(null)
  const { hidden } = usePane()
  useLayoutEffect(() => {
    const el = row.current
    if (!phone || hidden || !el) return
    const top = document.querySelector<HTMLElement>("[data-phone-header]")?.offsetHeight ?? 0
    const see = (r: DOMRectReadOnly) => titleInSight.set(r.bottom > top && r.top < innerHeight)
    const io = new IntersectionObserver(([e]) => see(e.boundingClientRect), { rootMargin: `-${top}px 0px 0px 0px` })
    io.observe(el)
    see(el.getBoundingClientRect())
    return () => { io.disconnect(); titleInSight.set(false) }
  }, [phone, hidden])
  const at = "mt-[3px] md:mt-1"
  const drawn = Icon && <Icon data-title-icon aria-hidden className={cn("size-6 shrink-0 md:size-[26px]", !onIcon && at)} strokeWidth={2}
    style={{ color: tintOf(typeof tint === "string" ? tint : null) }} />
  return (
    <div ref={row} data-title-row className="flex items-start gap-2">
      {Icon && (onIcon ? (
        <button type="button" onClick={onIcon} aria-label="Change icon" data-tip="Change icon" className={cn(ICON_BUTTON, at, "max-md:before:-inset-2.5")}>{drawn}</button>
      ) : drawn)}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
