import type { MouseEvent, ReactNode } from "react"
import type { LucideIcon } from "lucide-react"
import { cn, Empty, Loading } from "@vaultite"
import { LockScreen } from "./Lock"
import { hasPasswords, usePasswordsLive } from "./store"

export function Unlocked({ children }: { children: ReactNode }) {
  const { status, entries } = usePasswordsLive()
  if (!hasPasswords()) return <Empty>Your passwords open in Vaultite's desktop app.</Empty>
  if (status === undefined) return <Loading />
  if (!status) return <Empty>No KeePass file is open on this computer.</Empty>
  if (status.locked || status.error || !entries) return <LockScreen status={status} />
  return <>{children}</>
}

export function Act({ icon: Icon, label, run }: { icon: LucideIcon; label: string; run: (e: MouseEvent) => void }) {
  return (
    <button type="button" aria-label={label} data-tip={label} onClick={(e) => { if (e.nativeEvent.isTrusted) run(e) }}
      className="grid size-11 shrink-0 cursor-pointer place-items-center rounded-control text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground md:size-8">
      <Icon className="size-4" strokeWidth={2} />
    </button>
  )
}

export function Field({ label, value, mono, actions, below, ...rest }: { label: string; value: ReactNode; mono?: boolean; actions?: ReactNode; below?: ReactNode } & Record<`data-${string}`, unknown>) {
  return (
    <div className="min-h-14 py-2" {...rest}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] text-muted-foreground md:text-[12px]">{label}</div>
          <div className={cn("text-[17px] leading-[22px] break-all select-text md:text-[14px] md:leading-[20px]", mono && "font-mono", !value && "text-tertiary")}>{value || "None"}</div>
        </div>
        {actions && <div className="flex shrink-0 gap-0.5">{actions}</div>}
      </div>
      {below}
    </div>
  )
}

const CLASSES: [RegExp, string][] = [[/\d/, "text-ink-(--blue)"], [/[^\p{L}\d]/u, "text-ink-(--orange)"]]
export function ColoredPassword({ text }: { text: string }) {
  return <>{(text.match(/\d+|[^\p{L}\d]+|\p{L}+/gu) ?? []).map((run, i) => <span key={i} className={CLASSES.find(([has]) => has.test(run))?.[1]}>{run}</span>)}</>
}
