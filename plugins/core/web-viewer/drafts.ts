import { useCallback, useState } from "react"
import { openTab } from "@vaultite"
import { httpFallback } from "./address"
import { argOf, openBehind } from "./containers"

export type Draft = { text: string | null; chosen?: string | null; on: string }
const drafts = new Map<string, Draft>()

export function useDraft(tab: string): [Draft | null, (d: Draft | null) => void] {
  const [d, setD] = useState(() => drafts.get(tab) ?? null)
  const set = useCallback((next: Draft | null) => {
    if (next) drafts.set(tab, next); else drafts.delete(tab)
    setD(next)
  }, [tab])
  return [d, set]
}

const guessed = new Set<string>()
export const guessedFor = (url: string) => { guessed.add(url) }
export const fallsBack = (url: string, error: string) => guessed.has(url) && !!httpFallback(url, error)
export function fallbackFor(url: string, error: string) {
  const to = guessed.has(url) ? httpFallback(url, error) : null
  guessed.delete(url)
  return to
}

export function openWebTab(url: string, container: string | null, background: boolean, from?: string) {
  if (background) openBehind(url, container, from)
  else openTab(`view:web/${argOf(url, container)}`, { from })
}
