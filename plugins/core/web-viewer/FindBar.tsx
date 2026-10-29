// Find in a web page, as Safari's: a bar under the page's bar, the page made shorter (over the native page it would need
// the window raised over it, its pointer passed on), searched by the page's engine (electron/web.ts `web:find`).
import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { CaseSensitive, ChevronDown, ChevronUp, X } from "lucide-react"
import { cn, numberText, type WebPages } from "@vaultite"
import type { FindAsk } from "./state"

/** Each tab's find, as Chrome keeps it: its words, and whether its bar is open (shown again, it is). */
const finds = new Map<string, { text: string; open: boolean }>()
export const findOpen = (tab: string) => !!finds.get(tab)?.open
export const setFindOpen = (tab: string, open: boolean) => finds.set(tab, { text: finds.get(tab)?.text ?? "", open })

export type Found = { active: number; matches: number }

const tool = "grid size-7 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"

/** `ask`: what was asked last (bumped by `n`), `found`: what the page found for it (null: not searched yet). */
export function FindBar({ web, id, tab, ask, found, close }: { web: WebPages; id: number; tab: string; ask: { n: number; how: FindAsk }; found: Found | null; close: () => void }) {
  const [text, setText] = useState(() => finds.get(tab)?.text ?? "")
  const [matchCase, setMatchCase] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const live = useRef({ text, matchCase, found })
  useEffect(() => { live.current = { text, matchCase, found } })
  const find = (t: string, o: { next?: boolean; forward?: boolean; matchCase?: boolean } = {}) =>
    void web.find?.(id, t, { matchCase: live.current.matchCase, ...o }).catch(() => {})
  // (not searched yet, Next is a new search)
  const step = (forward: boolean) => { const l = live.current; if (l.text) find(l.text, { next: !!l.found, forward }) }

  useEffect(() => {
    if (!ask.n) { if (live.current.text) find(live.current.text); return }
    if (ask.how === "open") { input.current?.focus(); input.current?.select(); if (live.current.text && !live.current.found) find(live.current.text) }
    else step(ask.how === "next")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.n])
  // (its highlights go with it)
  useEffect(() => () => void web.find?.(id, "").catch(() => {}), [web, id])

  const change = (t: string) => {
    setText(t)
    finds.set(tab, { text: t, open: true })
    find(t)
  }
  const keys = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); close(); return }
    if (e.key !== "Enter" || e.nativeEvent.isComposing) return
    e.preventDefault()
    step(!e.shiftKey)
  }
  const none = !!text && found?.matches === 0
  const status = !text || !found ? "" : none ? "No results" : `${numberText(found.active)} of ${numberText(found.matches)}`
  return (
    <div className="flex h-9 shrink-0 items-center justify-end gap-0.5 border-b-[0.5px] border-border px-1.5" data-web-find>
      <div className="relative min-w-0 max-w-[340px] flex-1">
        <input ref={input} value={text} placeholder="Find in page" aria-label="Find in page" spellCheck={false} autoComplete="off" autoCorrect="off" autoCapitalize="off"
          onChange={(e) => change(e.target.value)} onKeyDown={keys} data-web-find-field
          className={cn("h-7 w-full min-w-0 rounded-[6px] bg-card pr-24 pl-2 text-[13px] text-foreground outline-none ring-1 ring-border placeholder:text-muted-foreground focus:ring-primary/60",
            none && "ring-[color-mix(in_srgb,var(--red)_55%,transparent)] focus:ring-[color-mix(in_srgb,var(--red)_70%,transparent)]")} />
        <span aria-live="polite" data-web-find-count className={cn("pointer-events-none absolute inset-y-0 right-2 flex items-center text-[12px] tabular-nums", none ? "text-[var(--red)]" : "text-muted-foreground")}>{status}</span>
      </div>
      <button type="button" aria-label="Match case" aria-pressed={matchCase} data-tip="Match case" onMouseDown={(e) => e.preventDefault()}
        onClick={() => { setMatchCase(!matchCase); if (text) find(text, { matchCase: !matchCase }) }}
        className={cn(tool, matchCase && "bg-primary/15 text-primary hover:bg-primary/20 hover:text-primary")}>
        <CaseSensitive className="size-4" strokeWidth={2} />
      </button>
      <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
      <button type="button" aria-label="Previous match" data-tip="Previous match (⇧↵)" disabled={!found?.matches} onClick={() => step(false)} onMouseDown={(e) => e.preventDefault()} className={tool}>
        <ChevronUp className="size-4" strokeWidth={2} />
      </button>
      <button type="button" aria-label="Next match" data-tip="Next match (↵)" disabled={!found?.matches} onClick={() => step(true)} onMouseDown={(e) => e.preventDefault()} className={tool}>
        <ChevronDown className="size-4" strokeWidth={2} />
      </button>
      <button type="button" aria-label="Close" data-tip="Close (esc)" onClick={close} onMouseDown={(e) => e.preventDefault()} className={tool} data-web-find-close>
        <X className="size-4" strokeWidth={2} />
      </button>
    </div>
  )
}
