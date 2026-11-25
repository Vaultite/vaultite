import { memo, type MouseEvent } from "react"
import { KeyRound } from "lucide-react"
import { cn, menuFor, plural, rowMenu, selectClick, selectedAttr, selectedIn, startDrag, useSelected, type MenuItem } from "@vaultite"
import { SiteIcon } from "../icons"
import { entryMenu, LIST } from "./menus"
import { StrengthMark } from "./Strength"
import { editEntry, openEntry, selected, showsBeside, webUrl } from "./store"
import type { Row } from "./types"

export function Marks({ e }: { e: Row }) {
  const chip = "shrink-0 rounded-chip px-1.5 text-[11px] leading-[16px] font-medium"
  return (
    <>
      {e.expired && <span className={cn(chip, "bg-[var(--red)]/12 text-[var(--red)]")} data-passwords-mark="expired">Expired</span>}
      {e.shared && (e.free
        ? <span className={cn(chip, "bg-[var(--purple)]/14 text-[var(--purple)]")} data-tip="Agents use it without asking" data-passwords-mark="free">Agent-free</span>
        : <span className={cn(chip, "bg-foreground/[0.06] text-muted-foreground")} data-tip="Agents can use it, asking you first" data-passwords-mark="shared">For agents</span>)}
    </>
  )
}

export function EntryIcon({ e, big }: { e: Row; big?: boolean }) {
  const size = big ? "size-6" : "size-[18px]"
  return (
    <span className={cn("grid shrink-0 place-items-center rounded-control bg-foreground/[0.05] text-muted-foreground", big ? "size-11" : "size-8")}>
      {e.urls[0] ? <SiteIcon url={webUrl(e.urls[0])} className={size} /> : <KeyRound className={size} strokeWidth={1.75} />}
    </span>
  )
}

function dragOf(e: Row): Parameters<typeof startDrag>[1] {
  const ids = selectedIn(LIST)
  return ids.length > 1 && ids.includes(e.id) ? { from: "row", passwords: ids, label: plural(ids.length, "password") } : { from: "row", passwords: [e.id], label: e.title || "Untitled" }
}

export const EntryRow = memo(function EntryRow({ e, meta, bits, leaving, more }: { e: Row; meta: string; bits?: number | null; leaving?: ""; more?: (e: Row) => MenuItem[] }) {
  const picked = useSelected(LIST, e.id), on = selected.use((id) => id === e.id), side = showsBeside.use()
  const onClick = (ev: MouseEvent) => {
    if (selectClick(ev, LIST, e.id, selected.get())) return
    if (side && ev.detail === 0) editEntry(e.id)
    else openEntry(e.id)
  }
  return (
    <button type="button" data-keyrow data-select-key={e.id} data-password-id={e.id} data-passwords-entry={e.title} data-leaving={leaving} {...selectedAttr(picked)}
      aria-current={side && on ? "true" : undefined} onFocus={() => selected.set(e.id)} onClick={onClick} onDoubleClick={() => { if (side) editEntry(e.id) }}
      onContextMenu={menuFor(rowMenu(LIST, e.id, () => entryMenu(e, more?.(e))))}
      onPointerDown={(ev) => startDrag(ev, dragOf(e))}
      className={cn("flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 text-left hover:bg-foreground/[0.04] active:bg-foreground/[0.07] md:min-h-12", side && on && "bg-foreground/[0.07]")}>
      <EntryIcon e={e} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[17px] leading-[22px] md:text-[14px] md:leading-[19px]">{e.title || "Untitled"}</span>
          <Marks e={e} />
        </span>
        {meta && <span className="block truncate text-[15px] text-muted-foreground md:text-[12px]">{meta}</span>}
      </span>
      <StrengthMark bits={bits} />
    </button>
  )
})
