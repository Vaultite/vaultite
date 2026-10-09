// The overlay the quick switcher (⌘O) and command palette (⌘P) share: arrows or ⌃N/⌃P move, Enter
// picks (⌘ or ⇧ when the caller says), Esc closes.
import { Fragment, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import { X } from "lucide-react"
import { keyCaps, keyHint } from "@/core/commands"
import { isMac } from "@/core/platform"
import { useHeldFocus } from "@/core/focus"
import { useNearEnd } from "@/core/near"
import { dismissKeyboardOnDrag, usePageLock } from "@/core/pagelock"
import { cn } from "@/lib/utils"

export type Pick = { mod: boolean; shift: boolean }

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
        <kbd key={i} className="grid h-[22px] min-w-[22px] place-items-center rounded-[5px] border-[0.5px] border-border bg-foreground/[0.06] px-1.5 font-sans text-[12px] leading-none text-muted-foreground">{k}</kbd>
      ))}
    </span>
  )
}

export function Palette<T extends { id: string }>({ label, placeholder, query, setQuery, items, row, onPick, onClose, hints, heading, section, empty, start = 0, onEnd }: {
  label: string; placeholder: string
  query: string; setQuery: (q: string) => void
  items: T[]
  row: (item: T, selected: boolean) => ReactNode
  /** Enter or a click on `item` (null: Enter with nothing listed). */
  onPick: (item: T | null, how: Pick) => void
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
}) {
  // Closed, the keyboard goes back where it was (or to what it opened).
  useHeldFocus()
  const [sel, setSel] = useState(start)
  const list = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  // Over an open sheet (a modal <dialog>: the rest of the page is inert), it's a modal dialog of its own above it, as
  // ContextMenu's menus are; opened before the field is focused.
  const [over] = useState(() => [...document.querySelectorAll("dialog[open]")].some((d) => { try { return d.matches(":modal") } catch { return false } }))
  const layer = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => { if (over) layer.current?.showModal() }, [over])
  // The page under it held still, then the field focused (core/pagelock.ts).
  usePageLock()
  useLayoutEffect(() => input.current?.focus({ preventScroll: true }), [])
  // On a phone, dragging the results puts the keyboard away (core/pagelock.ts).
  useEffect(() => (list.current ? dismissKeyboardOnDrag(list.current) : undefined), [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setSel(query ? 0 : start), [query])
  useEffect(() => { list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }) }, [sel])
  const end = useRef<HTMLDivElement>(null)
  useNearEnd(end, () => onEnd?.(), items.length, "200px")
  const pick = (i: number, e: { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }) =>
    onPick(items[i] ?? null, { mod: e.metaKey || e.ctrlKey, shift: e.shiftKey })
  const onKey = (e: KeyboardEvent) => {
    // ⌃J/⌃K (Vim's) move too, and on a Mac ⌃N/⌃P (Emacs'); elsewhere those are the app's Mod+N and Mod+P.
    if (e.key === "ArrowDown" || (e.ctrlKey && (e.key === "j" || (isMac && e.key === "n")))) { e.preventDefault(); setSel((s) => Math.min(s + 1, items.length - 1)) }
    else if (e.key === "ArrowUp" || (e.ctrlKey && (e.key === "k" || (isMac && e.key === "p")))) { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)) }
    else if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); pick(sel, e) }
  }
  // Anywhere in it: Escape closes it, and Tab stays in its field (its rows are chosen with the arrows).
  const onDialogKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); onClose() }
    else if (e.key === "Tab") { e.preventDefault(); input.current?.focus() }
  }

  const overlay = (
    // On the part of the screen the keyboard leaves (core/pagelock.ts' --vvh, --vvtop), so the list ends above it and
    // a finger on it scrolls it.
    <div data-overlay className="fixed inset-x-0 z-50 flex items-start justify-center px-3 pt-[max(env(safe-area-inset-top),0.75rem)] md:pt-[12vh]"
      style={{ top: "var(--vvtop, 0px)", height: "var(--vvh, 100dvh)" }}>
      <button type="button" aria-label={`Close ${label.toLowerCase()}`} tabIndex={-1} onClick={onClose}
        className="absolute inset-0 cursor-default bg-black/30 animate-in fade-in duration-150" />
      <div role="dialog" aria-modal="true" aria-label={label} onKeyDown={onDialogKey}
        style={{ maxHeight: "min(70dvh, 600px, calc(var(--vvh, 100dvh) - 1.5rem - env(safe-area-inset-top)))" }}
        className="relative flex w-full max-w-[680px] flex-col overflow-hidden rounded-[14px] border-[0.5px] border-border bg-card shadow-2xl animate-in fade-in zoom-in-95 duration-150">
        <div className="flex items-center gap-2 border-b-[0.5px] border-border pr-3 pl-5">
          <input ref={input} value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={onKey} placeholder={placeholder}
            autoComplete="off" autoCorrect="off" spellCheck={false} enterKeyHint="go" role="combobox" aria-expanded aria-controls="palette-results"
            aria-activedescendant={items[sel] ? `palette-${items[sel].id}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-[17px] outline-none placeholder:text-muted-foreground" />
          {query && (
            <button type="button" aria-label="Clear" onClick={() => { setQuery(""); input.current?.focus() }}
              className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-full bg-muted-foreground text-card hover:bg-foreground/80">
              <X className="size-4" strokeWidth={3} />
            </button>
          )}
        </div>
        <div ref={list} id="palette-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
          {heading && <div className="px-3 pt-1.5 pb-1 text-[12px] font-semibold text-muted-foreground">{heading}</div>}
          {!items.length && empty}
          {items.map((it, i) => (
            <Fragment key={it.id}>
            {section && section(it) && section(it) !== (i ? section(items[i - 1]) : undefined) && (
              <div role="presentation" className="px-3 pt-2.5 pb-1 text-[12px] font-semibold text-muted-foreground">{section(it)}</div>
            )}
            <button id={`palette-${it.id}`} data-i={i} type="button" role="option" aria-selected={i === sel} tabIndex={-1}
              onMouseMove={() => sel !== i && setSel(i)} onClick={(e) => pick(i, e)}
              className={cn("flex w-full cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2 text-left", i === sel && "bg-foreground/[0.07]")}>
              {row(it, i === sel)}
            </button>
            </Fragment>
          ))}
          {onEnd && <div ref={end} aria-hidden className="h-px" />}
        </div>
        <div className="hidden flex-wrap items-center gap-x-5 gap-y-1 border-t-[0.5px] border-border px-5 py-2.5 text-[13px] text-muted-foreground md:flex">
          {hints.map(([k, what]) => (
            <span key={k} className="whitespace-nowrap">
              <span className="font-semibold text-foreground/80">{k.split(" ").map(keyHint).join("")}</span> {what}
            </span>
          ))}
        </div>
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
