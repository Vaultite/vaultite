// The keys hint, like Vim's which-key: while a sequence is under way, what each next key does. It waits a moment so
// a sequence typed quickly never flashes it.
import { useEffect, useMemo, useState } from "react"
import { keyHint, nextKeys, usePendingKeys } from "@/core/commands"
import { keyGroupNames } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"

const DELAY = 450

export function KeyHints() {
  const steps = usePendingKeys()
  const [shown, setShown] = useState(false)
  useEffect(() => {
    if (!steps) { setShown(false); return }
    const t = setTimeout(() => setShown(true), DELAY)
    return () => clearTimeout(t)
  }, [steps])
  const { disabled, order, enabled } = usePrefs()
  const groups = useMemo(() => keyGroupNames(disabled, order), [disabled, order, enabled])
  const rows = useMemo(() => {
    if (!steps || !shown) return []
    return nextKeys(steps).map(({ step, commands, last }) => {
      const group = groups.get([...steps, step].join(" "))
      const label = last && commands.length === 1 ? commands[0].name : group ?? (commands.length === 1 ? commands[0].name : `${commands.length} commands`)
      return { step, label, more: !last || commands.length > 1 }
    }).sort((a, b) => a.step.localeCompare(b.step))
  }, [steps, shown, groups])
  if (!steps || !shown) return null
  const title = groups.get(steps.join(" "))
  return (
    <div role="status" aria-label="Keys" className="pointer-events-none fixed inset-x-0 bottom-9 z-50 hidden justify-center px-4 md:flex">
      <div data-floats className="max-h-[50vh] w-full max-w-3xl overflow-hidden rounded-[10px] border-[0.5px] border-border bg-popover text-[13px] text-popover-foreground shadow-lg">
        <div className="flex items-center gap-2 border-b-[0.5px] border-border px-4 py-2 text-muted-foreground">
          <span className="font-mono text-foreground">{steps.map((s) => keyHint(s)).join(" ")}</span>
          {title && <span>{title}</span>}
          <span className="ml-auto text-[12px]">esc to cancel, ⌫ to go back</span>
        </div>
        {rows.length ? (
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 px-4 py-2.5 sm:grid-cols-2 lg:grid-cols-3">
            {rows.map((r) => (
              <div key={r.step} className="flex min-w-0 items-baseline gap-2">
                <kbd className="shrink-0 font-mono font-semibold text-primary">{keyHint(r.step)}</kbd>
                <span className="truncate text-muted-foreground">{r.more ? <span className="text-foreground">+{r.label}</span> : r.label}</span>
              </div>
            ))}
          </div>
        ) : <div className="px-4 py-2.5 text-muted-foreground">Nothing follows</div>}
      </div>
    </div>
  )
}
