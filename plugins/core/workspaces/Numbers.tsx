// Workspaces' components: the switcher in the sidebar's header (and at the top of the rail), and the background work
// that keeps the tabs and the vault in step.
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronDown } from "lucide-react"
import { cn, commandKeys, getStore, holdFocus, menuFor, useDrag, onTabLayoutChange, sidebarsChanged, useDropHit, useDropTarget, type DragItem, type SidebarCtx, type Store } from "@vaultite"
import {
  emit, getRenaming, label, leaving, lit as litNow, named, patch, saveTabs, saveTabsSoon, savePending, sendTo, setRenaming, slotMenu, slots, SLOTS,
  switchTo, sync, useVersion, type Sent,
} from "./state"

// ---------- the header ----------
/** Workspace n's row in the switcher's list while it's renamed (Rename, in its menu): its name in a field. Enter (or a
 *  click elsewhere, or the list closing) keeps it, Escape leaves it as it was. */
function Rename({ n, on, end }: { n: number; on: boolean; end: (enter: boolean) => void }) {
  const done = (name: string | null) => renamed(n, name)
  return (
    <div data-workspace={n} className={cn("flex h-7 items-center gap-2 rounded-[5px] px-1.5", on && "bg-foreground/[0.08]")}>
      <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-[4px] border text-[11px] leading-none tabular-nums",
        on ? "border-primary/60 bg-primary/10 font-semibold text-primary" : "border-border font-medium text-foreground")}>{n}</span>
      <input autoFocus onFocus={(e) => e.currentTarget.select()} aria-label={`Name of workspace ${n}`}
        defaultValue={slots()?.[n - 1]?.name ?? ""} placeholder={`Workspace ${n}`}
        onKeyDown={(e) => {
          if (e.key === "Enter") { done(e.currentTarget.value); end(true) }
          else if (e.key === "Escape") { done(null); end(false) }
        }}
        onBlur={(e) => done(e.currentTarget.value)}
        className="-mx-1 h-[22px] min-w-0 flex-1 rounded-[4px] border-[0.5px] border-primary bg-background px-1 text-[13px] outline-none" />
    </div>
  )
}

/** The rename of workspace n ends: with its new name, or null (Escape) for none. */
function renamed(n: number, name: string | null) {
  if (getRenaming() !== n) return
  setRenaming(0)
  if (name !== null) patch(n, { name: name.trim() || null })
}

/** The switcher: the current number, opening a list of all five beside it (click switches, right-click for its menu).
 *  Dragging a tab over it opens the list so it can be dropped on another workspace. */
function Switcher({ lit, over, rail }: { lit: number; over: number | null; rail: boolean }) {
  const list = slots()!
  const [shown, setOpen] = useState(false)
  // Rename (in a workspace's menu) opens the list too, the name edited on its row.
  const renaming = getRenaming()
  const open = shown || !!renaming
  // Closing it (a click outside, the button) ends a rename, keeping what was typed: the field goes before its blur.
  const shut = () => {
    const m = getRenaming()
    if (m) renamed(m, box.current?.querySelector("input")?.value ?? null)
    setOpen(false)
  }
  const btn = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState({ left: 0, top: 0 })
  const d = useDrag()
  const sprung = useRef(false)
  // A drag that can go to another workspace, over the button: open the list (and close it again when the drag ends).
  useEffect(() => {
    if (!d) { if (sprung.current) { sprung.current = false; setOpen(false) } return }
    const r = btn.current?.getBoundingClientRect()
    if (!open && r && sent(d.item) && d.x >= r.left && d.x <= r.right && d.y >= r.top && d.y <= r.bottom) { sprung.current = true; setOpen(true) }
  }, [d, open])
  useLayoutEffect(() => {
    if (!open || !btn.current) return
    const r = btn.current.getBoundingClientRect(), w = box.current?.offsetWidth ?? 208
    setAt(rail ? { left: r.right + 8, top: r.top - 4 } : { left: Math.max(8, Math.min(r.left, innerWidth - 8 - w)), top: r.bottom + 4 })
  }, [open, rail])
  useEffect(() => {
    if (!open) return
    // The keyboard: on the current workspace's row (not while a drag opened it), and back where it was on closing.
    const release = holdFocus()
    if (!sprung.current && !getRenaming()) box.current?.querySelector<HTMLElement>("[aria-pressed=true]")?.focus({ preventScroll: true })
    const close = shut
    // (Escape in the name's field only ends the rename.)
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=menu]") && !(e.target as Element | null)?.closest?.("input")) { e.stopPropagation(); close() }
    }
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null
      if (t?.closest("[data-workspace-list], [role=menu], [aria-label='Close menu']") || btn.current?.contains(t)) return
      close()
    }
    addEventListener("keydown", key, true)
    addEventListener("pointerdown", down, true)
    return () => { removeEventListener("keydown", key, true); removeEventListener("pointerdown", down, true); release() }
  }, [open])
  // Up and down between the rows, like a menu (Home, End: the first and last); Enter or Space picks one.
  const arrows = (e: React.KeyboardEvent) => {
    if ((e.target as Element).closest("input")) return
    const rows = [...(box.current?.querySelectorAll<HTMLElement>("[data-workspace]") ?? [])]
    const i = rows.indexOf(document.activeElement as HTMLElement)
    const to = e.key === "ArrowDown" ? (i + 1) % rows.length : e.key === "ArrowUp" ? (i - 1 + rows.length) % rows.length
      : e.key === "Home" ? 0 : e.key === "End" ? rows.length - 1 : -1
    if (to < 0) return
    e.preventDefault()
    rows[to]?.focus()
  }
  // A rename ended from the keyboard: Enter closes the list, Escape goes back to the row (if the list was open before).
  const ended = (m: number, enter: boolean) => {
    if (enter) shut()
    else requestAnimationFrame(() => box.current?.querySelector<HTMLElement>(`button[data-workspace="${m}"]`)?.focus({ preventScroll: true }))
  }
  const n = lit || 1
  return (
    <>
      <button ref={btn} type="button" data-workspace-switcher={n} aria-haspopup="dialog" aria-expanded={open}
        aria-label={`${label(n)}: switch workspace`} data-tip={open ? undefined : `${label(n)}${commandKeys("workspace:1") ? ` (${commandKeys("workspace:1")} to ${commandKeys("workspace:5")})` : ""}`} data-tip-side={rail ? "right" : undefined}
        onClick={() => (open ? shut() : setOpen(true))} onContextMenu={menuFor(() => slotMenu(n))}
        className={cn("flex shrink-0 cursor-pointer items-center justify-center gap-0.5 rounded-[5px] text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground",
          rail ? "size-7" : "h-6 pr-0.5 pl-1", open && "bg-foreground/[0.08] text-foreground")}>
        {/* In the sidebar's own grey, like its other buttons (the toggle): it's a control, not a selection. */}
        <span className="grid size-[18px] place-items-center rounded-[4px] border-[1.5px] border-current text-[11px] leading-none font-semibold tabular-nums">{n}</span>
        {!rail && <ChevronDown className="size-3 text-tertiary" strokeWidth={2.25} />}
      </button>
      {open && createPortal(
        <div ref={box} role="dialog" aria-label="Workspaces" data-workspace-list onKeyDown={arrows}
          className="glass-strong fixed z-40 flex w-52 flex-col gap-px rounded-[10px] p-1 shadow-xl"
          style={at}>
          <div className="px-2 pt-1 pb-1.5 text-[11px] font-medium text-tertiary">Workspaces</div>
          {SLOTS.map((m) => {
            const on = m === lit, has = !!list[m - 1] || on
            if (renaming === m) return <Rename key={m} n={m} on={on} end={(enter) => ended(m, enter)} />
            return (
              <button key={m} type="button" data-workspace={m} data-used={has || undefined} data-drop={over === m || undefined} aria-pressed={on}
                onClick={() => { setOpen(false); switchTo(m) }}
                onContextMenu={menuFor(() => slotMenu(m))}
                className={cn("flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-1.5 text-left text-[13px] transition-colors",
                  "outline-none focus-visible:bg-foreground/[0.07]",
                  over === m ? "bg-primary/15 ring-1 ring-primary/50" : on ? "bg-foreground/[0.08]" : "hover:bg-foreground/[0.05]")}>
                <span className={cn("grid size-[18px] shrink-0 place-items-center rounded-[4px] border text-[11px] leading-none tabular-nums",
                  on ? "border-primary/60 bg-primary/10 font-semibold text-primary"
                    : has ? "border-border font-medium text-foreground" : "border-dashed border-border text-tertiary")}>{m}</span>
                <span className={cn("min-w-0 flex-1 truncate", on ? "font-medium" : has ? "" : "text-tertiary")}>{has ? label(m) : "New workspace"}</span>
                <span className="text-[11px] text-tertiary">⌃{m}</span>
              </button>
            )
          })}
        </div>,
        document.body,
      )}
    </>
  )
}

/** Runs while the plugin is on, computers and phones alike: saves the current workspace's tabs as they change, and
 *  follows the file when it changes. */
export function Background({ store }: { store: Store }) {
  const w = (store as unknown as { workspaces?: unknown }).workspaces
  useEffect(() => {
    const off = onTabLayoutChange(saveTabsSoon)
    // A reload or a closed window right after a change: saved on the way out (leaving).
    addEventListener("pagehide", leaving)
    return () => { off(); removeEventListener("pagehide", leaving); if (savePending()) saveTabs() }
  }, [])
  useEffect(() => { sync(); emit(); sidebarsChanged() }, [w])
  return null
}

/** What a dragged item (core/drag.ts) sends to another workspace: a tab moves, a pane (by its handle) moves with all
 *  its tabs, a file from the tree or a pinned page opens there. Folders, panels and blank tabs: nothing. */
function sent(item: DragItem): Sent | null {
  if (item.group) return { group: item.group }
  if (item.tab) return item.to && item.to !== "new" ? { tab: item.tab } : null
  // Several selected together: the files among them (a folder doesn't open).
  if (item.paths && (item.from === "tree" || item.from === "pin")) {
    const s = getStore(), files = new Set([...(s?.files.files ?? []), ...(s?.files.others ?? [])].map((f) => f.path))
    const open = item.from === "pin" ? item.paths : item.paths.filter((p) => files.has(p))
    return open.length ? { open } : null
  }
  if (item.path && !item.folder && (item.from === "tree" || item.from === "pin")) return { open: [item.path] }
  return null
}

/** The switcher's rows take drops: on another workspace's row, what's dragged goes there (sent) and this window
 *  stays on its own. Not the current one's row (the panes here take those drops). */
function useSendDrop() {
  const id = `workspaces:${useId()}`
  useDropTarget<{ n: number; what: Sent }>(id, (item, _x, _y, el) => {
    const n = Number(el?.closest<HTMLElement>("[data-workspace]")?.dataset.workspace)
    const what = sent(item)
    if (!what || !n || n === litNow()) return null
    return { n, what }
  }, (_item, h) => void sendTo(h.n, h.what), {
    hint: ({ n, what }) => ("open" in what ? `Open in ${named(n)}` : "group" in what ? `Move pane to ${named(n)}` : `Move to ${named(n)}`),
  })
  return useDropHit<{ n: number }>(id)?.n ?? null
}

export function Workspaces({ open, phone }: SidebarCtx) {
  useVersion()
  const over = useSendDrop()
  const list = slots()
  if (!list) return null
  // Before any exists, the setup as it is counts as workspace 1.
  const lit = litNow()
  // Phones: the tab list's title pages through them (TabSwitcher, through core/scope.ts).
  if (phone) return null
  return <Switcher lit={lit} over={over} rail={!open} />
}

