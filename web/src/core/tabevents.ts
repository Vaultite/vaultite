// What changed in a window's tabs, as events a plugin follows (the companion: what's focused, opened, closed, moved),
// worked out from each change's before and after (core/workspace.ts' set), so every way of changing them tells alike.
import { panesOf, type TabList } from "../../../core/layout.ts"

export type TabsEvent =
  | { type: "tab-focused"; tab: string; was: string | null }
  | { type: "pane-focused"; pane: string; tab: string; was: string | null }
  | { type: "tab-opened" | "tab-closed"; tab: string }
  /** Its place in the list changed (`at`: its index now). */
  | { type: "tab-moved"; tab: string; at: number }
  | { type: "pane-opened" | "pane-closed"; pane: string; tab: string }
  /** Into another tab (`from`: the tab it was in). */
  | { type: "pane-moved"; pane: string; tab: string; from: string }
  /** It shows another place (`to`: a target, file:<path> or view:<view>). */
  | { type: "pane-changed"; pane: string; tab: string; to: string }

const subs = new Set<(e: TabsEvent) => void>()
/** Hear every change of this window's tabs as events; returns the unsubscribe. */
export function onTabsEvent(fn: (e: TabsEvent) => void) { subs.add(fn); return () => { subs.delete(fn) } }

/** Tell what changed from `was` to `now` (`wasPane`, `nowPane`: the pane focused on screen before and after). */
export function tabsChanged(was: TabList, now: TabList, wasPane: string, nowPane: string) {
  if (!subs.size || was === now) return
  const out: TabsEvent[] = []
  const before = new Map(was.tabs.map((t, i) => [t.id, { t, i }])), after = new Map(now.tabs.map((t, i) => [t.id, { t, i }]))
  const panesBefore = new Map(was.tabs.flatMap((t) => panesOf(t).map((p) => [p.id, { p, tab: t.id }] as const)))
  const panesAfter = new Map(now.tabs.flatMap((t) => panesOf(t).map((p) => [p.id, { p, tab: t.id }] as const)))
  for (const [id] of before) if (!after.has(id)) out.push({ type: "tab-closed", tab: id })
  for (const [id, { i }] of after) {
    const b = before.get(id)
    if (!b) out.push({ type: "tab-opened", tab: id })
    // (only a tab whose neighbours changed: one opened before it shifts every index after)
    else if (b.i !== i && was.tabs[b.i - 1]?.id !== now.tabs[i - 1]?.id && was.tabs[b.i + 1]?.id !== now.tabs[i + 1]?.id) out.push({ type: "tab-moved", tab: id, at: i })
  }
  for (const [id, { tab }] of panesBefore) if (!panesAfter.has(id)) out.push({ type: "pane-closed", pane: id, tab })
  for (const [id, { p, tab }] of panesAfter) {
    const b = panesBefore.get(id)
    if (!b) out.push({ type: "pane-opened", pane: id, tab })
    else {
      if (b.tab !== tab) out.push({ type: "pane-moved", pane: id, tab, from: b.tab })
      if (b.p.to !== p.to) out.push({ type: "pane-changed", pane: id, tab, to: p.to })
    }
  }
  if (was.active !== now.active) out.push({ type: "tab-focused", tab: now.active, was: was.active || null })
  if (wasPane !== nowPane && nowPane) out.push({ type: "pane-focused", pane: nowPane, tab: now.active, was: wasPane || null })
  for (const e of out) for (const fn of subs) { try { fn(e) } catch (err) { console.error(err) } }
}
