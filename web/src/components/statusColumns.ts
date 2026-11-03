// The status bar's columns: the panes along the window's foot, each saying what's in it right under it (StatusBar.tsx).
import { useMemo, useSyncExternalStore } from "react"
import { paneBoxes } from "@/core/panemotion"
import { viewFor } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { getWorkspace, groups, onWorkspaceChange } from "@/core/workspace"
import { shownTab } from "../../../core/layout.ts"

/** A pane at the foot: its share of the workspace's width from `x`, and whether it's drawn edge to edge (a terminal),
 *  where nothing is drawn over its foot. */
export type Column = { group: string; x: number; w: number; full: boolean }
/** `focus`: the focused pane's column (its own, or the one it's over); `focused`: the focused pane. */
export type Columns = { cols: Column[]; focus: string | null; focused: string }

const r4 = (n: number) => Math.round(n * 1e4) / 1e4
const EDGE = 1e-4

/** As a string, so the bar is drawn again only when the columns change, not at every tab opened or divider step. */
function columnsKey() {
  const ws = getWorkspace(), all = groups(), disabled = getPrefs().disabled
  const boxes = paneBoxes(ws)
  // (zoomed, one pane fills the workspace; floating ones are over it, not along its foot)
  const tiled = ws.zoom ? boxes.filter((b) => b.id === ws.zoom) : boxes.filter((b) => !b.round)
  const foot = tiled.filter((b) => b.rect.y + b.rect.h > 1 - EDGE).sort((a, b) => a.rect.x - b.rect.x)
  const full = (id: string) => {
    const to = (() => { const g = all.find((x) => x.id === id); return g && (shownTab(g) ?? g.tabs[0])?.to })() ?? ""
    return to.startsWith("view:") && !!viewFor(to, disabled)?.def.full
  }
  // The focused pane's column: its own, or the one under its middle (a pane above another, a floating one).
  const f = boxes.find((b) => b.id === ws.focus), mid = f ? f.rect.x + f.rect.w / 2 : -1
  const focus = foot.find((b) => b.id === ws.focus) ?? foot.find((b) => b.rect.x - EDGE <= mid && mid <= b.rect.x + b.rect.w + EDGE)
  return JSON.stringify({ cols: foot.map((b) => [b.id, r4(b.rect.x), r4(b.rect.w), full(b.id) ? 1 : 0]), focus: focus?.id ?? null, focused: ws.focus })
}

/** The panes along the window's foot, left to right, and the focused pane's column. */
export function useColumns(): Columns {
  // (prefs: a plugin turned off may stop a view filling its pane; StatusBar is drawn again for them)
  const key = useSyncExternalStore(onWorkspaceChange, columnsKey)
  return useMemo(() => {
    const { cols, focus, focused } = JSON.parse(key) as { cols: [string, number, number, number][]; focus: string | null; focused: string }
    return { cols: cols.map(([group, x, w, full]) => ({ group, x, w, full: !!full })), focus, focused }
  }, [key])
}

/** The workspace's width (between the sidebars), and with each tiled pane's gap (index.css' --pane-gap) taken. */
const W = "(100vw - var(--left-sidebar, 0px) - var(--right-sidebar, 0px))", G = "var(--pane-gap, 0px)"
/** Where a column's pane ends, from the window's right (Workspace.tsx' tile(): a pane is a gap in from its share). */
export const columnRight = (c: Column) => (c.x + c.w > 1 - EDGE ? "var(--right-sidebar, 0px)" : `calc(var(--right-sidebar, 0px) + ${W} - ${c.x + c.w} * (${W} - ${G}))`)
/** A column's pane's width, less each of `less` (CSS lengths). */
export const columnWidth = (c: Column, ...less: string[]) => `calc(${c.w} * (${W} - ${G})${less.map((l) => ` - ${l}`).join("")})`
/** Where a column's pane starts, from the window's left. */
export const columnLeft = (c: Column) => (c.x < EDGE ? "var(--left-sidebar, 0px)" : `calc(var(--left-sidebar, 0px) + ${c.x} * (${W} - ${G}) + ${G})`)
