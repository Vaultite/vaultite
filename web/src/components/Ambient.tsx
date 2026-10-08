// What a plugin's ambient item draws in the status bar (AmbientItem): a small button, an icon and a few words.
import type { ComponentType, CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

export function AmbientButton({ icon: Icon, text, tip, tint, onClick, className }: {
  icon: ComponentType<{ className?: string; strokeWidth?: number; style?: CSSProperties }>
  text?: ReactNode; tip: string; tint?: string; onClick: () => void; className?: string
}) {
  return (
    <button type="button" onClick={onClick} aria-label={tip} data-tip={tip} data-tip-side="top"
      className={cn("flex h-6 shrink-0 cursor-pointer items-center gap-1 rounded-[5px] px-1.5 hover:bg-foreground/[0.06] hover:text-foreground", className)}>
      <Icon className="size-3.5" strokeWidth={2.25} style={tint ? { color: tint } : undefined} />
      {text !== undefined && <span>{text}</span>}
    </button>
  )
}
