// A file's title, the same on every page (a note, a dashboard, a sheet, a phone): its own icon, then its name. On a
// phone the header's name stays hidden while this one is in sight (iOS large titles).
import { useLayoutEffect, useRef, type ReactNode } from "react"
import { namedIcon, tintOf } from "@/core/pages"
import { cell } from "@/core/signal"
import { cn } from "@/lib/utils"

/** The title's text. A phone's is a size down: its header names the file too, once the title scrolls away. */
export const TITLE = "title-font block w-full text-[24px] leading-[30px] font-bold text-balance break-words md:text-[28px] md:leading-[34px]"

/** Whether the page's own title is in sight below the phone's header (PhoneHeader hides its name meanwhile). */
export const titleInSight = cell(false)

/** An icon that changes the file's icon: its hover is drawn around it, so it sits where the plain icon would. */
export const ICON_BUTTON = "relative isolate grid shrink-0 cursor-pointer before:absolute before:-inset-1 before:-z-10 before:rounded-[6px] " +
  "before:transition-colors hover:before:bg-foreground/[0.06] active:before:bg-foreground/[0.09]"

/** The title's line: the file's `icon:` (in its `tint`) before it, a button where `onIcon` changes it. `phone`: a
 *  phone's tab, whose header follows it. */
export function TitleRow({ icon, tint, phone, onIcon, children }: { icon?: unknown; tint?: unknown; phone?: boolean; onIcon?: () => void; children: ReactNode }) {
  const Icon = typeof icon === "string" ? namedIcon(icon) : null
  const row = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const el = row.current
    if (!phone || !el) return
    // In sight: any of it below the header (fixed, over the window that scrolls).
    const top = document.querySelector<HTMLElement>("[data-phone-header]")?.offsetHeight ?? 0
    const io = new IntersectionObserver(([e]) => titleInSight.set(e.isIntersecting), { rootMargin: `-${top}px 0px 0px 0px` })
    io.observe(el)
    titleInSight.set(true)
    return () => { io.disconnect(); titleInSight.set(false) }
  }, [phone])
  const at = "mt-[3px] md:mt-1"
  const drawn = Icon && <Icon data-title-icon aria-hidden className={cn("size-6 shrink-0 md:size-[26px]", !onIcon && at)} strokeWidth={2}
    style={{ color: tintOf(typeof tint === "string" ? tint : null) }} />
  return (
    <div ref={row} data-title-row className="flex items-start gap-2">
      {Icon && (onIcon ? (
        // (a finger's 44pt target is the hover's box, around the icon)
        <button type="button" onClick={onIcon} aria-label="Change icon" data-tip="Change icon" className={cn(ICON_BUTTON, at, "max-md:before:-inset-2.5")}>{drawn}</button>
      ) : drawn)}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}
