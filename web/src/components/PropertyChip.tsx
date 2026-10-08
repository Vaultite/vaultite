// A property as a chip in a file's header (and status bar): one frontmatter key from a plugin's list of values, each
// with label, icon, colour; a click picks one as a one-key edit. A value the list doesn't have still shows as written.
import { useState, type MouseEvent } from "react"
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleDashed, CircleHelp, Plus, X, type LucideIcon } from "lucide-react"
import type { FileHead } from "@/core/define"
import { ICONS, namedIcon, tintOf } from "@/core/pages"
import { PLUGINS } from "@/core/plugins"
import { capitalize, cn } from "@/lib/utils"
import { menuAbove, menuBelow, type MenuItem } from "@/components/ContextMenu"

/** One of a chip's values, as its settings keep it: `icon` a name (`pen-line`:
 *  core/pages.ts ICONS, or a plugin's), `tint` a colour token (`green`: var(--green)). Only `value` is needed. */
export type ChipValue = { value: string; label?: string; icon?: string; tint?: string; hint?: string }

/** The colours a value can have: the app's colour tokens, which every colour scheme sets. */
export const CHIP_TINTS = ["gray", "red", "orange", "yellow", "green", "teal", "blue", "indigo", "purple", "pink"] as const

const clean = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" || typeof v === "boolean" ? String(v) : "")

/** A settings value as a list of ChipValues: words (`[draft, done]`) or records, the ones with no value left out. */
export function chipValues(raw: unknown): ChipValue[] {
  if (!Array.isArray(raw)) return []
  const out: ChipValue[] = []
  for (const x of raw) {
    const r: Record<string, unknown> = x && typeof x === "object" ? (x as Record<string, unknown>) : { value: x }
    const value = clean(r.value)
    if (!value || out.some((o) => same(o.value, value))) continue
    const v: ChipValue = { value }
    for (const k of ["label", "icon", "tint", "hint"] as const) { const s = clean(r[k]); if (s) v[k] = s }
    out.push(v)
  }
  return out
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()
/** A value's name: its label, else the value itself in sentence case. */
export const chipLabel = (v: ChipValue) => v.label || capitalize(v.value)

type Shown = { value: string | null; label: string; hint: string; icon: LucideIcon; color?: string }

/** What the file says, as one of `values`: null when it doesn't have the key, or the text it says when that's not one
 *  of them. */
function shownOf(fm: Record<string, unknown>, prop: string, values: ChipValue[]): Shown | null {
  const raw = fm[prop]
  if (raw === undefined || raw === null || raw === "") return null
  const text = Array.isArray(raw) ? raw.map(String).join(", ") : String(raw)
  const v = values.find((o) => same(o.value, text))
  if (!v) return { value: null, label: text, hint: "", icon: CircleHelp, color: "var(--muted-foreground)" }
  return { value: v.value, label: chipLabel(v), hint: v.hint ?? "", icon: namedIcon(v.icon) ?? CircleDashed, color: tintOf(v.tint) }
}

export type ChipProps = {
  file: FileHead
  /** The frontmatter key. */
  prop: string
  values: ChipValue[]
  /** Where it's drawn: the desktop path bar, the line above the title, the status bar. */
  place: "bar" | "line" | "status"
  /** What it is, in its tooltip and for screen readers: "Origin". */
  name?: string
  /** The last choice, which removes the key: "Unlabeled". */
  unset?: string
  /** The tooltip while the key isn't there: "Unlabeled: who wrote it?". */
  unsetTip?: string
  /** Drawn while the key isn't there (an icon-only chip in the header, the `unset` text in the status bar). */
  showUnset?: boolean
}

/** The choices: each value, then the one that removes the key. */
export function chipMenu({ file, prop, values, unset }: Pick<ChipProps, "file" | "prop" | "values" | "unset">): MenuItem[] {
  const cur = shownOf(file.fm, prop, values)
  const set = (v: string | undefined) => file.setProperty?.(prop, v)
  return [
    ...values.map((v) => ({ label: chipLabel(v), icon: namedIcon(v.icon) ?? CircleDashed, hint: v.hint, checked: cur?.value === v.value, run: () => set(v.value) })),
    { label: unset ?? "None", icon: CircleDashed, checked: !cur, sep: values.length > 0, run: () => set(undefined) },
  ]
}

/** The chip. Nothing for a file it can't change (read-only, the trash), or without the key unless `showUnset`. */
export function PropertyChip(p: ChipProps) {
  const { file, prop, values, place, showUnset = true } = p
  if (!file.setProperty) return null
  const o = shownOf(file.fm, prop, values)
  if (!o && !showUnset) return null
  const name = p.name ?? capitalize(prop)
  const unset = p.unset ?? "None"
  const Icon = o?.icon ?? CircleDashed
  const open = (e: MouseEvent) => (place === "status" ? menuAbove : menuBelow)(e, chipMenu(p))
  const tip = o ? `${o.hint || `${name}: ${o.label}`}\nClick to change` : `${p.unsetTip ?? `${name}: ${unset.toLowerCase()}`}\nClick to set it`
  const attrs = {
    type: "button" as const, onClick: open, onContextMenu: open, "aria-haspopup": "menu" as const,
    "aria-label": `${name}: ${o?.label ?? unset.toLowerCase()}. Change`, "data-tip": tip, "data-chip": prop,
    "data-value": o?.value ?? (o ? "other" : "none"),
  }
  if (place === "status") {
    return (
      <button {...attrs} data-tip-side="top" className="flex h-6 cursor-pointer items-center gap-1 rounded-[5px] px-1.5 hover:bg-foreground/[0.06] hover:text-foreground">
        <Icon className="size-3.5" strokeWidth={2.25} style={o ? { color: o.color } : undefined} />
        <span>{o?.label ?? unset}</span>
      </button>
    )
  }
  const bar = place === "bar"
  return (
    <button {...attrs}
      className={cn("flex shrink-0 cursor-pointer items-center gap-1 font-medium",
        bar ? "h-7 rounded-[5px] px-1.5 text-[12px] hover:bg-foreground/[0.06]"
          // (a phone's 44px target, laid out in the line's 32px)
          : "-my-1.5 h-11 px-1 text-[13px] active:opacity-50 md:h-8 md:my-0 md:rounded-[6px] md:px-1.5 md:hover:bg-foreground/[0.06]",
        o ? "" : "justify-center text-muted-foreground hover:text-foreground", !o && (bar ? "w-7 px-0" : "w-11 md:w-8"))}
      style={o ? { color: o.color } : undefined}>
      <Icon className={bar ? "size-3.5" : "size-4"} strokeWidth={2.25} />
      {o && <span>{o.label}</span>}
    </button>
  )
}

// ---------- editing the values (a plugin's settings sheet: no menus there, so choices unfold in place)

/** Every icon a value can name: the app's and the ones plugins add, by name. */
function iconChoices(): [string, LucideIcon][] {
  const seen = new Set<LucideIcon>(), out: [string, LucideIcon][] = []
  const all = [...Object.entries(ICONS), ...PLUGINS.flatMap((p) => Object.entries(p.icons ?? {}))]
  for (const [n, I] of all) if (!seen.has(I)) { seen.add(I); out.push([n, I]) }
  return out.sort((a, b) => a[0].localeCompare(b[0]))
}

const field = "h-8 min-w-0 rounded-[7px] border-[0.5px] border-border bg-background px-2 text-[16px] outline-none focus:border-primary md:h-7 md:text-[14px]"
const iconBtn = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-30 md:size-7"

/** A text saved on Enter or leaving it; Escape puts it back. */
/** A field that saves on blur; Enter saves too (its default stopped: the keypress after it would land on whatever takes
 *  the focus next, a list's row the keyboard goes back to, which Enter opens). */
function Text({ value, placeholder, label, set, className, check }: {
  value: string; placeholder?: string; label: string; set: (v: string) => void; className?: string; check?: (v: string) => string
}) {
  const [typed, setTyped] = useState<string | null>(null)
  const why = typed === null || !check ? "" : check(typed)
  return (
    <input value={typed ?? value} placeholder={placeholder} aria-label={label} spellCheck={false} aria-invalid={!!why || undefined}
      data-tip={why || undefined} onChange={(e) => setTyped(e.target.value)}
      onBlur={() => { if (typed !== null && !why && typed.trim() !== value) set(typed.trim()); setTyped(null) }}
      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur() } else if (e.key === "Escape") { e.stopPropagation(); setTyped(null) } }}
      className={cn(field, why && "border-[var(--red)]", className)} />
  )
}

/** A chip's values as rows to reorder, remove and unfold (colour, icon, line); `onChange` gets the whole list. Renaming
 *  a value doesn't change the files that have it. */
export function ChipValuesEditor({ values: saved, onChange: save, label = "Values" }: { values: ChipValue[]; onChange: (v: ChipValue[]) => void; label?: string }) {
  const [open, setOpen] = useState<number | null>(null)
  // The list as last edited here until the store brings the save back, so a quick second edit builds
  // on the first instead of undoing it. Dropped after a few seconds, so a save that never came back shows as it is.
  const [mine, setMine] = useState<{ list: ChipValue[]; at: number } | null>(null)
  const values = mine && Date.now() - mine.at < 5000 && JSON.stringify(mine.list) !== JSON.stringify(saved) ? mine.list : saved
  const onChange = (next: ChipValue[]) => { setMine({ list: next, at: Date.now() }); save(next) }
  const put = (i: number, v: Partial<ChipValue>) => {
    const next = values.map((x, j) => {
      if (j !== i) return x
      const merged: ChipValue = { ...x, ...v }
      for (const k of ["label", "icon", "tint", "hint"] as const) if (!merged[k]) delete merged[k]
      return merged
    })
    onChange(next)
  }
  const move = (i: number, by: number) => {
    const next = [...values]; const [x] = next.splice(i, 1); next.splice(i + by, 0, x); onChange(next)
    if (open === i) setOpen(i + by)
  }
  const add = () => {
    let n = values.length + 1, value = `value-${n}`
    while (values.some((v) => same(v.value, value))) value = `value-${++n}`
    onChange([...values, { value, label: `Value ${n}`, icon: "circle", tint: "gray" }])
    setOpen(values.length)
  }
  const taken = (i: number) => (s: string) => !s.trim() ? "A value can't be empty" : values.some((v, j) => j !== i && same(v.value, s)) ? "There's one already" : ""
  return (
    <div data-chip-values aria-label={label} role="group">
      {values.map((v, i) => {
        const Icon = namedIcon(v.icon) ?? CircleDashed
        const unfolded = open === i
        return (
          <div key={i} data-chip-value={v.value} className="border-b-[0.5px] border-border/70 py-1.5 last:border-b-0">
            <div className="flex items-center gap-1.5">
              <button type="button" onClick={() => setOpen(unfolded ? null : i)} aria-expanded={unfolded} aria-label={`${chipLabel(v)}: colour, icon and line`}
                className="flex shrink-0 cursor-pointer items-center gap-0.5 rounded-[6px] py-1 pr-0.5 pl-1 hover:bg-foreground/[0.06]">
                {unfolded ? <ChevronDown className="size-3.5 text-tertiary" strokeWidth={2.5} /> : <ChevronRight className="size-3.5 text-tertiary" strokeWidth={2.5} />}
                <Icon className="size-4" strokeWidth={2.25} style={{ color: tintOf(v.tint) ?? "var(--muted-foreground)" }} />
              </button>
              <Text value={v.label ?? ""} placeholder={capitalize(v.value)} label="Label" set={(s) => put(i, { label: s })} className="flex-1" />
              <Text value={v.value} label="Value written in the file" set={(s) => put(i, { value: s })} check={taken(i)} className="w-24 font-mono md:w-28 md:text-[13px]" />
              <button type="button" className={iconBtn} aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" strokeWidth={2.25} /></button>
              <button type="button" className={iconBtn} aria-label="Move down" disabled={i === values.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" strokeWidth={2.25} /></button>
              <button type="button" className={iconBtn} aria-label={`Remove ${chipLabel(v)}`} onClick={() => { onChange(values.filter((_, j) => j !== i)); setOpen(null) }}><X className="size-3.5" strokeWidth={2.25} /></button>
            </div>
            {unfolded && <ValueDetails v={v} put={(x) => put(i, x)} />}
          </div>
        )
      })}
      <button type="button" onClick={add} data-chip-add
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-[15px] text-primary md:min-h-9 md:text-[14px]">
        <Plus className="size-4" strokeWidth={2.25} /> Add a value
      </button>
    </div>
  )
}

function ValueDetails({ v, put }: { v: ChipValue; put: (x: Partial<ChipValue>) => void }) {
  return (
    <div className="space-y-2.5 pt-2 pb-1 pl-7">
      <Text value={v.hint ?? ""} placeholder="A line about it, in its tooltip and menu" label="Line" set={(s) => put({ hint: s })} className="w-full" />
      <div role="radiogroup" aria-label="Colour" className="flex flex-wrap gap-1.5">
        {CHIP_TINTS.map((t) => (
          <button key={t} type="button" role="radio" aria-checked={v.tint === t} aria-label={t} data-tip={capitalize(t)} onClick={() => put({ tint: t })}
            className={cn("size-6 cursor-pointer rounded-full ring-offset-2 ring-offset-background", v.tint === t && "ring-2 ring-foreground/60")}
            style={{ background: `var(--${t})` }} />
        ))}
      </div>
      <div role="radiogroup" aria-label="Icon" className="flex flex-wrap gap-0.5">
        {iconChoices().map(([n, I]) => {
          const on = namedIcon(v.icon) === I
          return (
            <button key={n} type="button" role="radio" aria-checked={on} aria-label={n} data-tip={n} onClick={() => put({ icon: n })}
              className={cn("grid size-8 cursor-pointer place-items-center rounded-[6px] hover:bg-foreground/[0.06] md:size-7", on ? "bg-foreground/[0.08] text-foreground" : "text-muted-foreground")}>
              <I className="size-4" strokeWidth={2} style={on ? { color: tintOf(v.tint) } : undefined} />
            </button>
          )
        })}
      </div>
    </div>
  )
}
