import { cn } from "@vaultite"
import { FULL_BITS, LEVELS, levelOf } from "./levels"

export function StrengthBar({ bits, className }: { bits: number | null; className?: string }) {
  const level = bits === null ? null : levelOf(bits), look = level && LEVELS[level]
  return (
    <div className={cn("flex items-center gap-2.5", className)} data-password-strength={level ?? "none"}>
      <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
        {look && <div className="h-full rounded-full [transition:width_var(--motion),background_var(--motion)]" style={{ width: `${Math.max(4, Math.min(100, ((bits ?? 0) / FULL_BITS) * 100))}%`, background: look.color }} />}
      </div>
      <span className="w-32 shrink-0 text-right text-[13px] whitespace-nowrap md:text-[12px]">
        {look && <><span className="font-medium">{look.label}</span><span className="text-muted-foreground tabular-nums"> · {Math.round(bits ?? 0)} bits</span></>}
      </span>
    </div>
  )
}

const HEIGHTS = ["h-1", "h-1.5", "h-2", "h-2.5"]
const CALM = "color-mix(in srgb, var(--foreground) 34%, transparent)"
export function StrengthMark({ bits }: { bits: number | null | undefined }) {
  if (bits == null) return null
  const level = levelOf(bits), { label, color, steps } = LEVELS[level], calm = steps > 2
  return (
    <span className="flex h-2.5 shrink-0 items-end gap-[2px]" aria-label={`${label} password`} data-tip={`${label} password`} data-password-strength={level}>
      {HEIGHTS.map((h, i) => <span key={h} className={cn("w-[3px] rounded-[1px]", h, i >= steps && "bg-foreground/[0.12]")} style={i < steps ? { background: calm ? CALM : color } : undefined} />)}
    </span>
  )
}
