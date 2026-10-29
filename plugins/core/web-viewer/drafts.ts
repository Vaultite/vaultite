// What's typed in a tab's address, kept while the tab is away (as Chrome keeps a tab's unsent edit till Esc, Enter or a
// navigation), and how what's typed opens: http after a guessed https that can't connect, new tabs in front or behind.
import { useCallback, useState } from "react"
import { openTab } from "@vaultite"
import { httpFallback } from "./address"
import { argOf, openBehind } from "./containers"

/** A tab's edit: what's typed (null: nothing, the page's address shows) and the container picked for it (undefined:
 *  none picked, null: no container), made while the page showed `on`. */
export type Draft = { text: string | null; chosen?: string | null; on: string }
const drafts = new Map<string, Draft>()

/** Tab `tab`'s edit, kept by tab while it's hidden or drawn again. */
export function useDraft(tab: string): [Draft | null, (d: Draft | null) => void] {
  const [d, setD] = useState(() => drafts.get(tab) ?? null)
  const set = useCallback((next: Draft | null) => {
    if (next) drafts.set(tab, next); else drafts.delete(tab)
    setD(next)
  }, [tab])
  return [d, set]
}

/** Addresses opened as https only because what was typed named no scheme. */
const guessed = new Set<string>()
export const guessedFor = (url: string) => { guessed.add(url) }
/** Whether `url` failing with `error` is tried over http next (asked without using up the guess). */
export const fallsBack = (url: string, error: string) => guessed.has(url) && !!httpFallback(url, error)
/** The http address to load after `url` failed with `error`, once, if it was a guess. */
export function fallbackFor(url: string, error: string) {
  const to = guessed.has(url) ? httpFallback(url, error) : null
  guessed.delete(url)
  return to
}

/** `url` in a new tab in `container`, after `from`: in front (⌥Enter), or behind with the user staying (⌘Enter). */
export function openWebTab(url: string, container: string | null, background: boolean, from?: string) {
  if (background) openBehind(url, container, from)
  else openTab(`view:web/${argOf(url, container)}`, { from })
}
