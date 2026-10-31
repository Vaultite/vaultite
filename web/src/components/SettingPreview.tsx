// A setting's preview (SettingRow's `preview`): small pictures of what it changes, in a card beside its row on hover or
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
type Open = { id: string; option: string | null; cold: boolean; up: boolean }
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

function want(id: string, option: string | null, up: boolean, byPointer = true) {
  // (a touch screen has its own way: the button beside the name)
  if ((byPointer && shushed) || !matchMedia("(any-hover: hover)").matches) return
  clearTimeout(closing); clearTimeout(opening)
  const cur = open.get()
  if (cur?.id === id) return cur.option !== option && open.set({ ...cur, option })
  if (cur || Date.now() < warmUntil) return open.set({ id, option, up, cold: false })
  pending = { id, option, up }
  opening = window.setTimeout(() => { if (pending) open.set({ ...pending, cold: true }); pending = null }, DELAY)
}
function hide() {
  clearTimeout(closing); clearTimeout(opening); pending = null
  if (open.get()) warmUntil = Date.now() + WARM
  open.set(null)
}

const later = () => { clearTimeout(closing); closing = window.setTimeout(hide, LINGER) }
const keep = () => clearTimeout(closing)
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
      onPointerEnter: (e: ReactPointerEvent) => { if (mouse(e)) want(id, optionAt(e.target), down(e)) },
      onPointerMove: (e: ReactPointerEvent) => {
        if (!mouse(e)) return
        const option = optionAt(e.target)
        if (!shown && pending?.id !== id) want(id, option, down(e))
        else if (shown && shown.option !== option) open.set({ ...shown, option })
        else if (pending?.id === id) pending.option = option
      },
      onPointerLeave: (e: ReactPointerEvent) => {
        if (e.pointerType !== "mouse") return
        if (pending?.id === id) { clearTimeout(opening); pending = null }
        later()
      },
      // (keyboard focus only: a tap or a click focuses too)
      onFocus: (e: FocusEvent) => { if (e.target instanceof Element && e.target.matches(":focus-visible") && Date.now() - pressed > 600) want(id, optionAt(e.target), true, false) },
      onBlur: (e: FocusEvent) => { if (!row.current?.contains(e.relatedTarget as Node | null) && (shown || pending?.id === id)) hide() },
    },
    card: shown && <Card preview={preview} row={row} option={shown.option} cold={shown.cold} up={shown.up} />,
    button: <InlineButton on={inline} toggle={() => setInline(!inline)} />,
    inline: inline && <Inline preview={preview} said={said} />,
  }
}

const PIC_W = 148, PIC_H = 93, GAP = 12, AWAY = 6

/** Where the card goes: beside the column of rows where there's room, else above the row (`up`) or under it, at its
 *  name's side: clear of every row's control, and of the rows the pointer is heading to. */
function place(row: HTMLElement, w: number, h: number, up: boolean) {
  const r = row.getBoundingClientRect()
  const pane = row.closest("[data-pane]")?.getBoundingClientRect()
  const b = { left: Math.max(8, pane?.left ?? 0), right: Math.min(innerWidth - 8, pane?.right ?? innerWidth), top: Math.max(8, pane?.top ?? 0), bottom: Math.min(innerHeight - 8, pane?.bottom ?? innerHeight) }
  const column = row.closest("[data-setting-group]")?.getBoundingClientRect() ?? r
  if (b.right - column.right - AWAY >= w + 8) {
    return { side: "right" as const, left: column.right, top: Math.min(Math.max(b.top, r.top + r.height / 2 - h / 2), b.bottom - h) }
  }
  const left = Math.max(b.left, Math.min(r.left - 4, b.right - w))
  const fitsAbove = r.top - h - AWAY >= b.top, fitsBelow = r.bottom + h + AWAY <= b.bottom
  return (up ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove)
    ? { side: "above" as const, left, top: r.top - h - AWAY }
    : { side: "below" as const, left, top: r.bottom }
}

/** The card: pictures over their names; of a switch both, the current one ringed. A picture clicked sets it. */
function Card({ preview, row, option, cold, up }: { preview: Preview; row: RefObject<HTMLElement | null>; option: string | null; cold: boolean; up: boolean }) {
  const el = useRef<HTMLDivElement>(null), box = useRef<HTMLDivElement>(null)
  const [at, setAt] = useState<ReturnType<typeof place> | null>(null)
  const both = preview.options.length <= 2
  const shownOptions = both ? preview.options : [preview.options.find((o) => o.value === option) ?? preview.options.find((o) => o.value === preview.value) ?? preview.options[0]]
  useLayoutEffect(() => {
    // (in the top layer, so it shows over a sheet too: a modal dialog is above any z-index)
    if (el.current && !el.current.matches(":popover-open")) el.current.showPopover?.()
    if (row.current && box.current) setAt(place(row.current, box.current.offsetWidth, box.current.offsetHeight, up))
  }, [row, shownOptions.length, up])
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
  const origin = { right: "left center", below: "top left", above: "bottom left" }[at?.side ?? "below"]
  return createPortal(
    <div ref={el} popover="manual" aria-hidden data-setting-preview={row.current?.getAttribute("data-settings-row") ?? row.current?.getAttribute("data-setting") ?? ""} data-side={at?.side} data-cold={cold || undefined}
      onPointerEnter={keep} onPointerLeave={(e) => { if (e.pointerType === "mouse") later() }}
      className={cn("fixed inset-auto m-0 overflow-visible border-0 bg-transparent p-0 text-foreground", pad, !at && "invisible")} style={{ left: at?.left ?? 0, top: at?.top ?? 0 }}>
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
