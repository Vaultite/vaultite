import { useSyncExternalStore } from "react"
import { Clock, Pin, PinOff, CircleCheck, Undo2 } from "lucide-react"
import { activePane, notify, openView, scopedState, subscribeScoped, type AgentRun, type MenuItem } from "@vaultite"
import { canSettle, isSettled, isSnoozed, keptMarks, nextNeeding, withMark, type Marks } from "./shelves"

const NONE: Marks = {}
const make = () => scopedState<Marks>("agents:marks", NONE, "workspace")
let kept: ReturnType<typeof make> | undefined
const state = () => (kept ??= make())
export const marksNow = (): Marks => state().get() ?? NONE
export const useMarks = () => useSyncExternalStore(subscribeScoped, marksNow)

let listed: AgentRun[] = [], needing: AgentRun[] = []
export function showing(all: AgentRun[], needs: AgentRun[]) { listed = all; needing = needs }
export const currentRun = (): AgentRun | undefined => { const to = activePane().to; return listed.find((r) => r.to === to) }

function save(next: Marks) {
  state().set(keptMarks(next, new Set(listed.map((r) => r.id)), Date.now()))
}
function change(r: AgentRun, said: string, patch: Parameters<typeof withMark>[2]) {
  const before = marksNow()
  save(withMark(before, r.id, patch))
  notify(`${said} “${r.title}”`, { action: { label: "Undo", run: () => save(withMark(marksNow(), r.id, { pinned: null, snoozed: null, settled: null, ...before[r.id] })) } })
}

export function pin(r: AgentRun) {
  const on = !marksNow()[r.id]?.pinned
  change(r, on ? "Pinned" : "Unpinned", { pinned: on, settled: null })
}
export const snooze = (r: AgentRun, until: number | null) => change(r, until ? "Snoozed" : "Woke", until ? { snoozed: until, pinned: null } : { snoozed: null })

export function settle(r: AgentRun): boolean {
  if (!canSettle(r)) { notify(r.state === "needs" ? `“${r.title}” is waiting on you` : `“${r.title}” is still working`); return false }
  change(r, "Settled", { settled: Math.max(Date.now(), r.at, r.since ?? 0), pinned: null, snoozed: null })
  return true
}

export function settleAndNext(r = currentRun()) {
  if (!r) return
  const next = nextNeeding(needing, r.id), here = !!r.to && activePane().to === r.to
  if (!settle(r) || !here || !next) return
  if (next.to) openView(next.to, { stage: true })
  else next.open?.(false)
}

const HOUR = 3600_000
function tomorrow(now = new Date()) {
  const d = new Date(now)
  d.setDate(d.getDate() + 1)
  d.setHours(9, 0, 0, 0)
  return d.getTime()
}

export function markItems(r: AgentRun, marks: Marks, now = Date.now()): MenuItem[] {
  const m = marks[r.id]
  const snoozes: MenuItem[] = isSnoozed(m, now) ? [{ label: "Stop snoozing", icon: Undo2, run: () => snooze(r, null) }] : [{ label: "Snooze", icon: Clock, run: () => {}, items: [
    { label: "For an hour", run: () => snooze(r, Date.now() + HOUR) },
    { label: "For 3 hours", run: () => snooze(r, Date.now() + 3 * HOUR) },
    { label: "Until tomorrow", run: () => snooze(r, tomorrow()) },
  ] }]
  return [
    { label: m?.pinned ? "Unpin" : "Pin", icon: m?.pinned ? PinOff : Pin, keysOf: "agents:pin", run: () => pin(r) },
    ...snoozes,
    isSettled(r, m) ? { label: "Unsettle", icon: Undo2, run: () => change(r, "Unsettled", { settled: null }) }
      : { label: "Settle", icon: CircleCheck, disabled: !canSettle(r), run: () => settle(r) },
  ]
}
