// The graph's settings panel (the Filter button), as Obsidian's: Filters and Groups open, Display and Forces folded.
// Every control is a setting in .vaultite/plugins/graph/data.json; leaving one at its default removes the key.
import { useEffect, useRef, useState, type ReactNode } from "react"
import { GripVertical, Plus, X, type LucideIcon } from "lucide-react"
import { capitalize, CHIP_TINTS, cn, Foldable, menuBelow, Segmented, SortableList, Switch, type MenuItem } from "@vaultite"
import { PALETTE, tokenOf, type ColorGroup } from "./graph"
import type { Save, Settings } from "./GraphView"

/** A colour's dot (a legend's, a menu's). */
export const Swatch = ({ tok, className }: { tok: string; className?: string }) => (
  <span className={cn("size-2.5 shrink-0 rounded-full", className)} style={{ background: `var(${tok})` }} aria-hidden />
)
const swatches = new Map<string, LucideIcon>()
/** A colour's dot as a menu row's icon. */
const swatchIcon = (tok: string) => {
  let I = swatches.get(tok)
  if (!I) swatches.set(tok, I = (({ className }: { className?: string }) => <span className={cn(className, "grid place-items-center")}><Swatch tok={tok} className="size-3" /></span>) as unknown as LucideIcon)
  return I
}
/** The theme's colours as menu rows, `now` checked. */
export const colourItems = (now: string | null, pick: (color: string) => void): MenuItem[] =>
  CHIP_TINTS.map((c) => ({ label: capitalize(c), icon: swatchIcon(tokenOf(c)), checked: c === now, run: () => pick(c) }))
/** A new group's colour: the first of the palette no group has. */
const nextColour = (groups: ColorGroup[]) => PALETTE.map((t) => t.slice(2)).find((c) => !groups.some((g) => g.color === c)) ?? "gray"

const rowCls = "flex min-h-8 items-center gap-3 rounded-[6px] px-1.5 text-[13px] max-md:min-h-11 max-md:text-[17px]"

/** A setting's switch on a row of its own. */
export function SwitchRow({ label, on, set }: { label: string; on: boolean; set: (on: boolean) => void }) {
  return (
    <div className={rowCls} data-graph-switch={label}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Switch on={on} onChange={set} label={label} />
    </div>
  )
}

export function Row({ label, children, className }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn(rowCls, className)}>
      {label && <span className="min-w-0 flex-1 truncate">{label}</span>}
      {children}
    </div>
  )
}

const iconBtn = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:size-10"
const field = "h-7 min-w-0 flex-1 rounded-[6px] border-[0.5px] border-border bg-background px-2 text-[13px] outline-none focus:border-primary max-md:h-10 max-md:text-[16px]"

/** A group's query, typed and saved on Enter or leaving the field (empty: the group goes). */
function QueryField({ value, set, auto }: { value: string; set: (q: string) => void; auto?: boolean }) {
  const [v, setV] = useState(value)
  useEffect(() => setV(value), [value])
  return (
    <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() !== value) set(v.trim()) }} autoFocus={auto}
      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setV(value); e.currentTarget.blur() } }}
      placeholder="tag:#work, type:person, folder:Notes…" aria-label="Group's search" spellCheck={false} autoComplete="off" className={field} data-graph-group-query />
  )
}

/** The user's groups: a search and a colour each, the first a file is in colouring it; drag to reorder. */
function Groups({ groups, found, counts, setGroups }: GroupProps) {
  const [adding, setAdding] = useState(false)
  const at = (id: string) => Number(id)
  const change = (i: number, g: Partial<ColorGroup>) => setGroups(groups.map((x, j) => (j === i ? { ...x, ...g } : x)))
  return (
    <>
      <SortableList ids={groups.map((_, i) => String(i))} onMove={(a, b) => {
        const next = [...groups]
        next.splice(at(b), 0, ...next.splice(at(a), 1))
        setGroups(next)
      }}>
        {(id) => {
          const i = at(id), g = groups[i]
          return (
            <div className="flex flex-col px-0.5 py-0.5" data-graph-group-row={i}>
              <div className="flex items-center gap-1">
                <GripVertical className="size-3.5 shrink-0 cursor-grab text-tertiary" strokeWidth={2} aria-hidden />
                <button type="button" className={iconBtn} aria-label={`Colour: ${g.color}`} data-tip="Colour"
                  onClick={(e) => menuBelow(e, colourItems(g.color, (c) => change(i, { color: c })))}><Swatch tok={tokenOf(g.color)} className="size-3.5" /></button>
                <QueryField value={g.query} set={(q) => (q ? change(i, { query: q }) : setGroups(groups.filter((_, j) => j !== i)))} />
                <span className="w-7 shrink-0 text-right text-[12px] text-tertiary tabular-nums">{counts[i] ?? ""}</span>
                <button type="button" className={iconBtn} aria-label="Remove group" data-tip="Remove" onClick={() => setGroups(groups.filter((_, j) => j !== i))}>
                  <X className="size-3.5" strokeWidth={2.25} /></button>
              </div>
              {found[i]?.error && <p className="pl-12 text-[12px] text-muted-foreground">{found[i].error}</p>}
            </div>
          )
        }}
      </SortableList>
      {adding && (
        <div className="flex items-center gap-1 px-0.5 py-0.5">
          <span className="w-3.5" />
          <span className={cn(iconBtn, "cursor-default")}><Swatch tok={tokenOf(nextColour(groups))} className="size-3.5" /></span>
          <QueryField value="" auto set={(q) => { setAdding(false); if (q) setGroups([...groups, { query: q, color: nextColour(groups) }]) }} />
        </div>
      )}
      <button type="button" onClick={() => setAdding(true)} data-graph-add-group
        className="flex h-7 cursor-pointer items-center gap-1.5 self-start rounded-[6px] px-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:h-11 max-md:text-[17px]">
        <Plus className="size-3.5" strokeWidth={2.25} />New group
      </button>
    </>
  )
}

/** A number setting as a slider: shown while dragged (`tryIt`), saved when let go; its default saves nothing. */
function SliderRow({ label, k, min, max, step, dflt, settings, save, tryIt }: {
  label: string; k: keyof Settings; min: number; max: number; step: number; dflt: number; settings: Settings; save: Save; tryIt: (p: Partial<Settings>) => void
}) {
  const raw = settings[k]
  const v = typeof raw === "number" && Number.isFinite(raw) ? raw : dflt
  const moved = useRef(false)
  const commit = (e: { currentTarget: HTMLInputElement }) => {
    if (!moved.current) return
    moved.current = false
    const n = Number(e.currentTarget.value)
    save({ [k]: Math.abs(n - dflt) < step / 2 ? null : n })
  }
  return (
    <label className={cn(rowCls, "max-md:gap-2")} data-graph-slider={k}>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <input type="range" min={min} max={max} step={step} value={v} aria-label={label}
        onChange={(e) => { moved.current = true; tryIt({ [k]: Number(e.currentTarget.value) }) }} onPointerUp={commit} onKeyUp={commit} onBlur={commit}
        className="h-5 w-[118px] shrink-0 cursor-pointer accent-[var(--primary)] max-md:h-11 max-md:w-[45%]" />
    </label>
  )
}

/** Puts a section's settings back to their defaults; there only when one isn't. */
function ResetRow({ keys, settings, save }: { keys: (keyof Settings)[]; settings: Settings; save: Save }) {
  if (!keys.some((k) => settings[k] !== undefined)) return null
  return (
    <button type="button" onClick={() => save(Object.fromEntries(keys.map((k) => [k, null])))} data-graph-reset
      className="flex h-7 cursor-pointer items-center self-start rounded-[6px] px-1.5 text-[13px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground max-md:h-11 max-md:text-[17px]">
      Reset to defaults
    </button>
  )
}

const DISPLAY: (keyof Settings)[] = ["arrows", "textFade", "nodeSize", "lineWidth"]
const FORCES: (keyof Settings)[] = ["center", "repel", "linkDistance"]

type GroupProps = { groups: ColorGroup[]; found: { error?: string }[]; counts: number[]; setGroups: (g: ColorGroup[]) => void }

/** The panel: `local` for a file's local graph (depth instead of the whole graph's switches). */
export function GraphPanel({ settings, save, try: tryIt, tried, local, ...groups }: { settings: Settings; save: Save; try: (p: Partial<Settings>) => void; tried: () => void; local: boolean } & GroupProps) {
  const slider = { settings, tryIt, save: (p: Partial<Record<keyof Settings, unknown>>) => { save(p); tried() } }
  const depth = settings.depth ?? 1
  // (a default is saved as null: the key goes, so the vault holds only what was changed)
  const flag = (k: keyof Settings, dflt: boolean) => ({ on: (settings[k] as boolean | undefined) ?? dflt, set: (v: boolean) => save({ [k]: v === dflt ? null : v }) })
  return (
    <div className="glass pointer-events-auto flex max-h-full w-[290px] flex-col overflow-y-auto overscroll-contain rounded-[12px] p-1.5 max-md:w-full" data-graph-panel>
      <Foldable title="Filters" keep="graph.filters" data-graph-section="filters">
        {local ? (
          <Row label="Depth">
            <Segmented label="Depth" value={String(depth)} className="shrink-0 [&>button]:px-2.5" onChange={(v) => save({ depth: v === "1" ? null : Number(v) })}
              options={[1, 2, 3, 4, 5].map((d) => ({ value: String(d), label: String(d) }))} />
          </Row>
        ) : null}
        {local && <SwitchRow label="Incoming links" {...flag("incoming", true)} />}
        {local && <SwitchRow label="Outgoing links" {...flag("outgoing", true)} />}
        {local && <SwitchRow label="Neighbor links" {...flag("neighbors", true)} />}
        <SwitchRow label="Tags" {...flag("tags", false)} />
        <SwitchRow label="Attachments" {...flag("attachments", true)} />
        {!local && <SwitchRow label="Files with no links" {...flag("orphans", true)} />}
        {!local && <SwitchRow label="Archived files" {...flag("archived", false)} />}
      </Foldable>
      <Foldable title="Groups" keep="graph.groups" data-graph-section="groups">
        <Row label="Colour by">
          <Segmented label="Colour by" value={settings.colorBy ?? "folder"} className="shrink-0 [&>button]:px-2.5" onChange={(v) => save({ colorBy: v === "folder" ? null : v })}
            options={[{ value: "folder", label: "Folder" }, { value: "type", label: "Type" }, { value: "none", label: "None" }]} />
        </Row>
        <Groups {...groups} />
      </Foldable>
      <Foldable title="Display" keep="graph.display" dflt={false} data-graph-section="display">
        <SwitchRow label="Arrows" {...flag("arrows", false)} />
        <SliderRow label="Text fade threshold" k="textFade" min={-3} max={3} step={0.1} dflt={0} {...slider} />
        <SliderRow label="Node size" k="nodeSize" min={0.25} max={3} step={0.05} dflt={1} {...slider} />
        <SliderRow label="Line thickness" k="lineWidth" min={0.25} max={4} step={0.05} dflt={1} {...slider} />
        <ResetRow keys={DISPLAY} settings={settings} save={save} />
      </Foldable>
      <Foldable title="Forces" keep="graph.forces" dflt={false} data-graph-section="forces">
        <SliderRow label="Center force" k="center" min={0} max={4} step={0.05} dflt={1} {...slider} />
        <SliderRow label="Repel force" k="repel" min={0} max={4} step={0.05} dflt={1} {...slider} />
        <SliderRow label="Link distance" k="linkDistance" min={0.25} max={4} step={0.05} dflt={1} {...slider} />
        <ResetRow keys={FORCES} settings={settings} save={save} />
      </Foldable>
    </div>
  )
}
