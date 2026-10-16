// A group of plugins as one row on the Plugins page (a manifest's `group`: the coding agents), saying which are on; it
// opens their sheet (pages/Plugins.tsx PluginGroupSheet), where each has its own switch and gear.
import { ChevronRight, Puzzle, SquareTerminal, type LucideIcon } from "lucide-react"
import { groupOf } from "../../../core/categories.ts"
import { isEnabled, PLUGINS, switchedOn, usePlugins, type Plugin } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { openDetail } from "@/core/nav"
import { cn } from "@/lib/utils"

const ICONS: Record<string, LucideIcon> = { "coding-agents": SquareTerminal }
export const groupIcon = (id: string) => ICONS[id] ?? Puzzle

const byName = new Intl.Collator(undefined, { sensitivity: "base" })

/** The plugins in a group, by name. */
export const groupMembers = (id: string, all: Plugin[] = PLUGINS) => all.filter((p) => p.group === id).sort((a, b) => byName.compare(a.name, b.name))

/** What a search finds a member by besides its own name: its group's ("coding agents"). */
export const groupWords = (p: Plugin) => groupOf(p.group)?.label ?? ""

export function GroupRow({ id }: { id: string }) {
  const prefs = usePrefs()
  const members = groupMembers(id, usePlugins())
  const on = members.filter((p) => switchedOn(p, prefs) && (p.requires ?? []).every((r) => isEnabled(r, prefs.disabled)))
  const Icon = groupIcon(id)
  const label = groupOf(id)?.label ?? id
  return (
    <div className="group/prow relative isolate flex min-h-15 items-center gap-3 py-2 md:min-h-12 md:py-1.5">
      <button type="button" onClick={() => openDetail(`plugin-group/${id}`)} aria-label={`${label}: each one's switch`}
        data-plugin-group={id} data-plugin-members={members.map((p) => p.id).join(" ")}
        className="absolute inset-y-0 -inset-x-2 -z-10 cursor-pointer rounded-[8px] transition-colors group-hover/prow:bg-foreground/[0.04] active:bg-foreground/[0.07]" />
      <span className={cn("pointer-events-none grid size-9 shrink-0 place-items-center rounded-[9px] bg-muted text-primary transition-opacity md:size-8 md:rounded-[8px]", !on.length && "opacity-45")}>
        <Icon className="size-[20px] md:size-[18px]" strokeWidth={2} />
      </span>
      <div className={cn("pointer-events-none min-w-0 flex-1 transition-opacity", !on.length && "opacity-55")}>
        <div className="text-[15px] leading-[20px] font-medium max-md:line-clamp-2 md:truncate md:text-[14px]">{label}</div>
        <div className="text-[13px] leading-[18px] text-muted-foreground max-md:line-clamp-2 md:truncate md:text-[12px] md:leading-[16px]" data-plugin-group-on>
          {on.length ? on.map((p) => p.name).join(", ") : "None on"}
        </div>
      </div>
      <ChevronRight className="pointer-events-none -ml-1 size-4 shrink-0 text-tertiary" strokeWidth={2.5} />
    </div>
  )
}
