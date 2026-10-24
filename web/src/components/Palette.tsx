// The overlay the quick switcher (⌘O) and command palette (⌘P) share: arrows or ⌃N/⌃P move, Enter
// picks (⌘ or ⇧ when the caller says), Esc closes. Its frame (PaletteFrame) is any palette-like box's (the Ask box).
import { Fragment, memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { X } from "lucide-react"
import { keyCaps, keyHint } from "@/core/commands"
import { isMac } from "@/core/platform"
import { useHeldFocus } from "@/core/focus"
import { useNearEnd } from "@/core/near"
import { dismissKeyboardOnDrag, usePageLock } from "@/core/pagelock"
import { cn } from "@/lib/utils"

export type Pick = { mod: boolean; shift: boolean }
/** Rows drawn at first, and how many more each time the list is scrolled near its end. */
const ROWS = 60

/** Matched characters (indexes into `text`, as JavaScript counts them) drawn in the accent colour. */
export function Marked({ text, marks }: { text: string; marks: number[] }) {
  if (!marks.length) return <>{text}</>
  const on = new Set(marks)
  // Runs of marked and plain text, so a word is one <mark>.
  const runs: [string, boolean][] = []
  for (let i = 0; i < text.length; i++) {
    const m = on.has(i), last = runs[runs.length - 1]
    if (last && last[1] === m) last[0] += text[i]
    else runs.push([text[i], m])
  }
  return <>{runs.map(([t, m], i) => (m ? <mark key={i} className="bg-transparent font-semibold text-[var(--red)]">{t}</mark> : t))}</>
}

/** Keycaps for a shortcut ("Mod+E"), drawn small at the end of a row. */
export function Keys({ keys }: { keys: string }) {
  return (
    <span className="hidden shrink-0 gap-1 md:flex">
      {keyCaps(keys).map((k, i) => (
        <kbd key={i} className="grid h-[22px] min-w-[22px] place-items-center rounded-[5px] border-[0.5px] border-border bg-foreground/[0.06] px-1.5 font-keys text-[12px] leading-none text-muted-foreground">{k}</kbd>
      ))}
    </span>
  )
}

type Pointer = { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }
type RowProps<T> = {
  id: string; item: T; i: number; selected: boolean; look: unknown; draw: (item: T, selected: boolean) => ReactNode
  onHover: (i: number) => void; onPick: (i: number, e: Pointer) => void
}
/** A row, redrawn only when its item, place, selection or `look` changes (a pointer move redrew hundreds), so it
 *  draws from its item alone. Off screen it isn't laid out: a font picker's row loads its font once scrolled to. */
const PaletteRow = memo(function PaletteRow({ id, item, i, selected, draw, onHover, onPick }: RowProps<unknown>) {
  return (
    <button id={`palette-${id}`} data-i={i} type="button" role="option" aria-selected={selected} tabIndex={-1}
      onMouseMove={() => onHover(i)} onClick={(e) => onPick(i, e)}
      className={cn("flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2 text-left [contain-intrinsic-size:auto_37px] [content-visibility:auto]", selected && "bg-foreground/[0.07]")}>
      {draw(item, selected)}
    </button>
  )
}, (a, b) => a.id === b.id && a.i === b.i && a.selected === b.selected && a.look === b.look && a.item === b.item) as <T>(p: RowProps<T>) => ReactNode

/** The field's clear button, the same through typing. */
const Clear = memo(function Clear({ onClear }: { onClear: () => void }) {
  return (
    <button type="button" aria-label="Clear" onClick={onClear}
      className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full bg-muted-foreground text-card hover:bg-foreground/80">
      <X className="size-4" strokeWidth={3} />
    </button>
  )
})

export function Palette<T extends { id: string }>({ label, placeholder, query, setQuery, items, row, onPick, onClose, hints, heading, section, empty, start = 0, onEnd, onSelect, look }: {
  label: string; placeholder: string
  query: string; setQuery: (q: string) => void
  items: T[]
  row: (item: T, selected: boolean) => ReactNode
  /** Enter or a click on `item` (null: Enter with nothing listed). */
  onPick: (item: T | null, how: Pick) => void
  /** The selected row changed (the keys, the pointer, typing): to show what picking it would do. */
  onSelect?: (item: T | null) => void
  onClose: () => void
  /** The keys along the bottom: [keys, what they do], e.g. ["Mod+Enter", "to open in new tab"]. */
  hints: [string, string][]
  /** A line above the list (with an empty query: "Recent files"). */
  heading?: string
  /** The section a row is in ("In files"): its name is drawn above the first row of each run of rows in one. */
  section?: (item: T) => string | undefined
  empty?: ReactNode
  /** The row selected while nothing is typed (the current value), scrolled into view. */
  start?: number
  /** The list was scrolled (or arrowed) near its end: the caller lists more, if it has them. */
  onEnd?: () => void
  /** What rows are drawn with besides their item (a setting): a change redraws them. */
  look?: unknown
}) {
  const [sel, setSel] = useState(query ? 0 : start)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  // The page under it held still (PaletteFrame), then the field focused.
  useLayoutEffect(() => input.current?.focus({ preventScroll: true }), [])
  // On a phone, dragging the results puts the keyboard away (core/pagelock.ts).
  useEffect(() => (list.current ? dismissKeyboardOnDrag(list.current) : undefined), [])
  // Typing selects the first row in that same render: an effect left a frame where Enter picked a row no longer listed.
  const [selFor, setSelFor] = useState(query)
  if (selFor !== query) { setSelFor(query); setSel(query ? 0 : start) }
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }) }, [sel])
  const selected = items[sel] ?? null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onSelect?.(selected), [selected?.id])
  // A page of rows (and down to the selected one), another as it's scrolled near their end: opening drew every
  // command's row, ~700 on a big vault.
  const [limit, setLimit] = useState(ROWS)
  const [limitFor, setLimitFor] = useState(query)
  if (limitFor !== query) { setLimitFor(query); setLimit(ROWS) }
  const drawn = Math.min(items.length, Math.max(limit, sel + ROWS / 3))
  const more = useRef<HTMLDivElement>(null)
  useNearEnd(more, () => setLimit(drawn + ROWS), drawn)
  const end = useRef<HTMLDivElement>(null)
  useNearEnd(end, () => onEnd?.(), drawn, "200px")
  const pick = (i: number, e: Pointer) => onPick(items[i] ?? null, { mod: e.metaKey || e.ctrlKey, shift: e.shiftKey })
  // The rows' handlers stay the same (so a row's memo holds), calling the latest.
  const picks = useRef(pick)
  useLayoutEffect(() => { picks.current = pick })
  const [rowPick] = useState(() => (i: number, e: Pointer) => picks.current(i, e))
  const [rowHover] = useState(() => (i: number) => setSel(i))
  const onKey = (e: KeyboardEvent) => {
    // ⌃J/⌃K (Vim's) move too, and on a Mac ⌃N/⌃P (Emacs'); elsewhere those are the app's Mod+N and Mod+P.
    if (e.key === "ArrowDown" || (e.ctrlKey && (e.key === "j" || (isMac && e.key === "n")))) { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)) }
    else if (e.key === "ArrowUp" || (e.ctrlKey && (e.key === "k" || (isMac && e.key === "p")))) { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); pick(sel, e) }
  }
  const clears = useRef(setQuery)
  clears.current = setQuery
  const [clear] = useState(() => () => { clears.current(""); input.current?.focus() })
  // Tab stays in its field (its rows are chosen with the arrows).
  const onDialogKey = (e: KeyboardEvent) => { if (e.key === "Tab") { e.preventDefault(); input.current?.focus() } }

  return (
    <PaletteFrame label={label} onClose={onClose} onKeyDown={onDialogKey}>
      <div className="flex items-center gap-2 border-b-[0.5px] border-border pr-3 pl-5">
        <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder={placeholder}
          autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" role="combobox" aria-expanded aria-controls="palette-results"
          aria-activedescendant={items[sel] ? `palette-${items[sel].id}` : undefined}
          className="h-14 min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted-foreground" />
        {query && <Clear onClear={clear} />}
      </div>
      <div ref={list} id="palette-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
        {heading && <div className="px-3 pt-1.5 pb-1 text-[12px] font-semibold text-muted-foreground">{heading}</div>}
        {!items.length && empty}
        {items.slice(0, drawn).map((it, i) => (
          <Fragment key={it.id}>
          {section && section(it) && section(it) !== (i ? section(items[i - 1]) : undefined) && (
            <div role="presentation" className="px-3 pt-2.5 pb-1 text-[12px] font-semibold text-muted-foreground">{section(it)}</div>
          )}
          <PaletteRow id={it.id} item={it} i={i} selected={i === sel} look={look} draw={row} onHover={rowHover} onPick={rowPick} />
          </Fragment>
        ))}
        {drawn < items.length ? <div ref={more} aria-hidden className="h-px" /> : onEnd && <div ref={end} aria-hidden className="h-px" />}
      </div>
      <div className="hidden flex-wrap items-center gap-x-5 gap-y-1 border-t-[0.5px] border-border px-5 py-2.5 text-[13px] text-muted-foreground md:flex">
        {hints.map(([k, what]) => (
          <span key={k} className="whitespace-nowrap">
            <span className="font-keys font-semibold text-foreground/80">{k.split(" ").map(keyHint).join("")}</span> {what}
          </span>
        ))}
      </div>
    </PaletteFrame>
  )
}

/** The palette's overlay without its list, for any palette-like box (the Ask box): a card near the top, the page held
 *  still under it; Escape or a click outside closes it, and the keyboard goes back. Its children focus their field. */
export function PaletteFrame({ label, onClose, onKeyDown, children }: { label: string; onClose: () => void; onKeyDown?: (e: KeyboardEvent) => void; children: ReactNode }) {
  useHeldFocus()
  // Over an open sheet (a modal <dialog>: the rest of the page is inert), it's a modal dialog of its own above it, as
  // ContextMenu's menus are; opened before the field is focused.
  const [over] = useState(() => [...document.querySelectorAll("dialog[open]")].some((d) => { try { return d.matches(":modal") } catch { return false } }))
  const layer = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { if (over) layer.current?.showModal() }, [over])
  usePageLock()
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose() }
    else onKeyDown?.(e)
  }
  const overlay = (
    // On the part of the screen the keyboard leaves (core/pagelock.ts' --vvh, --vvtop), so the list ends above it and
    // a finger on it scrolls it.
    <div data-overlay className="fixed inset-x-0 z-50 flex items-start justify-center px-3 pt-[max(env(safe-area-inset-top),0.75rem)] md:pt-[12vh]"
      style={{ top: "var(--vvtop, 0px)", height: "var(--vvh, 100dvh)" }}>
      <button type="button" aria-label={`Close ${label.toLowerCase()}`} tabIndex={-1} onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/30 animate-in fade-in duration-150" />
      <div role="dialog" aria-modal="true" aria-label={label} onKeyDown={onKey}
        style={{ maxHeight: "min(70dvh, 600px, calc(var(--vvh, 100dvh) - 1.5rem - env(safe-area-inset-top)))" }}
        className="relative flex w-full max-w-[680px] flex-col overflow-hidden rounded-[14px] border-[0.5px] border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        {children}
      </div>
    </div>
  )
  if (!over) return overlay
  return (
    <dialog ref={layer} data-palette-layer onCancel={(e) => { e.preventDefault(); onClose() }}
      className="fixed inset-0 m-0 size-full max-h-none max-w-none overflow-visible border-0 bg-transparent p-0 outline-none backdrop:bg-transparent">
      {overlay}
    </dialog>
  )
}
