// Suggestions under a text field, drawn over the page: a search query's (operators, then the vault's tags, types and
// folders), a property's name or value. Keys as in the editor's list: arrows move, Enter or Tab picks, Escape closes it.
import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { suggestQuery, type QuerySuggestion } from "../../../core/searchquery.ts"
import { useStoreWith } from "@/core/data"
import { vocabOf } from "@/core/vocab"
import { cn } from "@/lib/utils"

type Field = HTMLInputElement
/** What the field passes on: the hook's handlers run first, and the field's own only when the list didn't take the key. */
type Own = { onKeyDown?: (e: KeyboardEvent<Field>) => void; onFocus?: (e: FocusEvent<Field>) => void; onBlur?: (e: FocusEvent<Field>) => void }
/** What's suggested for the text and its caret: each item's `text` goes in place of from..to. */
export type Found = { from: number; to: number; items: QuerySuggestion[] }
type Options = Own & {
  /** A space after a pick (not after an item that's `more`: an operator, its values next). */
  spaceAfter?: boolean
  /** Called with the text a pick makes instead of `set` (a field that takes the pick at once: a list's new item). */
  onPick?: (next: string) => void
  /** Enter picks only what completes the text typed (an item starting with it), else it's the field's: a value that's
   *  new isn't swapped for an old one. */
  completesOnly?: boolean
}
type Suggest = { input: Own & { ref: (el: Field | null) => void; onSelect: () => void; "aria-autocomplete": "list"; "aria-expanded": boolean }; list: ReactNode }

/** Spread `input` on the field (with its own handlers given here) and draw `list` anywhere. `find` says what to suggest
 *  while it's focused (null: nothing). */
export function useSuggest(value: string, set: (v: string) => void, find: (value: string, caret: number) => Found | null, o: Options = {}): Suggest {
  const field = useRef<Field | null>(null)
  const [caret, setCaret] = useState<number | null>(null)
  const [at, setAt] = useState<number | null>(null)
  const [closed, setClosed] = useState<string | null>(null)
  const [box, setBox] = useState<DOMRect | null>(null)
  const found = caret !== null && closed !== value ? find(value, Math.min(caret, value.length)) : null
  const items = found?.items ?? []
  const typed = found ? value.slice(found.from, found.to).toLowerCase() : ""
  const first = !o.completesOnly || (!!typed && !!items[0]?.text.toLowerCase().startsWith(typed)) ? 0 : -1
  const sel = Math.min(at ?? first, items.length - 1)

  useLayoutEffect(() => { if (found) setBox(field.current?.getBoundingClientRect() ?? null) }, [!!found, value]) // eslint-disable-line react-hooks/exhaustive-deps
  useLayoutEffect(() => setAt(null), [value, found?.from])

  const read = () => setCaret(field.current && document.activeElement === field.current ? field.current.selectionEnd ?? value.length : null)
  const pick = (i: number) => {
    const it = items[i]
    if (!found || !it) return
    const tail = value.slice(found.to)
    const space = !o.spaceAfter || it.more || /^\s/.test(tail) ? "" : " "
    const next = value.slice(0, found.from) + it.text + space + tail
    if (o.onPick) return o.onPick(next)
    const to = found.from + it.text.length + space.length
    set(next)
    setCaret(to)
    requestAnimationFrame(() => field.current?.setSelectionRange(to, to))
  }
  const onKeyDown = (e: KeyboardEvent<Field>) => {
    if (items.length && !e.nativeEvent.isComposing) {
      const move = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : 0
      if (move) { e.preventDefault(); setAt(sel < 0 && move < 0 ? items.length - 1 : (sel + move + items.length) % items.length); return }
      if ((e.key === "Enter" || e.key === "Tab") && sel >= 0) { e.preventDefault(); pick(sel); return }
      if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setClosed(value); return }
    }
    o.onKeyDown?.(e)
    // (the caret after the key: arrows, Home, End)
    requestAnimationFrame(read)
  }

  const list = found && box && items.length ? createPortal(
    <div role="listbox" aria-label="Suggestions" data-suggestions onMouseDown={(e) => e.preventDefault()}
      style={{ left: Math.max(8, Math.min(box.left, innerWidth - 268)), top: box.bottom + 6, minWidth: Math.min(Math.max(box.width, 260), innerWidth - 16) }}
      className="fixed z-[62] max-h-[min(320px,45dvh)] max-w-[min(360px,calc(100vw-1rem))] overflow-y-auto overscroll-contain rounded-card border-[0.5px] border-border bg-card p-1 shadow-xl">
      {items.map((it, i) => (
        <div key={it.text} role="option" aria-selected={i === sel} data-suggestion={it.text} onPointerMove={() => i !== sel && setAt(i)} onClick={() => pick(i)}
          className={cn("flex cursor-pointer items-baseline rounded-control px-2 py-[5px] text-[14px] leading-5 max-md:min-h-11 max-md:items-center max-md:px-3 max-md:text-[17px]",
            i === sel && "bg-primary/15")}>
          <span className="min-w-0 truncate">{it.label}</span>
          {it.detail && <span className="ml-auto pl-3 text-[12px] whitespace-nowrap text-muted-foreground tabular-nums max-md:text-[14px]">{it.detail}</span>}
        </div>
      ))}
    </div>, document.body) : null

  return {
    input: {
      ref: (el) => { field.current = el },
      onKeyDown,
      onSelect: read,
      onFocus: (e) => { read(); o.onFocus?.(e) },
      onBlur: (e) => { setCaret(null); setClosed(null); o.onBlur?.(e) },
      "aria-autocomplete": "list",
      "aria-expanded": !!list,
    },
    list,
  }
}

/** A search query's field (core/searchquery.ts): its operators, then the vault's tags, types and folders. */
export function useQuerySuggest(value: string, set: (v: string) => void, own: Own = {}): Suggest {
  const files = useStoreWith((s) => s?.files.files)
  return useSuggest(value, set, (v, caret) => (files ? suggestQuery(v, caret, vocabOf(files)) : null), { ...own, spaceAfter: true })
}
