// A dashboard edited as it's read: the editor hands each run of its blocks here (PageView.editGrid), laid out as the
// grid it reads as. Each card has its bar (drag, options, wide, stacked, source, remove); a card at the end adds one.
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { GripVertical, Plus, RectangleHorizontal, Rows2, Trash2 } from "lucide-react"
import { narrow } from "./Dashboard"
import { BlockView, capitalize, chooseBlock, cn, edgeScroller, notify, startDrag, useDrag, useDropHit, useDropTarget, type GridCard, type GridEdit, type PageCtx } from "@vaultite"

/** A run's blocks in cells: one, and those stacked under it. */
function cellsOf(cards: { stack: boolean }[]): number[][] {
  const cells: number[][] = []
  cards.forEach((c, k) => { if (c.stack && cells.length) cells[cells.length - 1].push(k); else cells.push([k]) })
  return cells
}

/** The card being dragged (one drag at a time, from any run of its page: `editor`, the page's editor). */
let moving: { edit: GridEdit; k: number; editor: Element | null } | null = null
/** A block just added that has options to fill in: its card opens its source. */
let opening: string | null = null
/** The pane scrolling while a card is held near its edge: one for every run of the page. */
let edge: ReturnType<typeof edgeScroller> | null = null
/** Where a drop goes: before or after the cell of block k, beside it (`across`) or above or below it; `add`: after the
 *  run's last cell, held over its Add card. */
type Hit = { k: number; after: boolean; across: boolean; add?: boolean }

/** The cell of `grid` nearest (x, y). */
function nearest(grid: HTMLElement, x: number, y: number) {
  let best: HTMLElement | null = null, least = Infinity
  for (const c of grid.querySelectorAll<HTMLElement>("[data-cell]")) {
    const r = c.getBoundingClientRect(), d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
    if (d < least) { least = d; best = c }
  }
  return best
}

export function EditGrid({ cards, edit, ctx }: { cards: GridCard[]; edit: GridEdit; ctx: PageCtx }) {
  const cells = useMemo(() => cellsOf(cards), [cards])
  const root = useRef<HTMLDivElement>(null)
  const id = `dashboard-grid:${useId()}`
  // A card held over another cell goes before or after it: beside it in two columns, above or below in one.
  useDropTarget<Hit>(id, (item, x, y, el) => {
    if (item.from !== "block" || !moving || !root.current || moving.editor !== root.current.closest(".cm-editor")) return null
    ;(edge ??= edgeScroller()).over(root.current, x, y)
    // Over the gap between cells (where the line is drawn), the nearest cell.
    const at = el?.closest<HTMLElement>("[data-cell], [data-add-block]") ?? (el && root.current.contains(el) ? nearest(root.current, x, y) : null)
    if (!at || !root.current.contains(at)) return null
    if (at.dataset.addBlock !== undefined) return { k: cards.length - 1, after: true, across: false, add: true }
    const r = at.getBoundingClientRect(), across = r.width < root.current.getBoundingClientRect().width * 0.75
    const k = Number(at.dataset.cell), after = across ? x > r.left + r.width / 2 : y > r.top + r.height / 2
    // (where it already is: its own cell, or (one with what's stacked under it) beside the cells next to it)
    if (moving.edit === edit) {
      const c = cells.findIndex((x) => x[0] === k), own = cells.findIndex((x) => x.includes(moving!.k))
      if (c === own || (cells[own][0] === moving.k && c === own + (after ? -1 : 1))) return null
    }
    return { k, after, across }
  }, (_, hit) => { if (moving) moving.edit.move(moving.k, edit, Math.max(0, hit.k), hit.after) }, { end: () => edge?.stop() })
  const hit = useDropHit<Hit>(id), lifting = useDrag((d) => !!d?.item.block)
  const writable = edit.writable
  // Cards whose source shows, by key (one moved into another cell keeps it).
  const [sources, setSources] = useState<ReadonlySet<string>>(new Set())
  const showSource = useCallback((key: string, on: boolean) => setSources((was) => {
    if (was.has(key) === on) return was
    const next = new Set(was)
    if (on) next.add(key); else next.delete(key)
    return next
  }), [])
  // Each card by its block and which of that block it is in the run, so a card moved or changed keeps its state.
  const keys = useMemo(() => {
    const seen = new Map<string, number>()
    return cards.map((c) => { const n = seen.get(c.name) ?? 0; seen.set(c.name, n + 1); return `${c.name}:${n}` })
  }, [cards])
  const two = !narrow(ctx.body, ctx.disabled)
  return (
    // Two columns when its pane is wide enough, as the page is read (Dashboard.tsx).
    <div ref={root} className="@container" data-dashboard-grid>
      <div className={cn("grid grid-cols-1 gap-4", two && "@2xl:grid-cols-2")}>
        {cells.map((cell) => {
          const lead = cell[0], line = hit && !hit.add && cell.includes(hit.k) ? hit : null
          return (
            <div key={keys[lead]} data-cell={lead} className={cn("relative grid min-w-0 grid-cols-1 gap-4", cell.length > 1 && "content-start", cards[lead].wide && "@2xl:col-span-2")}>
              {cell.map((k) => <Card key={keys[k]} id={keys[k]} k={k} card={cards[k]} edit={edit} ctx={ctx} writable={writable} first={k === 0}
                source={sources.has(keys[k])} showSource={showSource} dragged={lifting && moving?.edit === edit && moving.k === k} />)}
              {line && <span aria-hidden className={cn("pointer-events-none absolute rounded-full bg-primary",
                line.across ? cn("inset-y-0 w-[3px]", line.after ? "-right-[9.5px]" : "-left-[9.5px]") : cn("inset-x-0 h-[3px]", line.after ? "-bottom-[9.5px]" : "-top-[9.5px]"))} />}
            </div>
          )
        })}
        {writable && <AddCard edit={edit} ctx={ctx} only={two && !cards.length} over={!!hit?.add} />}
      </div>
    </div>
  )
}

/** A block, drawn as it's read, with its bar on hover (a phone's always): what BlockView adds to it (its name, Options,
 *  its menu) between the grip and the card's own buttons. */
const Card = memo(function Card({ id, k, card, edit, ctx, writable, first, source, showSource, dragged }: { id: string; k: number; card: GridCard; edit: GridEdit
  ctx: PageCtx; writable: boolean; first: boolean; source: boolean; showSource: (id: string, on: boolean) => void; dragged: boolean }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null)
  const setSource = useCallback((on: boolean) => showSource(id, on), [showSource, id])
  const block = useMemo(() => (slot ? edit.block(k, slot, () => setSource(true)) : null), [slot, edit, k, setSource])
  useEffect(() => { if (opening === card.name) { opening = null; setSource(true) } }, [card.name, setSource])
  const label = capitalize(card.name.replace(/^```/, "").replace(/-/g, " "))
  const btn = "cm-block-btn"
  return (
    <div data-card={card.name} className={cn("cm-card relative grid min-w-0 grid-cols-1", dragged && "opacity-40")}>
      <div className="cm-block-bar" data-no-edit>
        {writable && (
          // (a finger holds it to pick it up: the hold is its own, not the editor's, and opens no menu)
          <button type="button" className={cn(btn, "cm-card-grip cursor-grab touch-none")} data-tip="Drag to move" aria-label="Move" data-hold-menu
            onPointerDown={(e) => { moving = { edit, k, editor: e.currentTarget.closest(".cm-editor") }; startDrag(e, { from: "block", block: card.name, label }, { touch: true }) }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation() }}>
            <GripVertical className="size-4" strokeWidth={2.25} />
          </button>
        )}
        <div ref={setSlot} className="cm-block-slot" />
        {writable && (
          <>
            <button type="button" className={cn(btn, "is-wide-only")} aria-pressed={card.wide} data-tip={card.wide ? "Half width" : "Full width"} aria-label="Full width"
              onClick={() => edit.set(k, "wide", card.wide ? undefined : true)}>
              <RectangleHorizontal className="size-4" strokeWidth={2.25} />
            </button>
            {!first && (
              <button type="button" className={cn(btn, "is-wide-only")} aria-pressed={card.stack} data-tip={card.stack ? "Beside the one before" : "Under the one before"} aria-label="Stacked"
                onClick={() => edit.set(k, "stack", card.stack ? undefined : true)}>
                <Rows2 className="size-4" strokeWidth={2.25} />
              </button>
            )}
            <button type="button" className={cn(btn, "cm-block-source")} aria-pressed={source} data-tip="Edit source" aria-label="Edit source" onClick={() => setSource(!source)} />
            <button type="button" className={btn} data-tip="Remove" aria-label="Remove"
              onClick={() => { edit.remove(k); notify(`Removed the ${label.toLowerCase()} block`, { action: { label: "Undo", run: () => edit.history() } }) }}>
              <Trash2 className="size-4" strokeWidth={2.25} />
            </button>
          </>
        )}
      </div>
      {source && block && <Source name={card.name} text={card.text} edit={edit} set={block.setText} close={() => setSource(false)} />}
      {block && <BlockView name={card.name} text={card.text} ctx={ctx} disabled={ctx.disabled} editing edit={block} />}
    </div>
  )
})

/** A block's text as its fence has it (its options; a ```tasks fence's query), edited in its card: each change is the
 *  file's (its undo too). */
function Source({ name, text, edit, set, close }: { name: string; text: string; edit: GridEdit; set: ((t: string, typed?: boolean) => void) | null; close: () => void }) {
  const [v, setV] = useState(text)
  const fence = name.startsWith("```")
  // (what the file has now, unless it's what's typed: a trailing new line isn't written until something follows it)
  useEffect(() => setV((was) => (was.replace(/\s+$/, "") === text ? was : text)), [text])
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => { const t = ref.current; if (t) { t.focus(); t.setSelectionRange(t.value.length, t.value.length) } }, [])
  return (
    <div className="cm-card-source" data-no-edit>
      <div className="font-mono text-[12px] text-muted-foreground">{fence ? name : `\`\`\`block-${name}`}</div>
      <textarea ref={ref} value={v} rows={Math.max(1, v.split("\n").length)} spellCheck={false} readOnly={!set} aria-label={fence ? `The ${name.slice(3)} fence's text` : `The ${name} block's options`}
        onChange={(e) => { setV(e.target.value); set?.(e.target.value, true) }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") { e.preventDefault(); e.stopPropagation(); edit.history(e.shiftKey) }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close() }
          else if (!e.metaKey && !e.ctrlKey) e.stopPropagation()
        }}
        className="block w-full resize-none bg-transparent font-mono text-[15px] leading-[22px] outline-none placeholder:text-muted-foreground md:text-[13px] md:leading-[20px]" placeholder={fence ? undefined : "Its options, as YAML"} />
      <div className="flex items-baseline gap-3">
        <span className="flex-1 font-mono text-[12px] text-muted-foreground">```</span>
        <button type="button" className="cursor-pointer text-[13px] font-semibold text-primary" onClick={close}>Done</button>
      </div>
    </div>
  )
}

/** The run's last card: a block picked from the list goes after the run (an empty run's: at the page's end). */
function AddCard({ edit, ctx, only, over }: { edit: GridEdit; ctx: PageCtx; only: boolean; over: boolean }) {
  return (
    <button type="button" data-add-block onClick={() => chooseBlock(ctx.store, (fence) => {
      // (one written with options to fill in opens its source: "```block-<name>\n<option>: ")
      if (/\n[^`\n]/.test(fence)) opening = fence.slice("```block-".length, fence.indexOf("\n"))
      edit.add(fence)
    })}
      className={cn("flex min-h-11 cursor-pointer items-center justify-center gap-1.5 rounded-[12px] border border-dashed text-[15px] text-muted-foreground hover:bg-foreground/[0.03] hover:text-foreground",
        over ? "border-primary text-foreground" : "border-border", only ? "@2xl:col-span-2" : "")}>
      <Plus className="size-4" strokeWidth={2.25} />Add a block
    </button>
  )
}
