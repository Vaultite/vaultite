import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export function Dots({ count, at }: { count: number; at: number }) {
  return (
    <span role="img" aria-label={`Page ${at + 1} of ${count}`} data-dots={`${at + 1}/${count}`} className="flex items-center gap-1.5">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cn("h-1.5 rounded-full transition-[width,background-color] duration-300 ease-out",
          i === at ? "w-4 bg-foreground/75" : "w-1.5 bg-foreground/20")} />
      ))}
    </span>
  )
}

export function PageFoot({ left, dots, right, className }: { left?: ReactNode; dots?: ReactNode; right: ReactNode; className?: string }) {
  return (
    <footer className={cn("grid shrink-0 grid-cols-[1fr_auto_1fr] items-center gap-3", className)}>
      <span className="flex min-w-0 items-center justify-start">{left}</span>
      {dots ?? <span />}
      <span className="flex min-w-0 items-center justify-end gap-2">{right}</span>
    </footer>
  )
}
