import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode, type RefObject } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

const STEP = 0.8

export function ScrollStrip({ children, className, strip, ...rest }: { children: ReactNode; className?: string; strip?: RefObject<HTMLDivElement | null> } & HTMLAttributes<HTMLDivElement>) {
  const own = useRef<HTMLDivElement>(null), ref = strip ?? own
  const [more, setMore] = useState({ left: false, right: false })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const look = () => {
      const left = el.scrollLeft > 1, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setMore((m) => (m.left === left && m.right === right ? m : { left, right }))
    }
    look()
    el.addEventListener("scroll", look, { passive: true })
    const watch = new ResizeObserver(look)
    watch.observe(el)
    for (const c of el.children) watch.observe(c)
    return () => { el.removeEventListener("scroll", look); watch.disconnect() }
  }, [children, ref])
  const go = (dir: -1 | 1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * STEP, behavior: "smooth" })
  const arrow = (dir: -1 | 1) => {
    const Icon = dir < 0 ? ChevronLeft : ChevronRight
    return (
      <button type="button" tabIndex={-1} aria-hidden onClick={() => go(dir)} data-strip-arrow={dir < 0 ? "left" : "right"}
        className={cn("absolute top-1/2 z-10 hidden size-6 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-background text-muted-foreground shadow-[0_0_0_0.5px_var(--border),0_1px_4px_rgb(0_0_0/0.12)] hover:text-foreground [@media(hover:hover)]:grid",
          dir < 0 ? "left-0" : "right-0")}>
        <Icon className="size-4" strokeWidth={2.25} />
      </button>
    )
  }
  return (
    <div className="relative min-w-0" data-scroll-strip>
      <div ref={ref} {...rest} className={cn("edge-fade-x overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden", className)}>{children}</div>
      {more.left && arrow(-1)}
      {more.right && arrow(1)}
    </div>
  )
}
