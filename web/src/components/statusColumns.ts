import { useMemo, useSyncExternalStore } from "react"
import { paneBoxes } from "@/core/panemotion"
import { viewFor } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import { activeTab, onWorkspaceChange, paneById } from "@/core/workspace"

export type Column = { pane: string; x: number; w: number; full: boolean }
export type Columns = { cols: Column[]; focus: string | null; focused: string }

const r4 = (n: number) => Math.round(n * 1e4) / 1e4
const EDGE = 1e-4

function columnsKey() {
  const t = activeTab(), disabled = getPrefs().disabled
  const boxes = paneBoxes(t)
  const tiled = t.zoom ? boxes.filter((b) => b.id === t.zoom) : boxes.filter((b) => !b.round)
  const foot = tiled.filter((b) => b.rect.y + b.rect.h > 1 - EDGE).sort((a, b) => a.rect.x - b.rect.x)
  const full = (id: string) => {
    const to = paneById(id)?.to ?? ""
    return to.startsWith("view:") && !!viewFor(to, disabled)?.def.full
  }
  const f = boxes.find((b) => b.id === t.focus), mid = f ? f.rect.x + f.rect.w / 2 : -1
  const focus = foot.find((b) => b.id === t.focus) ?? foot.find((b) => b.rect.x - EDGE <= mid && mid <= b.rect.x + b.rect.w + EDGE)
  return JSON.stringify({ cols: foot.map((b) => [b.id, r4(b.rect.x), r4(b.rect.w), full(b.id) ? 1 : 0]), focus: focus?.id ?? null, focused: t.focus })
}

export function useColumns(): Columns {
  const key = useSyncExternalStore(onWorkspaceChange, columnsKey)
  return useMemo(() => {
    const { cols, focus, focused } = JSON.parse(key) as { cols: [string, number, number, number][]; focus: string | null; focused: string }
    return { cols: cols.map(([pane, x, w, full]) => ({ pane, x, w, full: !!full })), focus, focused }
  }, [key])
}

const W = "(100vw - var(--left-sidebar, 0px) - var(--right-sidebar, 0px))", G = "var(--pane-gap, 0px)"
export const columnRight = (c: Column) => (c.x + c.w > 1 - EDGE ? `calc(var(--right-sidebar, 0px) + ${G})` : `calc(var(--right-sidebar, 0px) + ${W} - ${c.x + c.w} * (${W} - ${G}))`)
export const columnWidth = (c: Column, ...less: string[]) => `calc(${c.w} * (${W} - ${G})${less.map((l) => ` - ${l}`).join("")})`
export const columnLeft = (c: Column) => (c.x < EDGE ? `calc(var(--left-sidebar, 0px) + ${G})` : `calc(var(--left-sidebar, 0px) + ${c.x} * (${W} - ${G}) + ${G})`)
