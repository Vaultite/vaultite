import type { CSSProperties, ReactNode, Ref } from "react"
import { cn } from "@/lib/utils"

export function PreviewCard({ ref, className, style, children }: { ref?: Ref<HTMLDivElement>; className?: string; style?: CSSProperties; children: ReactNode }) {
  return <div ref={ref} className={cn("preview-card glass-strong rounded-[12px] p-2.5 shadow-xl", className)} style={style}>{children}</div>
}

export function Picture({ width, height, className, children }: { width: number | string; height: number | string; className?: string; children: ReactNode }) {
  return <span className={cn("block overflow-hidden rounded-[7px] ring-[0.5px] ring-border", className)} style={{ width, height }}>{children}</span>
}

export function Zoomed({ inner, width, className, children }: { inner: number; width: number; className?: string; children: ReactNode }) {
  // translateZ(0) keeps position: fixed parts (the phone's compact title bar) inside it.
  return <div inert data-chrome style={{ width: inner, zoom: width / inner, transform: "translateZ(0)" }} className={className}>{children}</div>
}
