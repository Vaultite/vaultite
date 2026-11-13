import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { cn, numberText, type WebPages } from "@vaultite"
import { FindField, FindTools, floatingBar, floatingSpot } from "@plugins/find/tools"
import type { FindAsk } from "./state"

const finds = new Map<string, { text: string; open: boolean }>()
export const findOpen = (tab: string) => !!finds.get(tab)?.open
export const setFindOpen = (tab: string, open: boolean) => finds.set(tab, { text: finds.get(tab)?.text ?? "", open })

export type Found = { active: number; matches: number }

export function FindBar({ web, id, tab, ask, found, close, className }: { web: WebPages; id: number; tab: string; ask: { n: number; how: FindAsk }; found: Found | null; close: () => void
  className?: string }) {
  const [text, setText] = useState(() => finds.get(tab)?.text ?? "")
  const [matchCase, setMatchCase] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const live = useRef({ text, matchCase, found })
  useEffect(() => { live.current = { text, matchCase, found } })
  const find = (t: string, o: { next?: boolean; forward?: boolean; matchCase?: boolean } = {}) =>
    void web.find?.(id, t, { matchCase: live.current.matchCase, ...o }).catch(() => {})
  const step = (forward: boolean) => { const l = live.current; if (l.text) find(l.text, { next: !!l.found, forward }) }

  useEffect(() => {
    if (!ask.n) { if (live.current.text) find(live.current.text); return }
    if (ask.how === "open") { input.current?.focus(); input.current?.select(); if (live.current.text && !live.current.found) find(live.current.text) }
    else step(ask.how === "next")
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ask.n])
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
    <div data-web-find data-floats data-overlay className={cn(floatingSpot, floatingBar, className)}>
      <FindField inputRef={input} value={text} placeholder="Find in page" status={status} bad={none} onChange={change} onKeyDown={keys} />
      <FindTools spec={{ caseSensitive: matchCase }} total={found?.matches ?? 0} step={(by) => step(by > 0)} close={close}
        set={(o) => { const on = !!o.caseSensitive; setMatchCase(on); if (text) find(text, { matchCase: on }) }} />
    </div>
  )
}
