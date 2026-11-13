import { backDetail, currentRow, moveInList, detailPath, getStore, haptic, replaceDetail, typingIn } from "@vaultite"
import { focusedTarget, getEvents, markRead, markUnread, SESSION_DETAIL, snoozable } from "./events"
import { snoozed } from "./snooze"
import { reviewing } from "./threads"
import { waiting, listsOf, SELECT, resultKey, eventKey, markDone, pinKeys, markManyEventsDone, reopen } from "./items"
import { snoozeAtRow, snoozeKeys } from "./Snoozing"

function keyedRow() {
  const row = currentRow()?.closest<HTMLElement>("[data-select-key]")
  return row?.closest(`[data-select-list="${SELECT}"]`) ? row : null
}
export const keysOnInbox = () => !!keyedRow() || (focusedTarget() === "view:inbox" && !typingIn(document.activeElement) && !document.activeElement?.closest("[data-sidebar-body]"))
const rowsAround = (from: Element | null) => {
  const scope = from?.closest(`[data-select-list="${SELECT}"]`) ?? document.querySelector(`[data-inbox-view] [data-select-list="${SELECT}"]`)
  return scope ? [...scope.querySelectorAll<HTMLElement>("[data-select-key]")].filter((r) => r.getClientRects().length > 0 && !!keyOf(r)) : []
}
const keyOf = (row: HTMLElement) => (row.matches("[data-keyrow]") ? row : row.querySelector<HTMLElement>("[data-keyrow]"))

export function stepRow(by: 1 | -1) {
  if (keyedRow()) return moveInList(by)
  const first = rowsAround(null)[0]
  if (first) { keyOf(first)?.focus({ preventScroll: true }); first.scrollIntoView({ block: "nearest" }) }
  return true
}

function onRow(act: (key: string, row: HTMLElement) => void, leaves = true) {
  const row = keyedRow()
  if (!row) return
  const key = row.dataset.selectKey!
  const rows = rowsAround(row), i = rows.indexOf(row), list = row.closest(`[data-select-list="${SELECT}"]`)
  const next = leaves ? (rows[i + 1] ?? rows[i - 1])?.dataset.selectKey : undefined
  act(key, row)
  if (!next) return
  requestAnimationFrame(() => {
    const to = list?.querySelector<HTMLElement>(`[data-select-key="${CSS.escape(next)}"]`)
    if (to) keyOf(to)?.focus({ preventScroll: true })
  })
}
const resultOf = (key: string) => (getStore()?.inbox ?? []).find((r) => resultKey(r) === key)
const eventOf = (key: string) => getEvents().events.find((e) => eventKey(e) === key)

export const doneByKey = () => onRow((key) => {
  const r = resultOf(key), e = eventOf(key)
  haptic("medium")
  if (r) void (reviewing(r) ? markDone(r) : reopen(r))
  else if (e) markManyEventsDone([e], e.state !== "done")
})
export const snoozeByKey = () => onRow((key, row) => {
  const r = resultOf(key), e = eventOf(key)
  if (r ? snoozed(r.snoozed) : e ? snoozed(e.snoozed) : false) return snoozeKeys([key], null)
  if (r ? waiting(r) : e ? snoozable(e) : false) snoozeAtRow([key])(row.getBoundingClientRect())
}, false)
export const replyByKey = () => onRow((_, row) => row.querySelector<HTMLButtonElement>("[data-row-reply-button]")?.click(), false)

function sheetOn() {
  const s = [...document.querySelectorAll<HTMLElement>("[data-session-sheet]")].find((x) => x.getClientRects().length > 0)
  return s && !typingIn(document.activeElement) ? s : null
}
export const keysOnThreads = () => !!sheetOn() || keysOnInbox()
export const byKey = (row: () => unknown, sheet: (s: HTMLElement, id: string) => unknown) => () => {
  const s = sheetOn()
  return s ? sheet(s, s.dataset.sessionSheet!) : row()
}
export function stepSheet(id: string, by: 1 | -1) {
  const all = sessionsInOrder()
  const i = all.findIndex((e) => e.id === id)
  const to = i < 0 ? all[0] : all[i + by]
  if (to && to.id !== id) replaceDetail(detailPath(SESSION_DETAIL, to.id))
}
const sessionsInOrder = (working = true) => {
  const l = listsOf(getStore())
  return [...l.pinned.events, ...l.needs, ...(working ? l.working : []), ...l.messages].filter((e) => e.kind === "session")
}
export function leaveSheet(id: string) {
  const all = sessionsInOrder(false), i = all.findIndex((e) => e.id === id)
  const to = i < 0 ? undefined : all[i + 1] ?? all[i - 1]
  if (to) replaceDetail(detailPath(SESSION_DETAIL, to.id)); else backDetail()
}
export const press = (s: HTMLElement, sel: string) => s.querySelector<HTMLElement>(sel)?.click()

export const pinByKey = () => onRow((key) => {
  const r = resultOf(key), e = eventOf(key)
  pinKeys([key], !(r?.pinned ?? e?.pinned))
}, false)
export const readByKey = (read: boolean) => onRow((key) => {
  const e = eventOf(key)
  if (!e) return
  if (read) markRead([e.id]); else markUnread([e.id])
}, false)
