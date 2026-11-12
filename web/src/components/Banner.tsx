import type { ReactNode } from "react"
import { AlertTriangle, type LucideIcon } from "lucide-react"

/** A note over the file, and what can be done about it (`actions`: [label, run], a falsy one left out). */
export function Banner({ tone, icon: Icon = AlertTriangle, actions = [], children }: {
  tone: "warn" | "info"; icon?: LucideIcon; actions?: (readonly [string, () => unknown] | false)[]; children: ReactNode
}) {
  return (
    <div role={tone === "warn" ? "alert" : "status"} className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-3 py-2.5 text-[15px]"
      style={{ background: `color-mix(in srgb, ${tone === "warn" ? "var(--orange)" : "var(--muted-foreground)"} 14%, transparent)` }}>
      <Icon className="size-4 shrink-0" strokeWidth={2.25} style={{ color: tone === "warn" ? "var(--orange)" : "var(--muted-foreground)" }} />
      <span className="flex-1">{children}</span>
      {actions.map((a) => a && <button key={a[0]} type="button" className="cursor-pointer font-semibold text-primary" onClick={() => void a[1]()}>{a[0]}</button>)}
    </div>
  )
}
