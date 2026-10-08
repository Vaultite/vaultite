// Focus around overlays (menus, palette, flyouts): closing one gives the keyboard back where it was, or to the new
// tab's editor when it changed what's on screen. Never steals it from something that took it meanwhile.
import { useEffect, useState } from "react"
import { keyboardTakes, pageTakenSince, webPages } from "@/core/desktop"
import { activeTab, getWorkspace, isDesktop, onWorkspaceChange } from "@/core/workspace"

// When Tab was last pressed: the keyboard moving on by itself, not a click or code.
let tabbedAt = -1e9
if (typeof window !== "undefined") addEventListener("keydown", (e) => { if (e.key === "Tab") tabbedAt = e.timeStamp }, true)
/** The focus event `e` comes from a Tab (or ⇧Tab). */
export const byTab = (e: Event) => e.timeStamp - tabbedAt < 500

/** What in a pane takes the keyboard: its editor (not in reading view), or its terminal. */
const TYPABLE = ".cm-content[contenteditable=true], .xterm-helper-textarea"

/** Nothing has the keyboard: no element, the page itself, one that's gone, or one inside a <dialog> that has closed (a
 *  sheet just shut, its element still on the page for a moment: its restore ran before the focus left it). */
const idle = (el: Element | null) => !el || el === document.body || el === document.documentElement || !el.isConnected ||
  !!el.closest("dialog:not([open])")

/** Put the keyboard in pane `gid` (the focused one by default): its editor or terminal, if it shows one. Answers
 *  whether it did. */
export function focusPane(gid = getWorkspace().focus) {
  // (Phones: focusing an editor would bring up the keyboard.)
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

/** focusPane, as soon as the pane's editor is there (a file just opened loads first), while nothing else has the
 *  focus: for about half a second. */
function focusPaneSoon(tries = 30) {
  if (!idle(document.activeElement) || focusPane() || tries <= 0) return
  requestAnimationFrame(() => focusPaneSoon(tries - 1))
}

/** The focused pane and what it shows. */
const where = () => { const t = activeTab(); return `${getWorkspace().focus} ${t?.id} ${t?.to}` }

/** What an overlay that just closed is giving the keyboard back to (for a moment). */
let handing: Element | null = null

/** Call as something opens over the page, before it takes the focus; call what it returns as it closes. */
export function holdFocus(): () => void {
  // Opened by what another one ran as it closed (the palette's command opening a sheet, a menu's Rename): what that
  // one held (the closing one may still be on the page, with the keyboard).
  const cur = document.activeElement
  const was = ((idle(cur) || cur?.closest("[role=menu], [role=dialog][aria-modal]")) && handing ? handing : cur) as HTMLElement | null
  const before = where(), takes = keyboardTakes()
  return () => {
    handing = was
    setTimeout(() => { if (handing === was) handing = null }, 100)
    // After the overlay is gone and whatever it ran has drawn (a field that focuses itself, a file's editor; the
    // command palette runs its command in a timeout of its own, so this one waits for it).
    setTimeout(() => requestAnimationFrame(() => {
      if (!idle(document.activeElement)) return
      // What's on screen changed: its editor. Else
      // what had the keyboard, if still there; else nothing (an editor focused out of the blue would type at its top).
      if (where() !== before) return focusPaneSoon()
      // (what was focused here is from before the page had the keyboard)
      const page = pageTakenSince(takes)
      if (page !== null) return void webPages?.go(page, "focus").catch(() => {})
      const pane = was?.closest<HTMLElement>("[data-pane]")?.dataset.pane
      if (!idle(was) && (!pane || pane === getWorkspace().focus)) was!.focus({ preventScroll: true })
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

// The focused pane or its tab changed (a tab closed, moved or opened, a pane closed) while the keyboard was in a tab,
// and it went with that tab: it goes to what's on screen now.
let seen = where()
let last: Element | null = null
addEventListener("focusin", (e) => { last = e.target as Element })
onWorkspaceChange(() => {
  const now = where()
  if (now === seen) return
  seen = now
  requestAnimationFrame(() => { if (idle(document.activeElement) && last?.closest("[data-pane]")) focusPaneSoon() })
})
