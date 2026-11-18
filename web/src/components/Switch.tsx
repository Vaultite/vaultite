import { useContext, useState, type MouseEvent as ReactMouseEvent } from "react"
import { cn } from "@/lib/utils"
import { haptic } from "@/core/haptics"
import { notify } from "@/core/notify"
import { Described } from "@/components/SettingPreview"

/** A small switch in the accent colour: a promise from `onChange` shows it pending; `why` (can't change now) shows on click. */
export function Switch<Done>({ on, onChange, label, disabled, why }: { on: boolean; onChange: (on: boolean) => void | Promise<Done>; label: string; disabled?: boolean; why?: string }) {
  const [pending, setPending] = useState<boolean | null>(null)
  const shown = pending ?? on
  const click = (e: ReactMouseEvent) => {
    e.stopPropagation()
    if (why) return void notify(why)
    if (pending !== null) return
    haptic()
    const r = onChange(!on)
    if (!(r instanceof Promise)) return
    setPending(!on)
    void r.catch(() => {}).finally(() => setPending(null))
  }
  return (
    <button type="button" role="switch" aria-checked={shown} aria-label={label} aria-describedby={useContext(Described)} disabled={disabled}
      aria-disabled={why ? true : undefined} aria-busy={pending !== null || undefined} data-tip={why} onClick={click}
      className={cn(
        "relative h-[22px] w-[36px] shrink-0 cursor-pointer rounded-full transition-colors duration-(--motion) disabled:cursor-default disabled:opacity-50",
        "after:absolute after:-inset-2.5 after:content-['']",
        shown ? "bg-primary" : "bg-foreground/[0.18]", why && "opacity-50", pending !== null && "animate-pulse",
      )}>
      <span className={cn(
        "absolute top-[2px] left-[2px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.2)] transition-transform duration-(--motion)",
        shown && "translate-x-[14px]",
      )} />
    </button>
  )
}
