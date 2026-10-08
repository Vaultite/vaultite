// The app's own menus (openMenu, menuFor), never the browser's, except in text fields where its menu keeps copy, paste
// and spelling. On touch a finger held still is the right-click (watchHolds), so every menu works on phones.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronLeft, ChevronRight, Ellipsis, type LucideIcon } from "lucide-react"
import { keyHint, keysOf, offeredCommand, runOrSay } from "@/core/commands"
import { fingerHolding, useDragging } from "@/core/drag"
import { holdFocus } from "@/core/focus"
import { haptic } from "@/core/haptics"
import { usePageLock } from "@/core/pagelock"
import { cn } from "@/lib/utils"
import { signal } from "@/core/signal"

export type MenuItem = {
  label: string; icon?: LucideIcon; run: () => void; danger?: boolean; disabled?: boolean
  /** A choice: a check shows on the one that's on. */
  checked?: boolean
  /** Muted text at the row's right end: where it is (a panel in the other sidebar: Right sidebar). */
  hint?: string
  /** Clicking it leaves the menu open (redrawn), to switch several things at once (the sidebar's pages). */
  keep?: boolean
  /** A line above it. */
  sep?: boolean
  /** A submenu (New ▸): hovering, clicking or → opens it; its items are menu items too (`run` is then unused). */
  items?: MenuItem[]
  /** With `items`: clicking the row runs `run`, the common choice (Copy path: from the vault folder), while hovering,
   *  → or its chevron opens the rest; the submenu repeats it first so it can be found. Phones: the chevron drills in. */
  split?: boolean
  /** Not a choice: muted text that wraps, saying what the menu is about (a block's description, where its live data
   *  comes from). `run` is unused. */
  caption?: boolean
}
/** Commands as menu rows (by id), those offered now: their name, icon and first keys, so a menu and the palette say the
 *  same (the File explorer's Show hidden files, a tab bar's Reopen closed tab). A pair that swaps (Show / Hide) is both
 *  ids: only the one offered shows. */
export function commandItems(...ids: string[]): MenuItem[] {
  return ids.flatMap((id) => {
    const c = offeredCommand(id)
    if (!c) return []
    const keys = keysOf(c)[0]
    return [{ label: c.name, icon: typeof c.icon === "string" ? undefined : c.icon as LucideIcon | undefined, hint: keys ? keyHint(keys) : undefined, run: () => c.run() }]
  })
}

/** `up`: the menu's bottom sits at `at` (above a button at the bottom of the window). */
type Open = { at: { x: number; y: number }; items: MenuItem[]; up?: boolean
  /** The items again (after a `keep` item changed something). */
  again?: () => MenuItem[] } | null

let open: Open = null
const subs = signal()
const set = (o: Open) => { open = o; subs.notify() }
/** Phones: rows, text and icons like the phone's More menu (44px, 17px, 20px); desktop: 28px, 13px, 16px. */
const icon = "size-5 shrink-0 md:size-4"

export function openMenu(at: { x: number; y: number }, items: MenuItem[], up = false, again?: () => MenuItem[]) {
  if (!items.length) return
  if (!open) release = holdFocus()
  set({ at, items, up, again })
}
/** The open menu's items swapped for others, if it's still the one showing `was` (what came in after it opened: a
 *  block's sources). */
export function replaceMenu(was: MenuItem[], items: MenuItem[]) {
  if (open?.items === was) set({ ...open, items, again: undefined })
}
/** A menu is showing. */
export const menuShowing = () => open !== null
/** The open menu's items are being asked for again (after a `keep` click), not for a new menu. */
let redrawing = false
const closeMenu = () => { set(null); if (release) { const r = release; release = null; r() } }
/** The keyboard goes back where it was when the menu closes (core/focus.ts). */
let release: (() => void) | null = null
const openState = () => open
/** For onContextMenu: the menu at the pointer (nothing if there are no items; never the browser's). */
export const menuFor = (items: () => MenuItem[]) => (e: MouseEvent) => {
  e.preventDefault(); e.stopPropagation()
  openMenu({ x: e.clientX, y: e.clientY }, items(), false, items)
}
/** For a card (a phone's tab card): the menu under it, or over it when it's low on the screen, not at the finger. */
export const menuOnCard = (items: () => MenuItem[]) => (e: MouseEvent) => {
  e.preventDefault(); e.stopPropagation()
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const up = r.top + r.height / 2 > innerHeight / 2
  openMenu({ x: r.left, y: up ? r.top - 8 : r.bottom + 8 }, items(), up, items)
}
const redraw = (items: () => MenuItem[]) => { redrawing = true; try { return items() } finally { redrawing = false } }

// ---------- checklists ----------

/** One thing a checklist turns on or off. */
export type CheckItem = { key: string; label: string; hint?: string; disabled?: boolean }
/** The rows each checklist of the open menu showed when it opened (its ticked ones, More's groups), by its id. */
const listed = new Map<string, { rows: CheckItem[]; more: CheckItem[][] }>()

/** Which things are on, as menu rows (the panels a sidebar shows, the pinned pages, a new tab's sections and buttons):
 *  the ones on, ticked, in their order, then More ▸ with the rest (`off`, groups with a line between). Every row is a
 *  checkbox that leaves the menu open, so several can change at once, and keeps its place until the menu closes:
 *  unticked and ticked again, it's back where it was; ticked in More, it stays there, on at the end (listed with the
 *  others next time). `set(key, on, before)`: turn it on before `before` (null: at the end), or off. `id` tells a
 *  menu's lists apart. */
export function checklist(id: string, { on, off = [], set }: {
  on: CheckItem[]; off?: CheckItem[][]; set: (key: string, on: boolean, before: string | null) => void
}): MenuItem[] {
  const was = redrawing ? listed.get(id) : undefined
  // Labels and hints as they are now; what came on elsewhere since the menu opened joins the ticked ones.
  const now = (c: CheckItem) => on.find((o) => o.key === c.key) ?? off.flat().find((o) => o.key === c.key) ?? c
  const placed = (k: string) => !!was && (was.rows.some((c) => c.key === k) || was.more.some((g) => g.some((c) => c.key === k)))
  const rows = was ? [...was.rows.map(now), ...on.filter((o) => !placed(o.key))] : on
  const more = was ? was.more.map((g) => g.map(now)) : off.map((g) => g.filter((c) => !on.some((o) => o.key === c.key)))
  listed.set(id, { rows, more })
  const isOn = (k: string) => on.some((o) => o.key === k)
  const row = (c: CheckItem, before: () => string | null, sep?: boolean): MenuItem => ({
    label: c.label, hint: c.hint, disabled: c.disabled, checked: isOn(c.key), keep: true, sep,
    run: () => (isOn(c.key) ? set(c.key, false, null) : set(c.key, true, before())),
  })
  // Ticked again: before the next of the menu's rows that's still on.
  const list = rows.map((c, i) => row(c, () => rows.slice(i + 1).find((r) => isOn(r.key))?.key ?? null))
  const extra = more.filter((g) => g.length).flatMap((g, gi) => g.map((c, i) => row(c, () => null, gi > 0 && i === 0)))
  if (extra.length) list.push({ label: "More", icon: Ellipsis, sep: list.length > 0, run: () => {}, items: extra })
  return list
}

// ---------- a held finger is a right-click ----------

/** How long a finger rests still before it's a right-click: under iOS's own hold (~500ms: text selection, a link's
 *  preview), so the menu comes first. */
const HOLD_MS = 450
/** Where a hold stays the system's (text selection, editor, terminal) or something holds for itself (`data-own-hold`).
 *  `data-hold-menu` inside one opts back in (an image or a block in a note), unless a field in it is closer. */
const OWN_HOLD = "input, textarea, select, [contenteditable=''], [contenteditable='true'], .cm-editor, .xterm, [data-own-hold]"
const ownHold = (el: Element) => {
  if (el.closest("[data-own-hold]")) return true
  const own = el.closest(OWN_HOLD), menu = el.closest("[data-hold-menu]")
  return !!own && !(menu && own.contains(menu))
}
/** The contextmenu events a hold sent (ContextMenus' blocker leaves them, so `defaultPrevented` says a handler took one). */
const held = new WeakSet<Event>()

/** iOS never sends contextmenu, so a finger held still sends one to what's under it. Taken (preventDefault or a drag
 *  pickup), the phone taps and the lifting click is swallowed; a move or early lift calls it off. Returns a stop. */
function watchHolds() {
  let timer = 0, from = { x: 0, y: 0 }, target: Element | null = null
  const stop = () => { clearTimeout(timer); timer = 0 }
  const down = (e: globalThis.PointerEvent) => {
    stop()
    const t = e.target
    if (e.pointerType !== "touch" || !e.isPrimary || !(t instanceof Element) || ownHold(t)) return
    from = { x: e.clientX, y: e.clientY }
    target = t
    timer = window.setTimeout(() => {
      timer = 0
      // What's under the finger now: the press may have begun on a picture of the screen (a tab growing out of its +,
      // a view transition: core/motion.ts), whose target is the page itself.
      const now = document.elementFromPoint(from.x, from.y)
      const at = now && now !== document.documentElement ? now : target
      if (!at?.isConnected || ownHold(at)) return
      const ev = new globalThis.MouseEvent("contextmenu", { bubbles: true, cancelable: true, composed: true, view: window, clientX: from.x, clientY: from.y, button: 2, buttons: 2 })
      held.add(ev)
      at.dispatchEvent(ev)
      // A menu opened, or the finger picked something up (core/drag.ts): a tap, as iOS answers a hold.
      if (!ev.defaultPrevented && !fingerHolding()) return
      haptic(fingerHolding() ? "medium" : "light")
      getSelection()?.removeAllRanges()
      const swallow = (c: Event) => { c.preventDefault(); c.stopPropagation() }
      addEventListener("click", swallow, { capture: true, once: true })
      setTimeout(() => removeEventListener("click", swallow, { capture: true }), 800)
    }, HOLD_MS)
  }
  const move = (e: globalThis.PointerEvent) => { if (timer && Math.hypot(e.clientX - from.x, e.clientY - from.y) > 10) stop() }
  // The system's own contextmenu (Android's hold, a mouse's right button): not a second one.
  const native = (e: Event) => { if (!held.has(e)) stop() }
  const opts = { capture: true, passive: true }
  addEventListener("pointerdown", down, opts)
  addEventListener("pointermove", move, opts)
  addEventListener("pointerup", stop, opts)
  addEventListener("pointercancel", stop, opts)
  addEventListener("scroll", stop, opts)
  addEventListener("contextmenu", native, { capture: true })
  return () => {
    stop()
    removeEventListener("pointerdown", down, opts)
    removeEventListener("pointermove", move, opts)
    removeEventListener("pointerup", stop, opts)
    removeEventListener("pointercancel", stop, opts)
    removeEventListener("scroll", stop, opts)
    removeEventListener("contextmenu", native, { capture: true })
  }
}
/** For a … button: the menu under it. */
export const menuBelow = (e: MouseEvent, items: MenuItem[]) => {
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openMenu({ x: r.left, y: r.bottom + 4 }, items)
}
/** For a button at the bottom (the status bar): the menu above it. */
export const menuAbove = (e: MouseEvent, items: MenuItem[]) => {
  e.preventDefault(); e.stopPropagation()
  const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
  openMenu({ x: r.left, y: r.top - 4 }, items, true)
}

const typing = (t: EventTarget | null) =>
  t instanceof Element && !!t.closest("input, textarea, [contenteditable=''], [contenteditable='true'], .cm-content")

/** Mounted once (App): draws the open menu, keeps the browser's menu away and makes a held finger a right-click. */
export function ContextMenus() {
  const o = subs.use(() => open)
  // A drag began (a finger that held a row, opening its menu, then moved): the menu goes.
  const dragging = useDragging()
  useEffect(() => { if (dragging) closeMenu() }, [dragging])
  useEffect(() => {
    // Bubble phase: React's handlers (which open a menu) run first.
    // (a hold's own event is left alone: it has no browser menu, and whether a handler took it is what it asks)
    const block = (e: globalThis.MouseEvent) => { if (!e.defaultPrevented && !typing(e.target) && !held.has(e)) e.preventDefault() }
    document.addEventListener("contextmenu", block)
    const unhold = watchHolds()
    return () => { document.removeEventListener("contextmenu", block); unhold() }
  }, [])
  return o ? createPortal(<Menu key={`${o.at.x},${o.at.y}`} at={o.at} items={o.items} up={o.up} again={o.again} />, document.body) : null
}

function Menu({ at, items, up, again }: { at: { x: number; y: number }; items: MenuItem[]; up?: boolean; again?: () => MenuItem[] }) {
  usePageLock()
  useEffect(() => {
    // Escape closes the menu (a submenu handles its own first); so does the window changing size. Only the menu: the
    // key's own close request would reach the sheet under it once the menu's layer is gone.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); closeMenu() } }
    addEventListener("keydown", onKey)
    addEventListener("resize", closeMenu)
    return () => { removeEventListener("keydown", onKey); removeEventListener("resize", closeMenu) }
  }, [at])
  // Over an open sheet (a modal <dialog>: the rest of the page is inert), the menu is a modal dialog of its own above it.
  const [over] = useState(() => [...document.querySelectorAll("dialog[open]")].some((d) => { try { return d.matches(":modal") } catch { return false } }))
  const layer = useRef<HTMLDialogElement>(null)
  // The list goes in once the layer is open: a shut <dialog> has no size, so it couldn't keep itself on screen.
  const [ready, setReady] = useState(!over)
  useLayoutEffect(() => { if (over) { layer.current?.showModal(); setReady(true) } }, [over])
  const body = (
    <>
      <button type="button" aria-label="Close menu" tabIndex={-1} className="fixed inset-0 z-[60] cursor-default" onClick={closeMenu}
        onContextMenu={(e) => { e.preventDefault(); closeMenu() }} />
      <MenuList items={items} at={at} up={up} again={again} focus />
    </>
  )
  if (!over) return body
  return (
    <dialog ref={layer} data-menu-layer onCancel={(e) => { e.preventDefault(); closeMenu() }}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-visible border-0 bg-transparent p-0 outline-none backdrop:bg-transparent">
      {ready && body}
    </dialog>
  )
}

/** One level of a menu, at a point or beside the item that opened it. Phones have no room beside: a submenu takes the
 *  menu's place, with a Back row. Arrows move; → opens a submenu, ← or Escape closes one. */
function MenuList({ items, at, up, beside, again, focus, onBack, onHover }: {
  items: MenuItem[]; at?: { x: number; y: number }; up?: boolean
  /** A submenu: the rect of the item it belongs to. */
  beside?: DOMRect
  /** The whole menu's items again (the top level's), after a `keep` item changed something: a `keep` item in a
   *  submenu redraws the whole menu too, the submenu staying open (the sidebar's Panels ▸). */
  again?: () => MenuItem[]
  /** Focus its first item when it opens (the top level, or a submenu opened from the keyboard). */
  focus?: boolean
  /** Close this submenu (and give its item the focus back). */
  onBack?: (refocus: boolean) => void
  /** The pointer reached this submenu: its item's menu keeps it open. */
  onHover?: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  // The open submenu, by its row's label: a menu drawn again (a `keep` click) can have rows come and go above it.
  const [sub, setSub] = useState<{ label: string; rect: DOMRect; focus: boolean } | null>(null)
  const subAt = sub ? items.findIndex((it) => it.label === sub.label) : -1
  const timer = useRef(0)
  const [drill] = useState(() => !beside && !matchMedia("(min-width: 768px)").matches)
  // Phones: the submenus opened in place, outermost first.
  const [trail, setTrail] = useState<number[]>([])
  const shown = trail.reduce<MenuItem[]>((its, i) => its[i]?.items ?? its, items)
  const parent = trail.length ? trail.slice(0, -1).reduce<MenuItem[]>((its, i) => its[i]?.items ?? its, items)[trail[trail.length - 1]] : null
  const lead = shown.some((it) => it.icon || it.items)
  // Placed (kept on screen) before the first paint, and no animation: it's there at once, like a native menu.
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    let x: number, y: number
    if (beside) {
      x = beside.right + r.width + 8 <= innerWidth ? beside.right - 2 : beside.left - r.width + 2
      y = beside.top - 5  // its first item level with the item that opened it
    } else {
      x = at!.x
      y = up ? at!.y - r.height : at!.y
    }
    setPos({ x: Math.max(8, Math.min(x, innerWidth - r.width - 8)), y: Math.max(8, Math.min(y, innerHeight - r.height - 8)) })
  }, [at, up, beside, items, trail])
  // Once it's placed (a hidden element can't take the focus).
  const placed = pos !== null
  useLayoutEffect(() => {
    if (placed && (focus || trail.length)) ref.current?.querySelector<HTMLElement>(":scope > button:not(:disabled)")?.focus({ preventScroll: true })
  }, [placed, focus, trail])
  useEffect(() => () => clearTimeout(timer.current), [])
  const open = (i: number, el: HTMLElement, focusFirst: boolean) => { clearTimeout(timer.current); setSub({ label: shown[i].label, rect: el.getBoundingClientRect(), focus: focusFirst }) }
  const later = (fn: () => void) => { clearTimeout(timer.current); timer.current = window.setTimeout(fn, 120) }
  const onKey = (e: React.KeyboardEvent) => {
    const all = [...(ref.current?.querySelectorAll<HTMLElement>(":scope > button:not(:disabled)") ?? [])]
    const cur = document.activeElement as HTMLElement
    if (!all.includes(cur) && e.target !== ref.current) return  // a key inside a submenu: it handles its own
    e.stopPropagation()
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const i = all.indexOf(cur)
      all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus()
    } else if (e.key === "ArrowRight") {
      const i = Number(cur?.dataset.index)
      if (shown[i]?.items?.length) { e.preventDefault(); if (drill) setTrail([...trail, i]); else open(i, cur, true) }
    } else if ((e.key === "ArrowLeft" || e.key === "Escape") && trail.length) {
      e.preventDefault(); setTrail(trail.slice(0, -1))
    } else if ((e.key === "ArrowLeft" || e.key === "Escape") && onBack) {
      e.preventDefault(); onBack(true)
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault(); all[e.key === "Home" ? 0 : all.length - 1]?.focus()
    } else if (e.key === "Escape" || e.key === "Tab") { e.preventDefault(); closeMenu() }
  }
  return (
    <div ref={ref} role="menu" tabIndex={-1} onKeyDown={onKey} style={pos ? { left: pos.x, top: pos.y } : { left: 0, top: 0, visibility: "hidden" }}
      onPointerEnter={() => { clearTimeout(timer.current); onHover?.() }}
      className="glass-strong fixed z-[61] max-h-[calc(100dvh-1rem)] min-w-56 overflow-y-auto overscroll-contain rounded-[12px] p-1 shadow-xl outline-none md:min-w-48 md:rounded-[10px]">
      {parent && (
        <button type="button" onClick={() => setTrail(trail.slice(0, -1))}
          className="flex h-11 w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 text-left text-[17px] font-medium whitespace-nowrap text-muted-foreground hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07] focus-visible:outline-none">
          <ChevronLeft className={icon} strokeWidth={2} />
          <span className="flex-1">{parent.label}</span>
        </button>
      )}
      {parent && <div role="separator" className="mx-2.5 my-1 h-px bg-border" />}
      {shown.map((it, i) => (
        <Fragment key={it.label}>
          {it.sep && <div role="separator" className="mx-2.5 my-1 h-px bg-border" />}
          {it.caption ? (
            <p className="flex max-w-80 gap-3 px-3 py-2 text-[15px] leading-5 text-muted-foreground md:max-w-72 md:gap-2.5 md:px-2.5 md:py-1.5 md:text-[12px] md:leading-4">
              {it.icon ? <it.icon className={cn(icon, "md:mt-px")} strokeWidth={2} /> : lead && <span className={icon} />}
              <span className="flex-1">{it.label}</span>
            </p>
          ) : <button type="button" data-index={i}
            role={it.checked === undefined ? "menuitem" : it.keep ? "menuitemcheckbox" : "menuitemradio"} aria-checked={it.checked}
            aria-haspopup={it.items ? "menu" : undefined} aria-expanded={it.items ? subAt === i : undefined}
            disabled={it.disabled}
            onPointerEnter={(e) => {
              // A finger has no hover: its tap is the click (a hover's timer would close what the tap opened).
              if (drill || e.pointerType === "touch") return
              const el = e.currentTarget
              if (it.items && !it.disabled) { if (subAt === i) clearTimeout(timer.current); else later(() => open(i, el, false)) }
              else if (sub) later(() => setSub(null))
            }}
            onClick={(e) => {
              // A split row runs its own choice unless the click was on its chevron (the keyboard's Enter runs it too).
              const more = it.items && (!it.split || !!(e.target as Element).closest("[data-menu-more]"))
              if (it.items && more && drill) { setTrail([...trail, i]); return }
              if (more) { if (subAt === i) setSub(null); else open(i, e.currentTarget, e.detail === 0); return }
              if (it.keep && again) { runOrSay(it.run, it.label); if (openState()) set({ ...openState()!, items: redraw(again) }); return }
              closeMenu(); runOrSay(it.run, it.label)
            }}
            className={cn("flex h-11 w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 text-left text-[17px] whitespace-nowrap hover:bg-foreground/[0.07] focus-visible:bg-foreground/[0.07] focus-visible:outline-none disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent md:h-7 md:gap-2.5 md:rounded-[4px] md:px-2.5 md:text-[13px]",
              it.danger && "text-destructive", subAt === i && "bg-foreground/[0.07]")}>
            {it.checked !== undefined
              ? <Check className={cn(icon, !it.checked && "invisible")} strokeWidth={2.5} />
              : it.icon ? <it.icon className={icon} strokeWidth={2} /> : lead && <span className={icon} />}
            <span className="flex-1">{it.label}</span>
            {it.hint && <span className="pl-4 text-muted-foreground">{it.hint}</span>}
            {it.items && (it.split
              // A finger's target of its own on phones (44px, a line before it); on desktop hovering opens it anyway.
              ? <span data-menu-more className="-mr-3 flex h-11 w-11 shrink-0 items-center justify-center border-l-[0.5px] border-border md:-mr-2.5 md:h-7 md:w-7 md:border-l-0">
                  <ChevronRight className={cn(icon, "text-muted-foreground")} strokeWidth={2} />
                </span>
              : <ChevronRight className={cn(icon, "-mr-1 text-muted-foreground")} strokeWidth={2} />)}
          </button>}
        </Fragment>
      ))}
      {/* Beside it, not in it: its backdrop blur would make it the submenu's containing block (and a long menu scrolls).
          In its layer: over a sheet that's the menu's own modal dialog, and anything outside it is inert. */}
      {sub && !drill && items[subAt]?.items && createPortal(
        <MenuList key={sub.label} items={items[subAt].items!} beside={sub.rect} focus={sub.focus} again={again} onHover={() => clearTimeout(timer.current)}
          onBack={(refocus) => {
            const i = subAt
            setSub(null)
            if (refocus) ref.current?.querySelector<HTMLElement>(`:scope > button[data-index="${i}"]`)?.focus()
          }} />,
        document.querySelector("dialog[data-menu-layer]") ?? document.body,
      )}
    </div>
  )
}
