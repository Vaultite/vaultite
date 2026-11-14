import { Fragment, memo, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { X, type LucideIcon } from "lucide-react"
import { dropLeaving, fadeAway } from "@/core/animation"
import { keyCaps } from "@/core/commands"
import { isMac } from "@/core/platform"
import { useHeldFocus } from "@/core/focus"
import { useNearEnd } from "@/core/near"
import { dismissKeyboardOnDrag, usePageLock } from "@/core/pagelock"
import { cn } from "@/lib/utils"
import { usePalettePreview } from "@/components/PalettePreview"

export type Pick = { mod: boolean; shift: boolean }
export type RowAction = { label: string; icon: LucideIcon; on: boolean; run: () => void }
const ROWS = 30, NEAR = "400px"

const KEEP_MS = 2 * 60_000
let left: { text: string; at: number; open: boolean } | null = null
export function useFinderQuery() {
  const [first] = useState(() => {
    if (left?.open) return { text: left.text, select: false }
    return left && Date.now() - left.at < KEEP_MS ? { text: left.text, select: true } : { text: "", select: false }
  })
  const [query, setQuery] = useState(first.text)
  const picked = useRef(false)
  useEffect(() => { left = query.trim() ? { text: query, at: Date.now(), open: true } : null }, [query])
  useEffect(() => () => { if (picked.current) left = null; else if (left) left = { ...left, at: Date.now(), open: false } }, [])
  return { query, setQuery, select: first.select, picked: () => { picked.current = true } }
}

export function marked(text: string, marks: number[]): ReactNode {
  if (!marks.length) return text
  const on = new Set(marks)
  const runs: [string, boolean][] = []
  for (let i = 0; i < text.length; i++) {
    const m = on.has(i), last = runs[runs.length - 1]
    if (last && last[1] === m) last[0] += text[i]
    else runs.push([text[i], m])
  }
  return <>{runs.map(([t, m], i) => (m ? <mark key={i} className="bg-transparent font-semibold text-primary">{t}</mark> : t))}</>
}

export function Keys({ keys, small = false }: { keys: string; small?: boolean }) {
  return (
    <span className={cn("hidden shrink-0 md:flex", small ? "gap-0.5" : "gap-1")}>
      {keyCaps(keys).map((k, i) => (
        <kbd key={i} className={cn("grid place-items-center border-[0.5px] border-border bg-foreground/[0.06] font-keys leading-none text-muted-foreground",
          small ? "h-[18px] min-w-[18px] rounded-[4px] px-1 text-[11px]" : "h-[22px] min-w-[22px] rounded-[5px] px-1.5 text-[12px]")}>{k}</kbd>
      ))}
    </span>
  )
}

export function NoMatches({ what, query, then }: { what: string; query: string; then?: string }) {
  return (
    <p className="px-3 py-6 text-center text-[15px] text-muted-foreground" data-no-matches>
      {what} “{query.trim()}”{then && <><br />{then}</>}
    </p>
  )
}

type Pointer = { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }
type RowProps = {
  id: string; item: unknown; i: number; selected: boolean; look: unknown; draw: (selected: boolean) => ReactNode
  act?: RowAction | null; onHover: (i: number) => void; onPick: (i: number, e: Pointer) => void
}
const PaletteRow = memo(function PaletteRow({ id, i, selected, draw, act, onHover, onPick }: RowProps) {
  const row = (
    <button id={`palette-${id}`} data-i={i} type="button" role="option" aria-selected={selected} tabIndex={-1}
      onMouseMove={() => onHover(i)} onClick={(e) => onPick(i, e)}
      className={cn("flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2 text-left max-md:py-[9px] [contain-intrinsic-size:auto_37px] [content-visibility:auto]", selected && "bg-foreground/[0.07]", act && "pr-11")}>
      {draw(selected)}
    </button>
  )
  if (!act) return row
  if (!act.on && !selected && !COARSE) return <div className="relative" onMouseMove={() => onHover(i)}>{row}</div>
  return (
    <div className="relative" onMouseMove={() => onHover(i)}>
      {row}
      <button type="button" tabIndex={-1} aria-label={act.label} aria-pressed={act.on} data-tip={act.label} data-row-action
        onMouseDown={(e) => e.preventDefault()} onClick={act.run}
        className={cn("absolute top-1/2 right-2 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground",
          !act.on && !selected && "opacity-60")}>
        <act.icon className="size-3.5" strokeWidth={2.25} fill={act.on ? "currentColor" : "none"} />
      </button>
    </div>
  )
}, (a, b) => a.id === b.id && a.i === b.i && a.selected === b.selected && a.look === b.look && a.item === b.item && a.act?.on === b.act?.on)

const Hints = memo(function Hints({ hints }: { hints: [string, string][] }) {
  return (
    <div className="hidden flex-wrap items-center gap-x-3 gap-y-1.5 border-t-[0.5px] border-border px-5 py-2.5 text-[12px] text-muted-foreground md:flex [@media(pointer:coarse)_and_(max-height:500px)]:hidden">
      {hints.map(([k, what]) => (
        <span key={k} className="flex items-center gap-1 whitespace-nowrap"><Keys keys={k} small />{what}</span>
      ))}
    </div>
  )
}, (a, b) => a.hints.join("\n") === b.hints.join("\n"))

const Clear = memo(function Clear({ onClear }: { onClear: () => void }) {
  return (
    <button type="button" aria-label="Clear" onClick={onClear}
      className="group relative grid size-7 shrink-0 cursor-pointer place-items-center rounded-full after:absolute after:-inset-2">
      <span className="grid size-7 place-items-center rounded-full bg-muted-foreground text-card group-hover:bg-foreground/80 md:size-[16px] md:bg-muted-foreground/70">
        <X className="size-4 md:size-[10px]" strokeWidth={3} />
      </span>
    </button>
  )
})

const COARSE = matchMedia("(pointer: coarse)").matches
const actOf = <T,>(action: ((item: T) => RowAction | null) | undefined, item: T) => (action ? action(item) : null)

export function Palette<T extends { id: string }>({ label, placeholder, query, setQuery, select = false, items, row, action, onPick, onClose, hints, heading, section, empty, start = 0, onEnd, onSelect, preview, look, complete, onKey: ownKey }: {
  label: string; placeholder: string
  query: string; setQuery: (q: string, how?: { deleting: boolean }) => void
  complete?: string | null
  onKey?: (e: KeyboardEvent) => boolean
  select?: boolean
  items: T[]
  row: (item: T, selected: boolean) => ReactNode
  action?: (item: T) => RowAction | null
  onPick: (item: T | null, how: Pick) => void
  onSelect?: (item: T | null) => void
  preview?: (item: T) => ReactNode | null
  onClose: () => void
  hints: [string, string][]
  heading?: string
  section?: (item: T) => string | undefined
  empty?: ReactNode
  start?: number
  onEnd?: () => void
  look?: unknown
}) {
  const [sel, setSel] = useState(query ? 0 : start)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [composing, setComposing] = useState(false)
  const suffix = complete && !composing && query && !/\s/.test(query) && complete.length > query.length && complete.toLowerCase().startsWith(query.toLowerCase())
    ? complete.slice(query.length) : ""
  useLayoutEffect(() => {
    const f = input.current
    if (suffix && f && document.activeElement === f) f.setSelectionRange(query.length, query.length + suffix.length, "forward")
  }, [query, suffix])
  useLayoutEffect(() => {
    const f = input.current
    f?.focus({ preventScroll: true })
    f?.setSelectionRange(select ? 0 : f.value.length, f.value.length)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps -- focuses once, on open
  useEffect(() => (list.current ? dismissKeyboardOnDrag(list.current) : undefined), [])
  const [selFor, setSelFor] = useState(query)
  if (selFor !== query) { setSelFor(query); setSel(query ? 0 : start) }
  else if (sel > 0 && sel >= items.length) setSel(Math.max(0, items.length - 1))
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }) }, [sel])
  const selected = items[sel] ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps -- fires when the selected row changes, by id
  useEffect(() => onSelect?.(selected), [selected?.id])
  const aside = usePalettePreview(preview, selected, query)
  const [limit, setLimit] = useState(ROWS)
  const [limitFor, setLimitFor] = useState(query)
  if (limitFor !== query) { setLimitFor(query); setLimit(ROWS) }
  const drawn = Math.min(items.length, Math.max(limit, sel + ROWS / 3))
  const marks = `${drawn}/${items.length}`
  const more = useRef<HTMLDivElement>(null)
  useNearEnd(more, () => setLimit(drawn + ROWS), marks, NEAR)
  const end = useRef<HTMLDivElement>(null)
  useNearEnd(end, () => onEnd?.(), marks, "200px")
  const pick = (i: number, e: Pointer) => onPick(items[i] ?? null, { mod: e.metaKey || e.ctrlKey || ("button" in e && e.button === 1), shift: e.shiftKey })
  const picks = useRef(pick)
  useLayoutEffect(() => { picks.current = pick })
  const [rowPick] = useState(() => (i: number, e: Pointer) => picks.current(i, e))
  const [rowHover] = useState(() => (i: number) => setSel(i))
  const onKey = (e: KeyboardEvent) => {
    if (e.nativeEvent.isComposing || ownKey?.(e)) return
    if ((e.key === "ArrowRight" || e.key === "End") && suffix) { setQuery(query + suffix); return }
    if (e.key === "ArrowDown" || (e.ctrlKey && (e.key === "j" || (isMac && e.key === "n")))) { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)) }
    else if (e.key === "ArrowUp" || (e.ctrlKey && (e.key === "k" || (isMac && e.key === "p")))) { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); pick(sel, e) }
  }
  const clears = useRef(setQuery)
  clears.current = setQuery
  const [clear] = useState(() => () => { clears.current(""); input.current?.focus() })
  const onDialogKey = (e: KeyboardEvent) => { if (e.key === "Tab") { e.preventDefault(); input.current?.focus() } }
  const ids = useId()
  const runs: { name?: string; start: number; rows: T[] }[] = []
  items.slice(0, drawn).forEach((it, i) => {
    const name = section?.(it) || undefined, last = runs[runs.length - 1]
    if (last && last.name === name) last.rows.push(it)
    else runs.push({ name, start: i, rows: [it] })
  })

  return (
    <PaletteFrame label={label} onClose={onClose} onKeyDown={onDialogKey} aside={aside}>
      <div className="flex items-center gap-2 border-b-[0.5px] border-border pr-3 pl-5">
        <input ref={input} value={query + suffix} onKeyDown={onKey} placeholder={placeholder}
          onChange={(e) => setQuery(e.target.value, { deleting: e.nativeEvent instanceof InputEvent && e.nativeEvent.inputType.startsWith("delete") })}
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" role="combobox" aria-expanded aria-controls="palette-results"
          aria-activedescendant={items[sel] ? `palette-${items[sel].id}` : undefined}
          className="h-14 min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted-foreground" />
        {query && <Clear onClear={clear} />}
      </div>
      <div ref={list} id="palette-results" role="listbox" aria-labelledby={heading ? `${ids}h` : undefined} aria-label={heading ? undefined : label}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5 max-md:[zoom:1.1333]">
        {heading && <div id={`${ids}h`} role="presentation" aria-hidden className="px-3 pt-1.5 pb-1 text-[12px] font-semibold text-muted-foreground">{heading}</div>}
        {!items.length && empty}
        {runs.map((r, k) => {
          const rows = r.rows.map((it, j) => (
            <PaletteRow key={it.id} id={it.id} item={it} i={r.start + j} selected={r.start + j === sel} look={look} draw={(s) => row(it, s)} act={actOf(action, it)} onHover={rowHover} onPick={rowPick} />
          ))
          if (!r.name) return <Fragment key={k}>{rows}</Fragment>
          return (
            <div key={k} role="group" aria-labelledby={`${ids}s${k}`}>
              <div id={`${ids}s${k}`} role="presentation" className="px-3 pt-2.5 pb-1 text-[12px] font-semibold text-muted-foreground">{r.name}</div>
              {rows}
            </div>
          )
        })}
        {drawn < items.length ? <div ref={more} aria-hidden className="h-px" /> : onEnd && <div ref={end} aria-hidden className="h-px" />}
      </div>
      <Hints hints={hints} />
    </PaletteFrame>
  )
}

let frameClosed = -Infinity
let current: { close: () => void } | null = null
export const closePalette = () => current?.close()

/** The palette's overlay without its list (the Ask box's), the page held still under it: Escape or a click outside
 *  closes it, the keyboard goes back. Its children focus their field; `aside` is drawn beside it, going with it. */
export function PaletteFrame({ label, onClose, onKeyDown, aside, children }: { label: string; onClose: () => void; onKeyDown?: (e: KeyboardEvent) => void; aside?: ReactNode; children: ReactNode }) {
  useHeldFocus()
  const [swapped] = useState(() => !!current || performance.now() - frameClosed < 50)
  const closes = useRef(onClose)
  useLayoutEffect(() => { closes.current = onClose })
  const [self] = useState(() => ({ close: () => closes.current() }))
  const box = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const was = current
    current = self
    was?.close()
    if (swapped) dropLeaving("palette")
    const el = box.current
    return () => {
      frameClosed = performance.now()
      if (current !== self) return
      current = null
      fadeAway([el], { tag: "palette", scale: 0.98, scaled: "[role=dialog]" })
    }
  }, [self])
  usePageLock()
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose() }
    else onKeyDown?.(e)
  }
  const overlay = (
    <div ref={box} data-overlay data-palette className="fixed inset-x-0 z-50 flex items-start justify-center px-3 pt-[max(env(safe-area-inset-top),0.75rem)] md:pt-[12vh]"
      style={{ top: "var(--vvtop, 0px)", height: "var(--vvh, 100dvh)" }}>
      <button type="button" aria-label={`Close ${label.toLowerCase()}`} tabIndex={-1} onClick={onClose}
        className={cn("absolute inset-0 cursor-default bg-black/30", !swapped && "animate-in fade-in duration-150")} />
      <div className="relative w-full max-w-[680px]">
        <div role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey}
          style={{ maxHeight: "min(70dvh, 600px, calc(var(--vvh, 100dvh) - 1.5rem - env(safe-area-inset-top)))" }}
          className={cn("relative flex w-full flex-col overflow-hidden rounded-[14px] border-[0.5px] border-border bg-card shadow-2xl", !swapped && "animate-in fade-in zoom-in-95 duration-150")}>
          {children}
        </div>
        {aside}
      </div>
    </div>
  )
  return <ModalWhenOverModal onClose={onClose}>{overlay}</ModalWhenOverModal>
}

function ModalWhenOverModal({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const [pageInert] = useState(() => [...document.querySelectorAll("dialog[open]")].some((d) => { try { return d.matches(":modal") } catch { return false } }))
  const layer = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { if (pageInert) layer.current?.showModal() }, [pageInert])
  if (!pageInert) return children
  return (
    <dialog ref={layer} data-palette-layer onCancel={(e) => { e.preventDefault(); onClose() }}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-visible border-0 bg-transparent p-0 outline-none backdrop:bg-transparent">
      {children}
    </dialog>
  )
}
