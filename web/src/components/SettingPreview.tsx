import { createContext, useId, useState, type ReactNode, type RefObject } from "react"
import { Check, Info } from "lucide-react"
import { haptic } from "@/core/haptics"
import { CARD_GAP as AWAY, useHoverCard, type HoverShown, type PlaceCard } from "@/core/hovercard"
import { cn } from "@/lib/utils"
import { Picture } from "@/components/PreviewCard"
import { HoverCard } from "@/components/HoverCard"

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

export function choicePreview<T extends string>(p: { text: string; value: T; set: (v: T) => void; options: { value: T; label: string; picture: ReactNode }[] }): Preview {
  return { text: p.text, value: p.value, options: p.options, set: (v) => { const o = p.options.find((x) => x.value === v); if (o) p.set(o.value) } }
}

/** A switch's preview: Off and On. */
export function switchPreview(text: string, [off, on]: [ReactNode, ReactNode], value: boolean, set: (on: boolean) => unknown): Preview {
  return { text, value: value ? "on" : "off", set: (v) => set(v === "on"), options: [{ value: "off", label: "Off", picture: off }, { value: "on", label: "On", picture: on }] }
}

export const Described = createContext<string | undefined>(undefined)

export function usePreview(preview: Preview | undefined, row: RefObject<HTMLElement | null>, { said }: { said?: boolean } = {}) {
  const id = useId()
  const { shown, props } = useHoverCard(row, { off: !preview, part: optionAt, pressable: true })
  const [inline, setInline] = useState(false)
  if (!preview) return null
  return {
    desc: `${id}-what`,
    props: { "data-has-preview": "", ...props },
    card: shown && <Card preview={preview} row={row} shown={shown} />,
    button: <InlineButton on={inline} toggle={() => setInline(!inline)} />,
    inline: inline && <Inline preview={preview} said={said} />,
  }
}

const optionAt = (t: EventTarget | null) => (t instanceof Element && t.closest("[data-option]")?.getAttribute("data-option")) || null

const PIC_W = 148, PIC_H = 93, GAP = 12

function anchorOf(row: HTMLElement, option: string | null) {
  return (option && row.querySelector<HTMLElement>(`[data-option="${CSS.escape(option)}"]`)) || row.querySelector<HTMLElement>("[role=switch], [role=radiogroup]") || row
}

const place: PlaceCard = (row, w, h, { part, preferAbove: up }) => {
  const anchor = anchorOf(row, part)
  const r = row.getBoundingClientRect(), a = anchor.getBoundingClientRect()
  const pane = row.closest("[data-pane]")?.getBoundingClientRect()
  const b = { left: Math.max(8, pane?.left ?? 0), right: Math.min(innerWidth - 8, pane?.right ?? innerWidth), top: Math.max(8, pane?.top ?? 0), bottom: Math.min(innerHeight - 8, pane?.bottom ?? innerHeight) }
  const column = row.closest("[data-setting-group]")?.getBoundingClientRect() ?? r
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2
  if (b.right - column.right - AWAY >= w + 8) {
    const top = Math.min(Math.max(b.top, ay - h / 2), b.bottom - h)
    return { side: "right", left: column.right, top, growFromX: 0, growFromY: ay - top }
  }
  const left = Math.max(b.left, Math.min(a.right + 10 - w, b.right - w))
  const fitsAbove = r.top - h - AWAY >= b.top, fitsBelow = r.bottom + h + AWAY <= b.bottom
  const x = Math.min(Math.max(ax - left, 0), w)
  return (up ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove)
    ? { side: "above", left, top: r.top - h - AWAY, growFromX: x, growFromY: h }
    : { side: "below", left, top: r.bottom, growFromX: x, growFromY: 0 }
}

function Card({ preview, row, shown }: { preview: Preview; row: RefObject<HTMLElement | null>; shown: HoverShown }) {
  const both = preview.options.length <= 2
  const shownOptions = both ? preview.options : [preview.options.find((o) => o.value === shown.part) ?? preview.options.find((o) => o.value === preview.value) ?? preview.options[0]]
  const current = shownOptions.findIndex((o) => o.value === preview.value)
  return (
    <HoverCard shown={shown} anchor={row} place={place} again={shownOptions.length}
      data-setting-preview={row.current?.getAttribute("data-settings-row") ?? row.current?.getAttribute("data-setting") ?? ""}>
      <div className="relative flex gap-3">
        {current >= 0 && <span aria-hidden data-preview-ring className={cn("pointer-events-none absolute -top-[3px] -left-[3px] rounded-[10px] border-2 border-primary", both && "transition-transform duration-[var(--motion-spring)] ease-[var(--spring)]")}
          style={{ width: PIC_W + 6, height: PIC_H + 6, transform: `translateX(${current * (PIC_W + GAP)}px)` }} />}
        {shownOptions.map((o) => {
          const on = o.value === preview.value
          return (
            <button key={o.value} type="button" tabIndex={-1} data-preview-pick={o.value} data-current={on || undefined} onMouseDown={(e) => e.preventDefault()}
              onClick={() => { if (!on) { haptic("selection"); void preview.set(o.value) } }}
              className={cn("group/pp flex flex-col items-center gap-1.5", on ? "cursor-default" : "cursor-pointer")}>
              <Picture width={PIC_W} height={PIC_H} className={cn("transition-shadow", !on && "group-hover/pp:shadow-[0_0_0_2.5px_var(--border)]")}>{o.picture}</Picture>
              <Name label={o.label} on={on} />
            </button>
          )
        })}
      </div>
    </HoverCard>
  )
}

const Name = ({ label, on, big }: { label: string; on: boolean; big?: boolean }) => (
  <span className={cn("flex max-w-full items-center gap-1 text-[12px] leading-[16px]", big && "max-md:text-[13px] max-md:leading-[18px]", on ? "font-semibold" : "text-muted-foreground")}>
    <span className="truncate">{label}</span>{on && <Check aria-hidden className="size-3 shrink-0 text-primary" strokeWidth={3} />}
  </span>
)

function InlineButton({ on, toggle }: { on: boolean; toggle: () => void }) {
  return (
    <button type="button" aria-expanded={on} aria-label="Show what it changes" data-preview-button onClick={toggle}
      className={cn("relative ml-1.5 inline-grid size-5 cursor-pointer place-items-center align-[-4px] [@media(hover:hover)]:hidden",
        "after:absolute after:-inset-3 after:content-['']", on ? "text-primary" : "text-tertiary")}>
      <Info className="size-[17px]" strokeWidth={2} />
    </button>
  )
}

function Inline({ preview, said }: { preview: Preview; said?: boolean }) {
  return (
    <div data-preview-inline className="basis-full pb-1.5">
      <div role="radiogroup" aria-label={preview.text} className="grid gap-3" style={{ gridTemplateColumns: `repeat(${preview.options.length}, minmax(0, 1fr))` }}>
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
