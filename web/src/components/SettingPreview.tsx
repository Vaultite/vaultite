// A setting's preview (SettingRow's `preview`): small pictures of what it changes, in a card at its control on hover or
// keyboard focus, under the row on a touch screen. Never by applying it: that would move the page under the pointer.
import { createContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type FocusEvent, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from "react"
import { createPortal } from "react-dom"
import { Check, Info } from "lucide-react"
import { haptic } from "@/core/haptics"
import { cell } from "@/core/signal"
import { cn } from "@/lib/utils"

/** One state of a setting and its picture (drawn in a `Frame`, to fill its box). */
export type PreviewOption = { value: string; label: string; picture: ReactNode }
/** A setting's preview, for SettingRow's `preview`: what each of its states looks like. */
export type Preview = {
  /** What it changes, as a sentence: read out with its control, and shown with the pictures on a touch screen. */
  text: string
  /** Its states, as the control orders them. Two show side by side; of more, the one hovered (else the current). */
  options: PreviewOption[]
  value: string
  set: (v: string) => unknown
}

/** A switch's preview: Off and On. */
export function switchPreview(text: string, [off, on]: [ReactNode, ReactNode], value: boolean, set: (on: boolean) => unknown): Preview {
  return { text, value: value ? "on" : "off", set: (v) => set(v === "on"), options: [{ value: "off", label: "Off", picture: off }, { value: "on", label: "On", picture: on }] }
}

/** The id of the sentence a row's control is described by (Switch, Segmented). */
export const Described = createContext<string | undefined>(undefined)

// As the app's tooltips: a wait before the first, then the next at once (warm), until a moment after the last.
const DELAY = 350, WARM = 500, LINGER = 120
/** `up`: it goes above its row, out of the way of a pointer moving down the rows (below for one moving up). */
/** `glide`: it came from another row's card, open as the pointer moved on: it glides over from there. */
type Open = { id: string; option: string | null; cold: boolean; up: boolean; glide?: boolean }
const open = cell<Open | null>(null)
let warmUntil = 0, opening = 0, closing = 0
let pending: Omit<Open, "cold"> | null = null
/** Esc closed one: no card from the pointer until it moves (the page under it is hovered again as the card goes). */
let shushed = false
/** When a pointer last pressed (a tap or a click focuses too), and where it last was (which way it's going). */
let pressed = 0, lastY = 0
if (typeof window !== "undefined") {
  addEventListener("pointerdown", () => { pressed = Date.now() }, true)
  addEventListener("pointermove", (e) => { lastY = e.clientY; if (e.movementX || e.movementY) shushed = false })
}

/** Where the pointer left the open card's row: heading from there to the card, it may cross other rows (as a menu's
 *  pointer crosses items on its way to a submenu), which then don't take the card. */
let leftAt: { x: number; y: number; t: number } | null = null
let aiming = 0
/** The row the pointer is on (its preview's id). */
let over: string | null = null
const AIM = 400
const side = (a: number[], b: number[], c: number[]) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
const inTriangle = (p: number[], a: number[], b: number[], c: number[]) => {
  const d1 = side(p, a, b), d2 = side(p, b, c), d3 = side(p, c, a)
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}
/** The pointer, at `p`, is on its way from the row it left to the open card. */
function headingToCard(p: [number, number]) {
  const el = document.querySelector("[data-setting-preview] .preview-card")
  if (!leftAt || Date.now() - leftAt.t > AIM || !el) return false
  const r = el.getBoundingClientRect(), from = [leftAt.x, leftAt.y]
  const corners = [[r.left, r.top], [r.right, r.top], [r.right, r.bottom], [r.left, r.bottom]]
  return corners.some((a, i) => corners.slice(i + 1).some((b) => inTriangle(p, from, a, b)))
}

function want(id: string, option: string | null, up: boolean, byPointer = true, at?: [number, number]) {
  // (a touch screen has its own way: the button beside the name)
  if ((byPointer && shushed) || !matchMedia("(any-hover: hover)").matches) return
  clearTimeout(aiming)
  const cur = open.get()
  if (cur && cur.id !== id && at && headingToCard(at)) {
    // (not there a moment later, it wasn't on its way: the row it's on takes it, or none)
    clearTimeout(closing)
    aiming = window.setTimeout(() => { leftAt = null; if (over === id) want(id, option, up, byPointer); else hide() }, 120)
    return
  }
  clearTimeout(closing); clearTimeout(opening)
  if (cur?.id === id) return cur.option !== option && open.set({ ...cur, option })
  if (cur || Date.now() < warmUntil) return open.set({ id, option, up, cold: false, glide: !!cur })
  pending = { id, option, up }
  opening = window.setTimeout(() => { if (pending) open.set({ ...pending, cold: true }); pending = null }, DELAY)
}
function hide() {
  clearTimeout(closing); clearTimeout(opening); pending = null
  if (open.get()) warmUntil = Date.now() + WARM
  open.set(null)
}

const later = () => { clearTimeout(closing); closing = window.setTimeout(hide, LINGER) }
const keep = () => { clearTimeout(closing); clearTimeout(aiming); leftAt = null }
/** The option under the pointer or focused: a Segmented's button (`data-option`). */
const optionAt = (t: EventTarget | null) => (t instanceof Element && t.closest("[data-option]")?.getAttribute("data-option")) || null

/** A row's side of it: the handlers its element takes, the card while it's open, and the touch screen's way to it. */
export function usePreview(preview: Preview | undefined, row: RefObject<HTMLElement | null>, { said }: { said?: boolean } = {}) {
  const id = useId()
  const shown = open.use((o) => (o?.id === id ? o : null))
  const [inline, setInline] = useState(false)
  useEffect(() => () => { if (open.get()?.id === id) hide() }, [id])
  if (!preview) return null
  const mouse = (e: ReactPointerEvent) => e.pointerType === "mouse" && !e.buttons
  // (coming in lower than it was, the pointer is going down the rows)
  const down = (e: ReactPointerEvent) => e.clientY >= lastY
  return {
    desc: `${id}-what`,
    props: {
      "data-has-preview": "",
      onPointerEnter: (e: ReactPointerEvent) => { over = id; if (mouse(e)) want(id, optionAt(e.target), down(e), true, [e.clientX, e.clientY]) },
      onPointerMove: (e: ReactPointerEvent) => {
        if (!mouse(e)) return
        const option = optionAt(e.target)
        if (!shown && pending?.id !== id) want(id, option, down(e), true, [e.clientX, e.clientY])
        else if (shown && shown.option !== option) open.set({ ...shown, option })
        else if (pending?.id === id) pending.option = option
      },
      onPointerLeave: (e: ReactPointerEvent) => {
        if (e.pointerType !== "mouse") return
        if (over === id) over = null
        if (pending?.id === id) { clearTimeout(opening); pending = null }
        if (shown) leftAt = { x: e.clientX, y: e.clientY, t: Date.now() }
        // (crossing a row on its way to the card: the card waits for it)
        else if (leftAt && headingToCard([e.clientX, e.clientY])) return
        later()
      },
      // (keyboard focus only: a tap or a click focuses too)
      onFocus: (e: FocusEvent) => { if (e.target instanceof Element && e.target.matches(":focus-visible") && Date.now() - pressed > 600) want(id, optionAt(e.target), true, false) },
      onBlur: (e: FocusEvent) => { if (!row.current?.contains(e.relatedTarget as Node | null) && (shown || pending?.id === id)) hide() },
    },
    card: shown && <Card preview={preview} row={row} option={shown.option} cold={shown.cold} up={shown.up} glide={!!shown.glide} />,
    button: <InlineButton on={inline} toggle={() => setInline(!inline)} />,
    inline: inline && <Inline preview={preview} said={said} />,
  }
}

const PIC_W = 148, PIC_H = 93, GAP = 12, AWAY = 6

/** What the card is about, on screen: the option under the pointer, else the row's control (its switch, its choice),
 *  else the row. The card sits at it, as a popover at its button: that's where the eye and the pointer are. */
function anchorOf(row: HTMLElement, option: string | null) {
  return (option && row.querySelector<HTMLElement>(`[data-option="${CSS.escape(option)}"]`)) || row.querySelector<HTMLElement>("[role=switch], [role=radiogroup]") || row
}

/** At its row's control: beside the column, level with it, where there's room; else above (`up`) or under the row, its
 *  end at the control's, clear of the rows ahead. `x`, `y`: the control's middle in the card (it grows from there). */
function place(row: HTMLElement, anchor: HTMLElement, w: number, h: number, up: boolean) {
  const r = row.getBoundingClientRect(), a = anchor.getBoundingClientRect()
  const pane = row.closest("[data-pane]")?.getBoundingClientRect()
  const b = { left: Math.max(8, pane?.left ?? 0), right: Math.min(innerWidth - 8, pane?.right ?? innerWidth), top: Math.max(8, pane?.top ?? 0), bottom: Math.min(innerHeight - 8, pane?.bottom ?? innerHeight) }
  const column = row.closest("[data-setting-group]")?.getBoundingClientRect() ?? r
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2
  if (b.right - column.right - AWAY >= w + 8) {
    const top = Math.min(Math.max(b.top, ay - h / 2), b.bottom - h)
    return { side: "right" as const, left: column.right, top, x: 0, y: ay - top }
  }
  // (its far end a little past the control's, so the control sits under the card's corner, not its edge)
  const left = Math.max(b.left, Math.min(a.right + 10 - w, b.right - w))
  const fitsAbove = r.top - h - AWAY >= b.top, fitsBelow = r.bottom + h + AWAY <= b.bottom
  const x = Math.min(Math.max(ax - left, 0), w)
  return (up ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove)
    ? { side: "above" as const, left, top: r.top - h - AWAY, x, y: h }
    : { side: "below" as const, left, top: r.bottom, x, y: 0 }
}

/** Where the last card was: the next one, taking over from it, glides over from there to its row. */
let last: { left: number; top: number } | null = null

/** The card: pictures over their names; of a switch both, the current one ringed. A picture clicked sets it. */
function Card({ preview, row, option, cold, up, glide }: { preview: Preview; row: RefObject<HTMLElement | null>; option: string | null; cold: boolean; up: boolean; glide: boolean }) {
  const el = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<(ReturnType<typeof place> & { glide?: boolean }) | null>(null)
  const both = preview.options.length <= 2
  const shownOptions = both ? preview.options : [preview.options.find((o) => o.value === option) ?? preview.options.find((o) => o.value === preview.value) ?? preview.options[0]]
  useLayoutEffect(() => {
    // (in the top layer, so it shows over a sheet too: a modal dialog is above any z-index)
    if (el.current && !el.current.matches(":popover-open")) el.current.showPopover?.()
    if (!row.current || !box.current) return
    const to = place(row.current, anchorOf(row.current, option), box.current.offsetWidth, box.current.offsetHeight, up)
    // Warm, from row to row, it glides from where the last one was (or, moving along a choice, from where it is), as
    // one card going with the pointer, not one going and another coming: on the spring, so never chasing it.
    const from = at ?? (glide ? last : null)
    if (!from || (Math.abs(from.left - to.left) < 1 && Math.abs(from.top - to.top) < 1)) { setAt(to); return }
    if (at) { setAt({ ...to, glide: true }); return }
    setAt({ ...to, left: from.left, top: from.top })
    const f = requestAnimationFrame(() => setAt({ ...to, glide: true }))
    return () => cancelAnimationFrame(f)
    // (not `at`: it's where it is, not why it moves)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row, shownOptions.length, up, option, glide])
  useEffect(() => { if (at) last = { left: at.left, top: at.top } }, [at])
  useEffect(() => {
    const scroll = (e: Event) => { if (e.target instanceof Node && e.target.contains(row.current)) hide() }
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!row.current?.contains(t) && !el.current?.contains(t)) hide() }
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); shushed = true; hide() } }
    addEventListener("scroll", scroll, true); addEventListener("pointerdown", down, true); addEventListener("keydown", key, true)
    addEventListener("blur", hide); addEventListener("resize", hide)
    return () => {
      removeEventListener("scroll", scroll, true); removeEventListener("pointerdown", down, true); removeEventListener("keydown", key, true)
      removeEventListener("blur", hide); removeEventListener("resize", hide)
    }
  }, [row])
  const current = shownOptions.findIndex((o) => o.value === preview.value)
  // (its padding toward the row is a bridge: the pointer crossing to it never leaves both)
  const pad = { right: "pl-1.5", below: "pt-1.5", above: "pb-1.5" }[at?.side ?? "below"]
  // (it grows out of the control)
  const origin = at ? `${at.x}px ${at.y}px` : "top left"
  return createPortal(
    <div ref={el} popover="manual" aria-hidden data-setting-preview={row.current?.getAttribute("data-settings-row") ?? row.current?.getAttribute("data-setting") ?? ""} data-side={at?.side} data-cold={cold || undefined}
      onPointerEnter={keep} onPointerLeave={(e) => { if (e.pointerType === "mouse") later() }}
      className={cn("fixed inset-auto m-0 overflow-visible border-0 bg-transparent p-0 text-foreground", pad, !at && "invisible")} style={{ left: at?.left ?? 0, top: at?.top ?? 0, transition: at?.glide ? "left var(--motion-spring) var(--spring), top var(--motion-spring) var(--spring)" : undefined }}>
      <div ref={box} className="preview-card glass-strong rounded-[12px] p-2.5 shadow-xl" style={{ transformOrigin: origin }}>
        <div className="relative flex gap-3">
          {/* The ring, one for the card, so flipping the switch slides it to the other picture. */}
          {current >= 0 && <span aria-hidden data-preview-ring className={cn("pointer-events-none absolute -top-[3px] -left-[3px] rounded-[10px] border-2 border-primary", both && "transition-transform duration-[var(--motion-spring)] ease-[var(--spring)]")}
            style={{ width: PIC_W + 6, height: PIC_H + 6, transform: `translateX(${current * (PIC_W + GAP)}px)` }} />}
          {shownOptions.map((o) => {
            const on = o.value === preview.value
            return (
              <button key={o.value} type="button" tabIndex={-1} data-preview-pick={o.value} data-current={on || undefined} onMouseDown={(e) => e.preventDefault()}
                onClick={() => { if (!on) { haptic("selection"); void preview.set(o.value) } }}
                className={cn("group/pp flex flex-col items-center gap-1.5", on ? "cursor-default" : "cursor-pointer")}>
                <span className={cn("block overflow-hidden rounded-[7px] ring-[0.5px] ring-border transition-shadow", !on && "group-hover/pp:shadow-[0_0_0_2.5px_var(--border)]")} style={{ width: PIC_W, height: PIC_H }}>{o.picture}</span>
                <Name label={o.label} on={on} />
              </button>
            )
          })}
        </div>
      </div>
    </div>, row.current?.closest("dialog") ?? document.body) // (a sheet's in its dialog: the modal sheet makes the rest inert)
}

const Name = ({ label, on, big }: { label: string; on: boolean; big?: boolean }) => (
  <span className={cn("flex max-w-full items-center gap-1 text-[12px] leading-[16px]", big && "max-md:text-[13px] max-md:leading-[18px]", on ? "font-semibold" : "text-muted-foreground")}>
    <span className="truncate">{label}</span>{on && <Check aria-hidden className="size-3 shrink-0 text-primary" strokeWidth={3} />}
  </span>
)

/** On a touch screen, beside the setting's name: shows the pictures under its row. */
function InlineButton({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button type="button" aria-expanded={on} aria-label="Show what it changes" data-preview-button onClick={toggle}
      className={cn("relative ml-1.5 inline-grid size-5 cursor-pointer place-items-center align-[-4px] [@media(hover:hover)]:hidden",
        "after:absolute after:-inset-3 after:content-['']", on ? "text-primary" : "text-tertiary")}>
      <Info className="size-[17px]" strokeWidth={2} />
    </button>
  )
}

/** Under the row: every state, the current one ringed (a tap picks one), and what changes in words unless the row's
 *  line under its name says it (`said`). */
function Inline({ preview, said }: { preview: Preview; said?: boolean }) {
  return (
    <div data-preview-inline className="basis-full pb-1.5">
      <div role="radiogroup" aria-label={preview.text} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${preview.options.length}, minmax(0, 1fr))` } as CSSProperties}>
        {preview.options.map((o) => {
          const on = o.value === preview.value
          return (
            <button key={o.value} type="button" role="radio" aria-checked={on} aria-label={o.label} data-preview-pick={o.value}
              onClick={() => { if (!on) { haptic("selection"); void preview.set(o.value) } }}
              className="flex min-w-0 cursor-pointer flex-col items-center gap-1.5">
              <span className={cn("block aspect-[16/10] w-full overflow-hidden rounded-[8px] ring-[0.5px] ring-border transition-shadow",
                on && "shadow-[0_0_0_2.5px_var(--background),0_0_0_4.5px_var(--primary)]")}>{o.picture}</span>
              <Name label={o.label} on={on} big />
            </button>
          )
        })}
      </div>
      {!said && <p className="mt-2 text-[13px] leading-[18px] text-muted-foreground">{preview.text}</p>}
    </div>
  )
}
