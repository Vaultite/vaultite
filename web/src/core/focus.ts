import { useEffect, useRef, useState, type RefObject } from "react"
import { keyboardTakes, pageTakenSince, webPages } from "@/core/desktop"
import { isDesktop } from "@/core/platform"
import { activePane, activeTab, onWorkspaceChange } from "@/core/workspace"
import { elementOf } from "@/core/dom"

let tabbedAt = -1e9
if (typeof window !== "undefined") addEventListener("keydown", (e) => { if (e.key === "Tab") tabbedAt = e.timeStamp }, true)
export const byTab = (e: Event) => e.timeStamp - tabbedAt < 500

const TYPABLE = ".cm-content[contenteditable=true], [data-term-input]"

const idle = (el: Element | null) => !el || el === document.body || el === document.documentElement || !el.isConnected ||
  !!el.closest("dialog:not([open])")

/** Put the keyboard in pane `gid` (its id) (the focused one by default): its editor or terminal, if it shows one. Answers
 *  whether it did. */
export function focusPane(gid = activePane().id) {
  // On a phone, focusing an editor brings up the keyboard.
  if (!isDesktop()) return false
  const el = document.querySelector<HTMLElement>(`[data-pane="${CSS.escape(gid)}"]`)?.querySelector<HTMLElement>(TYPABLE)
  if (!el) return false
  el.focus({ preventScroll: true })
  return true
}

/** Whether the keyboard is someone else's (an overlay, or a field outside `mine`), so a view focusing itself (a
 *  terminal reconnecting) must leave it. A just-hidden tab doesn't count: its focus is on the way out. */
export function keyboardBusy(mine?: Element | null) {
  const a = document.activeElement
  if (idle(a) || (mine && mine.contains(a)) || a!.closest("[data-kept]")) return false
  return !!a!.closest("[role=dialog], [role=menu], dialog, input, textarea, select, [contenteditable=true]")
}

function focusPaneSoon(tries = 30) {
  if (!idle(document.activeElement) || focusPane() || tries <= 0) return
  requestAnimationFrame(() => focusPaneSoon(tries - 1))
}

const where = () => { const p = activePane(); return `${activeTab()?.id} ${p?.id} ${p?.to}` }

let handing: Element | null = null

type Hold = { was: Element | null; under: Hold | null; gone: boolean }
let top: Hold | null = null

/** Call as something opens over the page, before it takes the focus; call what it returns as it closes. */
export function holdFocus(): () => void {
  const cur = document.activeElement
  const held = (idle(cur) || cur?.closest("[role=menu], [role=dialog][aria-modal]")) && handing ? handing : cur
  const hold: Hold = { was: held, under: top, gone: false }
  top = hold
  const before = where(), takes = keyboardTakes()
  return () => {
    hold.gone = true
    while (top?.gone) top = top.under
    let was = hold.was, under = hold.under
    while (idle(was) && under?.gone) { was = under.was; under = under.under }
    handing = was
    setTimeout(() => { if (handing === was) handing = null }, 100)
    setTimeout(() => requestAnimationFrame(() => {
      if (!idle(document.activeElement)) return
      if (where() !== before) return focusPaneSoon()
      const page = pageTakenSince(takes)
      if (page !== null) return void webPages?.go(page, "focus").catch(() => {})
      const pane = was?.closest<HTMLElement>("[data-pane]")?.dataset.pane
      if (!idle(was) && (!pane || pane === activePane().id)) { if (was instanceof HTMLElement || was instanceof SVGElement) was.focus({ preventScroll: true }) }
      else if (!idle(was) || pane) focusPaneSoon()
    }))
  }
}

/** holdFocus for a component that is the overlay: held from its first render (before an autoFocus field inside it
 *  takes the focus) until it unmounts. */
export function useHeldFocus() {
  const [release] = useState(holdFocus)
  useEffect(() => release, [release])
}

let seen = where()
let last: Element | null = null
addEventListener("focusin", (e) => { last = elementOf(e.target) })
onWorkspaceChange(() => {
  const now = where()
  if (now === seen) return
  seen = now
  requestAnimationFrame(() => { if (idle(document.activeElement) && last?.closest("[data-pane]")) focusPaneSoon() })
})

/** An open popover (a flyout, a switcher) closes on Escape (not under a menu or palette, nor if `escape(e)` says no),
 *  a press outside `inside` (a selector) and `anchor`, and (`hash`) the address changing; closed, the keyboard goes back. */
export function useDismiss(open: boolean, close: () => void, { inside, anchor, hash, escape }: {
  inside: string; anchor?: RefObject<Element | null>; hash?: boolean; escape?: (e: KeyboardEvent) => boolean
}) {
  const latest = useRef({ close, escape })
  latest.current = { close, escape }
  useEffect(() => {
    if (!open) return
    const release = holdFocus()
    const shut = () => latest.current.close()
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !document.querySelector("[role=menu], [data-palette]") && (latest.current.escape?.(e) ?? true)) { e.stopPropagation(); shut() }
    }
    const down = (e: PointerEvent) => {
      const t = elementOf(e.target)
      if (!t?.closest(inside) && !anchor?.current?.contains(t)) shut()
    }
    addEventListener("keydown", key, true)
    addEventListener("pointerdown", down, true)
    if (hash) addEventListener("hashchange", shut)
    return () => { removeEventListener("keydown", key, true); removeEventListener("pointerdown", down, true); removeEventListener("hashchange", shut); release() }
  }, [open, inside, anchor, hash])
}
