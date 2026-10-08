// A blank tab's page: newtab.json's sections, reordered by drag and changed from its menu (like `vau newtab`), all drawn at
// the sidebar's sizes (SidebarRow) and the page a size up as one (`data-size-up`). A button is its command.
import { useId, useRef, type MouseEvent, type ReactNode, type RefObject } from "react"
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Command as CommandIcon, EyeOff, Layers, MousePointerClick, Plus, RotateCcw, Smile, Trash2 } from "lucide-react"
import type { Store } from "@/core/data"
import type { NewTabSection, SidebarPanel } from "@/core/define"
import { available, commandList, keyHint, keysOf, runCommand, useCommandList, type Command } from "@/core/commands"
import { startDrag, useDrag, useDropHit, useDropTarget } from "@/core/drag"
import { commandIcon } from "@/core/pages"
import { newTabSections, sidebarPanels } from "@/core/plugins"
import { getPrefs, setPrefs, usePrefs } from "@/core/prefs"
import { notify } from "@/core/notify"
import { choose } from "@/components/Chooser"
import { pickIcon } from "@/components/IconPicker"
import { checklist, menuFor, type CheckItem, type MenuItem } from "@/components/ContextMenu"
import { panelMenu, SidebarHeading, SidebarRow } from "@/components/Sidebar"
import { changedFiles, RecentList, useOpenedFiles } from "@/components/RecentFiles"
import { CORE_SECTIONS, shownActions, shownSections, withIcon, withPanels, type NewTabSetup, type SectionInfo } from "../../../core/newtab.ts"
import { anchorFor, placeKey } from "../../../core/slots.ts"
import { cn } from "@/lib/utils"
import { Catch, Drawn, Guard } from "@/components/Guard"

type Section = SectionInfo & { heading?: string | false; render?: NewTabSection["render"]; sidebar?: SidebarPanel }

/** Every section there is now: the app's, those of the plugins that are on, then their sidebar panels (drawn as in the
 *  sidebar: core/newtab.ts withPanels). */
function allSections(disabled: string[], order: string[]): Section[] {
  return withPanels<Section, Section>(
    [...CORE_SECTIONS, ...newTabSections(disabled, order).map(({ key, section: s }) => ({ key, title: s.title, sort: s.sort, hidden: s.hidden, only: s.only, heading: s.heading, render: s.render }))],
    sidebarPanels(disabled, order).map(({ key, panel }) => ({ key, title: panel.title, heading: panel.heading ?? panel.title, sidebar: panel })),
  )
}

const fits = (s: Section, phone: boolean) => !s.only || s.only === (phone ? "phone" : "desktop")
const labelOf = (c: Command) => c.label ?? c.name

export function NewTab({ store, phone }: { store: Store; phone?: boolean }) {
  const { disabled, order, newTab } = usePrefs()
  const all = allSections(disabled, order)
  const byKey = new Map(all.map((s) => [s.key, s]))
  const shown = shownSections(newTab, all).flatMap((k) => byKey.get(k) ?? []).filter((s) => fits(s, !!phone))
  // Opened lately in this workspace (core/scope.ts), then the vault's recently changed files (without those, while
  // both are shown).
  const opened = useOpenedFiles(store, 6)
  const both = shown.some((s) => s.key === "core:opened") && opened.length
  const recent = changedFiles(store, both ? 5 : 8, both ? opened : [])
  const body = (s: Section): ReactNode => {
    if (s.key === "core:actions") return <ActionButtons phone={phone} />
    if (s.key === "core:opened") return opened.length ? <RecentList store={store} files={opened} phone={phone} /> : null
    if (s.key === "core:changed") return recent.length ? <RecentList store={store} files={recent} phone={phone} /> : null
    if (s.sidebar) return <PanelSection panel={s.sidebar} id={s.key} store={store} phone={phone} />
    // (one that throws is drawn as a line saying so, by the Guard below: a blank tab is where a stopped app reopens)
    try { return s.render?.({ store, phone: !!phone }) ?? null } catch (e) { return <Drawn draw={() => { throw e }} /> }
  }
  const drawn = shown.map((s) => ({ s, el: body(s) })).filter((x) => x.el !== null)
  const list = useRef<HTMLDivElement>(null)
  const line = useReorder(list, "sections")
  const d = useDrag()
  // Right-click: change the page (on a section or a button, that one first).
  const onMenu = (e: MouseEvent) => {
    const t = e.target as HTMLElement
    const action = t.closest<HTMLElement>("[data-newtab-action]")?.dataset.newtabAction
    const section = t.closest<HTMLElement>("[data-newtab-section]")?.dataset.newtabSection
    menuFor(() => customizeMenu(!!phone, { action, section }))(e)
  }
  const sections = (
    <div className="size-up-bleed">
    {/* A panel's own heading (SidebarHeading) without the sidebar's room above it: the sections' gap is the page's. */}
    <div ref={list} data-size-up className="relative flex flex-col gap-3 [&_[data-panel-handle]]:mt-0">
      {drawn.map(({ s, el }) => {
        const heading = s.heading === false ? null : s.heading ?? s.title
        return (
          // Dragged by its heading (the page's, or the one a sidebar panel draws: data-panel-handle) to reorder.
          <section key={s.key} data-newtab-section={s.key} aria-label={s.title} className={cn(d?.item.newtab?.key === s.key && "opacity-50")}
            onPointerDown={(e) => {
              const t = e.target as HTMLElement
              // A button that is itself the handle (the search field: a panel that's one control) drags too, as in the
              // sidebar; a click on it still works (a drag starts only once the pointer moves).
              const handle = t.closest<HTMLElement>("[data-panel-handle]")
              const control = t.closest("button, a, input")
              if (!handle || (control && !control.hasAttribute("data-panel-handle"))) return
              startDrag(e, { from: "newtab", newtab: { list: "sections", key: s.key }, label: s.title }, { touch: !!phone })
            }}>
            {/* A panel's heading, with what its sidebar heading offers (a finger swipes to it). */}
            {heading && <SidebarHeading title={heading} open>{s.key === "core:actions" ? <AddButton /> : s.sidebar?.actions && <Catch fallback={() => null}><Drawn draw={() => s.sidebar!.actions!({ store, open: true, file: "", tab: "", phone: !!phone })} /></Catch>}</SidebarHeading>}
            <Guard what="This section">{el}</Guard>
          </section>
        )
      })}
      {!drawn.length && !phone && (
        <p className="flex h-7 items-center gap-2 pl-1.5 text-[13px] text-muted-foreground">
          <MousePointerClick className="size-4" strokeWidth={2} />Right-click to choose what a new tab shows
        </p>
      )}
      {line && <div aria-hidden data-newtab-line className="pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary" style={{ top: line.y - 1 }} />}
    </div>
    </div>
  )
  if (phone) return <div onContextMenu={onMenu} className="pt-2">{sections}</div>
  // Above the sections, room that's there while they're few (up to 14vh) and goes as they fill the pane, so a long page
  // starts at the top and a short one doesn't sit against it; below, the rest.
  return (
    <div onContextMenu={onMenu} className="mx-auto flex min-h-full max-w-[520px] flex-col">
      <div aria-hidden className="min-h-6 shrink-0 grow basis-0 max-h-[14vh]" />
      {sections}
      <div aria-hidden className="min-h-10 shrink-0 grow-[2] basis-0" />
    </div>
  )
}

/** Where a section or a button dragged (by its heading; a button itself) would go: the gap nearest the pointer, and the
 *  line's place in the list (`y`, in the list's own px: it may be zoomed; `x` too in a row of icons, the line upright). */
type Reorder = { before: string | null; y: number; x?: number }

/** A list of sections or of buttons as a drop target for its own (core/drag.ts): a drop puts the one dragged before the
 *  one after the line (newtab.json's `sections` or `actions`). `across`: a row of icons that wraps (a phone's dock). */
function useReorder(box: RefObject<HTMLDivElement | null>, list: "sections" | "actions", across = false) {
  const target = `newtab:${useId()}`
  useDropTarget<Reorder>(target, (item, x, y) => {
    const n = item.newtab, root = box.current
    if (n?.list !== list || !root) return null
    const r = root.getBoundingClientRect()
    if (!r.width || x < r.left - 48 || x > r.right + 48 || y < r.top - 24 || y > r.bottom + 24) return null
    const attr = list === "sections" ? "newtabSection" : "newtabAction"
    const rows = [...root.querySelectorAll<HTMLElement>(list === "sections" ? ":scope > [data-newtab-section]" : "[data-newtab-action]")]
    if (!rows.length) return null
    const boxes = rows.map((el) => el.getBoundingClientRect())
    const k = root.offsetHeight / r.height || 1
    if (across) {
      // The gaps: before each icon (halfway from the one before it on its line), after the last; the nearest wins.
      const mid = (b: DOMRect) => (b.top + b.bottom) / 2
      const gaps = boxes.map((b, i) => ({ x: i && boxes[i - 1].top === b.top ? (boxes[i - 1].right + b.left) / 2 : b.left, y: mid(b) }))
      const last = boxes[boxes.length - 1]
      gaps.push({ x: last.right, y: mid(last) })
      const i = gaps.reduce((best, g, j) => (Math.hypot(x - g.x, y - g.y) < Math.hypot(x - gaps[best].x, y - gaps[best].y) ? j : best), 0)
      const mine = rows.findIndex((el) => el.dataset.newtabAction === n.key)
      if (mine >= 0 && (i === mine || i === mine + 1)) return null
      return { before: rows[i]?.dataset.newtabAction ?? null, x: (gaps[i].x - r.left) * k, y: (gaps[i].y - r.top) * k }
    }
    // The gaps: above the first, between each two (halfway), below the last; the nearest wins.
    const edges = boxes.map((b, i) => (i ? (boxes[i - 1].bottom + b.top) / 2 : b.top - 2))
    edges.push(boxes[boxes.length - 1].bottom + 2)
    const i = edges.reduce((best, e, j) => (Math.abs(y - e) < Math.abs(y - edges[best]) ? j : best), 0)
    // Its own place (just above or below itself): nothing to do.
    const mine = rows.findIndex((el) => el.dataset[attr] === n.key)
    if (mine >= 0 && (i === mine || i === mine + 1)) return null
    return { before: rows[i]?.dataset[attr] ?? null, y: (edges[i] - r.top) * k }
  }, (item, h) => {
    const key = item.newtab!.key
    const now = list === "sections" ? sectionsNow() : shownActions(getPrefs().newTab)
    // A key that isn't in the list (a section shown but not saved) goes before the one after the line too.
    void setNewTab({ [list]: placeKey(now, key, h.before && now.includes(h.before) ? h.before : null) })
  })
  return useDropHit<Reorder>(target)
}

/** A sidebar panel as a section: drawn as in the open sidebar (its own heading, if it draws one), its menu the page's. */
function PanelSection({ panel, id, store, phone }: { panel: SidebarPanel; id: string; store: Store; phone?: boolean }) {
  return <div className="flex flex-col" data-newtab-panel={id}><Drawn draw={() => panel.render({ store, open: true, file: "", tab: "", phone })} /></div>
}

/** The buttons: the commands newtab.json lists (or the default ones) that are there now, each drawn as the command is.
 *  The new tab's (the page's menu), and the Buttons panel's (`panel`: their own; `open` false: the rail, icons only;
 *  `dock`: a phone's dock, 44px icons in a row, each held for its name and menu). */
export function ActionButtons({ phone, open = true, panel, dock }: { phone?: boolean; open?: boolean; panel?: string; dock?: boolean }) {
  const { newTab } = usePrefs()
  const byId = new Map(useCommandList().map((c) => [c.id, c]))
  const cmds = available(shownActions(newTab).flatMap((id) => byId.get(id) ?? []))
  const box = useRef<HTMLDivElement>(null)
  const line = useReorder(box, "actions", dock)
  const d = useDrag()
  const dragged = d?.item.newtab?.list === "actions" ? d.item.newtab.key : null
  const menu = (id: string) => [...buttonMenu(id, dock), ...(panel ? panelMenu(panel).map((it, i) => (i ? it : { ...it, sep: true })) : [])]
  if (dock) return (
    <div ref={box} className="relative flex flex-wrap" data-newtab-actions>
      {cmds.map((c) => {
        const Icon = commandIcon(c, newTab.icons?.[c.id]) ?? CommandIcon
        return (
          // Only its icon: held, its menu names it first.
          <button key={c.id} type="button" data-newtab-action={c.id} aria-label={labelOf(c)} onClick={() => runCommand(c)}
            onPointerDown={(e) => startDrag(e, { from: "newtab", newtab: { list: "actions", key: c.id }, label: labelOf(c) }, { touch: true })}
            onContextMenu={menuFor(() => [{ label: labelOf(c), caption: true, run: () => {} }, ...menu(c.id).map((it, i) => (i ? it : { ...it, sep: true }))])}
            className={cn("grid size-11 cursor-pointer place-items-center rounded-[10px] text-primary active:bg-foreground/[0.06]", dragged === c.id && "opacity-50")}>
            <Icon className="size-[21px]" strokeWidth={2} />
          </button>
        )
      })}
      {!cmds.length && (
        <button type="button" aria-label="Add a button" onClick={() => addButton()} className="grid size-11 cursor-pointer place-items-center rounded-[10px] text-muted-foreground active:bg-foreground/[0.06]">
          <Plus className="size-[21px]" strokeWidth={2} />
        </button>
      )}
      {line?.x !== undefined && <div aria-hidden data-newtab-line className="pointer-events-none absolute h-8 w-0.5 rounded-full bg-primary" style={{ left: line.x - 1, top: line.y - 16 }} />}
    </div>
  )
  if (!cmds.length) return null
  return (
    <div ref={box} className="relative flex flex-col gap-px pb-1" data-newtab-actions>
      {cmds.map((c) => {
        const Icon = commandIcon(c, newTab.icons?.[c.id]) ?? CommandIcon
        const keys = keysOf(c)[0]
        return (
          // Dragged to reorder the buttons (the click that ends a drag runs nothing). A row like the others, in the accent.
          <div key={c.id} onPointerDown={(e) => startDrag(e, { from: "newtab", newtab: { list: "actions", key: c.id }, label: labelOf(c) }, { touch: !!phone })}
            onContextMenu={panel ? menuFor(() => menu(c.id)) : undefined} className={cn(dragged === c.id && "opacity-50")}>
            <SidebarRow data-newtab-action={c.id} icon={Icon} tint="var(--primary)" label={labelOf(c)} open={open} className="text-primary" onClick={() => runCommand(c)}>
              {keys && !phone && <span className="mr-1 shrink-0 text-[11px] text-tertiary">{keyHint(keys)}</span>}
            </SidebarRow>
          </div>
        )
      })}
      {line && <div aria-hidden data-newtab-line className="pointer-events-none absolute inset-x-1 h-0.5 rounded-full bg-primary" style={{ top: line.y - 1 }} />}
    </div>
  )
}

/** The buttons' heading's +. */
export function AddButton() {
  return (
    <button type="button" aria-label="Add a button" data-tip="Add a button" onClick={() => addButton()}
      className="grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground">
      <Plus className="size-3.5" strokeWidth={2.25} />
    </button>
  )
}

// ---------- changing the page (newtab.json, a key at a time: prefs.ts) ----------

const setNewTab = (patch: Partial<NewTabSetup>) => setPrefs({ newTab: { ...getPrefs().newTab, ...patch } })
/** The sections shown now, every device's (phone-only ones too), in order. */
const sectionsNow = () => { const { disabled, order, newTab } = getPrefs(); return shownSections(newTab, allSections(disabled, order)) }
const moved = (list: string[], key: string, where: "up" | "down") => placeKey(list, key, anchorFor(list, key, where) ?? null)

/** The page's right-click menu: for the button or section right-clicked (move it, change a button's icon, take it off;
 *  the buttons' own items only on the buttons), then every section to tick (Sections ▸), and Reset when the page isn't the default. */
function customizeMenu(phone: boolean, hit: { action?: string; section?: string }): MenuItem[] {
  const { disabled, order, newTab } = getPrefs()
  const all = allSections(disabled, order)
  const shown = shownSections(newTab, all)
  const buttons = shownActions(newTab)
  const cmds = new Map(commandList().map((c) => [c.id, c]))
  const name = (id: string) => { const c = cmds.get(id); return c ? labelOf(c) : id }
  const out: MenuItem[] = []
  if (hit.action && buttons.includes(hit.action)) out.push(...buttonItems(hit.action))
  else if (hit.section && shown.includes(hit.section)) {
    const key = hit.section, i = shown.indexOf(key), title = all.find((s) => s.key === key)?.title ?? key
    out.push(
      { label: "Move up", icon: ArrowUp, disabled: i === 0, run: () => setNewTab({ sections: moved(shown, key, "up") }) },
      { label: "Move down", icon: ArrowDown, disabled: i === shown.length - 1, run: () => setNewTab({ sections: moved(shown, key, "down") }) },
      { label: `Hide ${title}`, icon: EyeOff, run: () => setNewTab({ sections: shown.filter((k) => k !== key) }) },
    )
  }
  // Ticked: shown, in the page's order; More ▸ has the hidden ones, then the sidebar panels not shown (a checklist).
  const choice = (s: SectionInfo): CheckItem => ({ key: s.key, label: s.title, hint: s.panel ? "Panel" : fits(s, phone) ? undefined : s.only === "phone" ? "Phones" : "Computers" })
  const hidden = all.filter((s) => !shown.includes(s.key))
  const sections = checklist("newtab:sections", {
    on: shown.flatMap((k) => all.find((s) => s.key === k) ?? []).map(choice),
    off: [hidden.filter((s) => !s.panel).map(choice), hidden.filter((s) => s.panel).map(choice)],
    set: (k, on, before) => { const now = sectionsNow(); setNewTab({ sections: on ? placeKey(now, k, before) : now.filter((x) => x !== k) }) },
  })
  if (hit.section === "core:actions" && shown.includes(hit.section)) {
    const buttonItems: MenuItem[] = [
      ...checklist("newtab:buttons", {
        on: buttons.map((id) => ({ key: id, label: name(id) })),
        set: (id, on, before) => { const now = shownActions(getPrefs().newTab); setNewTab({ actions: on ? placeKey(now, id, before) : now.filter((k) => k !== id) }) },
      }),
      { label: "Add a button…", icon: Plus, sep: !!buttons.length, run: () => addButton() },
    ]
    out.push({ label: "Buttons", icon: MousePointerClick, sep: true, run: () => {}, items: buttonItems })
  }
  out.push({ label: "Sections", icon: Layers, sep: !!out.length, run: () => {}, items: sections })
  if (newTab.sections || newTab.actions || newTab.icons) out.push({ label: "Reset new tab", icon: RotateCcw, sep: true, run: () => {
    const was = getPrefs().newTab
    void setNewTab({ sections: null, actions: null, icons: null })
    notify("New tab reset", { action: { label: "Undo", run: () => void setNewTab(was) } })
  } })
  return out
}

/** A button's own items: move it (`across`: in a row of icons), change its icon, take it off. */
function buttonItems(id: string, across = false): MenuItem[] {
  const { newTab } = getPrefs()
  const buttons = shownActions(newTab), i = buttons.indexOf(id), own = newTab.icons?.[id]
  const c = commandList().find((x) => x.id === id)
  return [
    { label: across ? "Move left" : "Move up", icon: across ? ArrowLeft : ArrowUp, disabled: i === 0, run: () => setNewTab({ actions: moved(buttons, id, "up") }) },
    { label: across ? "Move right" : "Move down", icon: across ? ArrowRight : ArrowDown, disabled: i === buttons.length - 1, run: () => setNewTab({ actions: moved(buttons, id, "down") }) },
    { label: "Change icon", icon: Smile, sep: true, run: () => changeIcon(id) },
    ...(own ? [{ label: "Use the command's icon", icon: RotateCcw, run: () => setNewTab({ icons: withIcon(getPrefs().newTab.icons, id, "") }) }] : []),
    { label: `Remove ${c ? labelOf(c) : id}`, icon: Trash2, sep: true, run: () => setNewTab({ actions: buttons.filter((k) => k !== id) }) },
  ]
}

/** A button's menu outside the new tab (the Buttons panel): its own items, then Add a button. */
const buttonMenu = (id: string, across = false): MenuItem[] => [...buttonItems(id, across), { label: "Add a button…", icon: Plus, sep: true, run: () => addButton() }]

/** Pick a button's icon (newtab.json's `icons`), the one it has now ticked. */
function changeIcon(id: string) {
  const c = commandList().find((x) => x.id === id)
  const current = getPrefs().newTab.icons?.[id] ?? (typeof c?.icon === "string" ? c.icon : undefined)
  pickIcon({ title: `${c ? labelOf(c) : id}'s icon`, current, onPick: (n) => setNewTab({ icons: withIcon(getPrefs().newTab.icons, id, n) }) })
}

/** Pick a command (the palette's, available now) to add as a button at the end. */
function addButton() {
  const have = shownActions(getPrefs().newTab)
  const items = available(commandList()).filter((c) => !have.includes(c.id)).sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, label: c.name }))
  choose({
    title: "Add a button", placeholder: "A command to add as a button…", items,
    onPick: (it) => setNewTab({ actions: [...shownActions(getPrefs().newTab).filter((k) => k !== it.id), it.id] }),
  })
}
