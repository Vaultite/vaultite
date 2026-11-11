// The agents over the whole app: each one's cursor gliding to where its attention is (fading where it was when it's
// nowhere), its words in a bubble by it (on a drawing: canvas.ts; a phone: Phone.tsx), its comments in the margin.
import { memo, useEffect, useLayoutEffect, useReducer, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, ChevronUp, Copy, Ellipsis, MessageSquarePlus, Pin, TextCursorInput, Trash2, UserRound, X } from "lucide-react"
import { canvasOf, canvasShown, cn, CURSOR_SPRING, springStep, type Glide, stiffness, moves, selectTab, getTabLayout, tabOfPane, commandKeys, confirmDialog, copyText, dateText, dismissNotice, fmtStamp, fmtTime, haptic, keyHint, Markdown, menuBelow, menuFor, type MenuItem, noticesSince, notify, notifyError, op, openFile, plural, runCommandById, dictationSource, seenArea, share, snippet, useDictation, useMenuShowing } from "@vaultite"
import type { EditorView } from "@codemirror/view"
import { pointFor } from "./canvas"
import { domTree, resolveDom, uiElement } from "./uidom"
import type { Thing } from "./uimodel"
import { accept, type Agent, answer, answered, arrivedAt, authorOf, comment, getState, type Target, type Note, onBump, pick, pin, type Reply, replyAuthor, review, sawSays, sendMoment, sawShown, startComment, subscribe, threadTint, tintOf, typing, viewOf, views } from "./live"
import { arrowBox, boxAt } from "./boxes"
import { interfaceZoom, onTop, type Screen, screenOf } from "./locate"
import { Chat } from "./Chat"
import { presence, STATUS } from "./look"
import { agentMenu } from "./session"
import { changeAt, nearest } from "./text"
import { showThread, useInMargin } from "./threads"
import { PhoneLayer, usePhone } from "./Phone"

/** What the user wrote to an agent couldn't go (no connection): it stays where they wrote it, and this says so. */
export const unsent = () => { notify("Couldn't send it: not connected to the server. Try again in a moment", { kind: "error", id: "companion-unsent" }) }

/** low: too near the bottom of where it's drawn for its flag below it (the flag goes above); drawn: the canvas draws it;
 *  docked: resting, faded out where it last was. */
type Spot = { x: number; y: number; parked?: boolean; low?: boolean; drawn?: boolean; docked?: boolean; rides?: boolean
  /** Out on the screen (another app's window): the desktop helper draws it there, so here it hides at once, where it was. */
  away?: boolean
  /** Over a web page: drawn over it (the window rises over the page for it, layers.ts' floats). */
  over?: boolean
  /** Where it was last drawn, no longer where its place is (home()'s fallback): it fades out there, never shows. */
  faded?: boolean
  /** Its place is scrolled out of view: drawn at the edge nearest it ("up there"). */
  out?: boolean
  /** What it points at (an element of the app, a terminal's row, a page's element): its words never cover it. */
  target?: { x: number; y: number; width: number; height: number } }
/** A cursor's place as drawn: what it looked at, its place among them, its step in a stack; held, it stays there (dx, dy
 *  from it, or `screen`: a point of the window); `left`: the user put it there, until its agent looks elsewhere. */
type Place = { at: Target & Pick<Agent, "box">; i: number; shift: number; dx: number; dy: number; screen?: { x: number; y: number; over: boolean }; left?: Left }
/** Where the user left a cursor: its agent's place as last seen (`last`), and until when its place may still change to
 *  what it was dropped on (the point's echo from the server) without taking it away. */
type Left = { last: string; echo: number }
const placeOf = (a: Partial<Agent>): Place["at"] => ({ path: a.path, line: a.line, find: a.find, x: a.x, y: a.y, pane: a.pane, ui: a.ui, row: a.row, el: a.el, box: a.box })
const placeKey = (a: Agent) => JSON.stringify(placeOf(a))
const FLAG = 44 // the arrow and its flag below it
const MARGIN = 228 // a card's width and its gaps: less room than this beside the text and it folds to a dot
export const cut = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
/** The card of a comment being written (live.ts Draft). */
const DRAFT = "draft"

/** A target's position in its editor, or null when the text is gone. */
export function posIn(v: EditorView, t: { line?: number; find?: string }) {
  const doc = v.state.doc
  if (t.find) { const i = nearest(doc.toString(), t.find, t.line); if (i >= 0) return i }
  return t.line ? doc.line(Math.max(1, Math.min(t.line, doc.lines))).from : null
}

/** Put the cursor of note `n`'s editor on its next (or previous) change, scrolled to the middle. */
function stepTo(n: Note, dir: 1 | -1) {
  const v = n.path ? viewOf(n.path) : null
  if (!v) return
  const text = v.state.doc.toString(), head = v.state.selection.main.head
  const at = (n.changes ?? []).filter((c) => !c.intent && !c.stale).map((c) => changeAt(text, c)).filter((i) => i >= 0).map((i) => v.state.doc.lineAt(i).from).sort((a, b) => a - b)
  if (!at.length) return
  const to = dir > 0 ? at.find((x) => x > head) ?? at[0] : [...at].reverse().find((x) => x < head) ?? at[at.length - 1]
  v.dispatch({ selection: { anchor: to }, scrollIntoView: true })
  v.focus()
}

/** What a proposal's card says it is: writing (only placeholders yet), or proposing. */
const proposes = (n: Note) => ((n.changes ?? []).some((c) => !c.intent) ? "proposes" : "is writing")

/** Where on screen `pos` of `v` is, kept inside its scroller (a cursor at an edge says "up there"); `side` -1: at a
 *  wrapped line's break, the end of the row before. */
export function coords(v: EditorView, pos: number, side: -1 | 1 = 1) {
  const r = (v.dom.closest("[data-pane]") ?? v.scrollDOM).getBoundingClientRect()
  // (what of it shows: above the status bar or a phone's bar, drawn over its foot)
  const bars = [...document.querySelectorAll("[data-status-bar], [data-phone-bar]")].map((el) => el.getBoundingClientRect()).filter((b) => b.height && b.left < r.right && b.right > r.left)
  const k = seenArea(v.dom)
  const box = { left: Math.max(r.left, k.left), right: Math.min(r.right, k.right), top: Math.max(r.top, k.top), bottom: Math.min(r.bottom, k.bottom, ...bars.map((b) => b.top)) }
  let c: { left: number; top: number; bottom: number } | null = null
  try { c = v.coordsAtPos(pos, side) } catch { /* outside the drawn part */ }
  const y = c ? c.top : pos < v.viewport.from ? box.top : box.bottom
  return { x: c ? c.left : box.left + 24, y: Math.max(box.top + 2, Math.min(box.bottom - 30, y)), shown: !!c && c.top >= box.top - 4 && c.bottom <= box.bottom + 4, box }
}

/** A file that isn't open: its row in the file tree, a copy in view before one scrolled away (or pinned). Out of its
 *  list, the cursor sits at the list's edge on that side ("up there"), never over what's beside the list. */
function rowOf(path: string): Spot | null {
  const rows = [...document.querySelectorAll<HTMLElement>(`[data-tree-path="${CSS.escape(path)}"]`)].filter((e) => e.offsetParent && e.getBoundingClientRect().height)
  const seen = (e: HTMLElement) => { const r = e.getBoundingClientRect(), c = seenArea(e); return r.bottom > c.top && r.top < c.bottom && r.right > c.left && r.left < c.right }
  const el = rows.find(seen) ?? rows.find((e) => !e.closest("[data-pin-tree]")) ?? rows[0]
  if (!el) return null
  const r = el.getBoundingClientRect(), c = seenArea(el)
  // (scrolled out of sight inside a folder, whose own clip is then past the list's: the list's edge)
  if (c.bottom - c.top < 12) {
    let s = el.parentElement
    while (s && !(s.scrollHeight > s.clientHeight + 4 && /auto|scroll/.test(getComputedStyle(s).overflowY))) s = s.parentElement
    const list = s && seenArea(s), b = s?.getBoundingClientRect()
    if (list && b) Object.assign(c, { top: Math.max(list.top, b.top), bottom: Math.min(list.bottom, b.bottom) })
  }
  if (c.bottom - c.top < 12 || c.right - c.left < 12) return null
  const x = Math.max(c.left + 4, Math.min(c.right - 24, r.left + Math.min(r.width - 24, 120)))
  const y = Math.max(c.top + 2, Math.min(c.bottom - 24, r.top + 4))
  // (on a hidden sidebar slid in, it rides over it, as the sidebar's toggle does; the rest stay under it with the page)
  return { x, y, low: y + FLAG > Math.min(c.bottom, innerHeight - 40), rides: !!el.closest("aside[data-peek]") || undefined, out: !seen(el) || undefined }
}

/** Where each cursor was last shown, for one with nowhere to be to fade there. */
const lastShown = new Map<string, Spot>()
/** Where an agent with nowhere to be rests: it fades out where it last was, never gliding off to the status bar or a
 *  corner, and never shows there again: that spot may be minutes old. */
function home(a: Agent, _i: number): Spot | null {
  const was = lastShown.get(a.name)
  return was ? { ...was, parked: true, docked: true, faded: true } : null
}
/** How long an agent's cursor stays where it last acted, idle, before it fades. */
const IDLE_MS = 8000

/** The end of the row `pos` is on (a long line wraps into several), at most `to`. */
function rowEnd(v: EditorView, pos: number, to: number) {
  let c: { top: number; bottom: number } | null = null
  try { c = v.coordsAtPos(pos, -1) } catch { /* outside the drawn part */ }
  if (!c) return to
  return Math.max(pos, Math.min(to, v.posAtCoords({ x: v.contentDOM.getBoundingClientRect().right - 1, y: (c.top + c.bottom) / 2 }, false)))
}

/** Where its cursor goes: where it types, else past the end of the row what it looks at ends on (off the text and the
 *  caret), else home. Never by focus or what it says: it moves with its attention. `held`: Overlay's holds. */
function spotOf(a: Agent, i: number, held = false): Spot | null {
  if (a.state === "away") return null
  const canvas = a.path ? canvasOf(a.path) : null
  if (canvas && canvasShown(canvas)) {
    const p = canvas.toScreen(pointFor(canvas, a)), r = canvas.el.getBoundingClientRect()
    return { x: Math.max(r.left + 4, Math.min(r.right - 24, p.x)), y: Math.max(r.top + 4, Math.min(r.bottom - 24, p.y)), drawn: true }
  }
  if (!held && typing && typing.agent === a.name && typing.view.dom.isConnected) {
    const c = coords(typing.view, Math.min(typing.pos, typing.view.state.doc.length))
    return { x: c.x, y: c.y, low: c.y + FLAG > c.box.bottom }
  }
  if (!a.path && (a.ui || a.pane)) { const at = a.ui ? uiSpot(a.ui, a.find) : paneSpot(a); if (at) return at }
  const v = a.path ? viewOf(a.path) : null
  const pos = v ? posIn(v, a) : null
  if (!v || pos === null) return (a.path && rowOf(a.path)) || home(a, i)
  const line = v.state.doc.lineAt(pos)
  const c = coords(v, a.find ? rowEnd(v, Math.min(line.to, pos + a.find.length), line.to) : line.to, -1)
  return { x: Math.min(c.box.right - 40, c.x + 28), y: c.y, low: c.y + FLAG > c.box.bottom, out: !c.shown || undefined }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const rectOf = (r: { left: number; top: number; width: number; height: number }) => ({ x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) })
/** A cursor the user left off the text: that point of the window, kept inside it. */
const screenSpot = (p: { x: number; y: number; over: boolean }): Spot => {
  const x = clamp(p.x, 4, innerWidth - 24), y = clamp(p.y, 4, innerHeight - 24)
  return { x, y, low: y + FLAG > innerHeight - 40, over: p.over || undefined }
}
/** Pointing at the app's own UI: the arrow's tip on the element, a little in from its left. */
function atElement(el: HTMLElement): Spot {
  const r = el.getBoundingClientRect(), x = r.left + Math.min(r.width * 0.6, Math.max(4, r.width - 6)), y = r.top + r.height * 0.6
  return { x, y, low: y + FLAG > innerHeight - 40, rides: !!el.closest("aside[data-peek]") || undefined, target: rectOf(r) }
}
/** What `find` found in a ui last (a walk of its text, once, not on every frame). */
const found = new Map<string, HTMLElement>()
const uiSpot = (id: string, find?: string) => {
  const el = uiElement(id)
  if (!el || !find) return el ? atElement(el) : null
  const k = `${id}\0${find}`, was = found.get(k), at = was?.isConnected && el.contains(was) ? was : (resolveDom({ name: find }, undefined, el)?.e as HTMLElement | undefined) ?? null
  if (at) { found.clear(); found.set(k, at) }
  return atElement(at ?? el)
}

/** The row (from 1) a place names on a screen: its row, else the last showing its text, else the last written. */
function rowIn(s: Screen, t: { row?: number; find?: string }) {
  if (t.row) return clamp(t.row, 1, s.lines.length)
  const found = t.find ? s.lines.findLastIndex((l) => l.includes(t.find!)) : -1
  if (found >= 0) return found + 1
  return Math.max(1, s.lines.findLastIndex((l) => l.trim()) + 1)
}
/** The box a pane's place takes on screen: a terminal's row (`find`: its text), a page's element, else the pane. */
function paneBox(t: Target & Pick<Agent, "box">): (DOMRect | { left: number; top: number; right: number; bottom: number; width: number; height: number }) & { over?: boolean; row?: Screen } | null {
  const el = t.pane ? paneEl(t.pane) : null
  if (!el) return null
  const scr = screenOf(el)
  if (scr) { const row = rowIn(scr, t), top = scr.r.top + (row - 1) * scr.rowH, w = Math.max(scr.cw * 2, (scr.lines[row - 1]?.trimEnd().length ?? 0) * scr.cw)
    return { left: scr.r.left, top, right: scr.r.left + w, bottom: top + scr.rowH, width: w, height: scr.rowH, row: scr } }
  const page = el.querySelector<HTMLElement>("[data-web-box]")
  if (page) {
    // (a page's CSS px is its zoom in screen points, the app's own CSS px its interface size)
    const b = page.getBoundingClientRect(), z = (t.box?.zoom ?? 1) / interfaceZoom()
    if (!t.box) return Object.assign(b, { over: true })
    const left = b.left + t.box.x * z, top = b.top + t.box.y * z, width = t.box.w * z, height = t.box.h * z
    return { left, top, right: left + width, bottom: top + height, width, height, over: true }
  }
  return el.getBoundingClientRect()
}
/** A pane as drawn, not its half of a split tab's row or its row in a list, which say data-ui pane: too. */
function paneEl(id: string) {
  return [...document.querySelectorAll<HTMLElement>(`[data-ui="${CSS.escape(`pane:${id}`)}"]`)].find((e) => !e.matches("[data-pane-half], [data-place], [data-tab-row]") && e.getClientRects().length > 0) ?? null
}
/** A pane not shown: its half of its tab's row (a split's), else its tab. */
function tabSpot(pane: string): Spot | null {
  const half = [...document.querySelectorAll<HTMLElement>(`[data-pane-half="${CSS.escape(pane)}"]`)].find((e) => e.getClientRects().length > 0)
  if (half) return atElement(half)
  const tab = tabOfPane(getTabLayout(), pane)
  return tab ? uiSpot(`tab:${tab.id}`) : null
}
/** Where its cursor is in a pane: past a terminal row's text, by a page's element (over the page), else the pane's corner;
 *  a pane not shown, at its tab. */
function paneSpot(a: Agent): Spot | null {
  const el = paneEl(a.pane!)
  if (!el) return tabSpot(a.pane!)
  const r = el.getBoundingClientRect(), b = paneBox(a)
  if (!b) return null
  const whole = b.width === r.width && b.height === r.height && !b.row
  const x = whole || (b.over && !a.box) ? r.left + 40 : b.right + (b.row ? 10 : 6), y = whole || (b.over && !a.box) ? r.top + 48 : b.top
  return { x: clamp(x, r.left + 4, r.right - 40), y: clamp(y, r.top + 2, r.bottom - 30), low: y + FLAG > r.bottom, over: b.over, ...(whole ? {} : { target: rectOf(b) }) }
}

/** An agent's arrow: its cursor (20px), and smaller its place in the status bar. */
export function Arrow({ tint, size = 20, className, ...rest }: { tint?: string; size?: number; className?: string } & React.SVGProps<SVGSVGElement>) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" className={className ?? "drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]"} {...rest}>
      <path d="M3 2.5 L16.5 9.2 L10.3 10.9 L7.6 16.8 Z" fill={tint ?? "none"} stroke={tint ? "white" : "currentColor"} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  )
}

// (CodeMirror's own scrolling, through the view's class: no CodeMirror in this chunk)
export const scroller = (v: EditorView, pos: number) => v.dispatch({ effects: (v.constructor as typeof EditorView).scrollIntoView(pos, { y: "center" }) })
/** Go where an agent is (its flag, its face in the status bar): its note opened, scrolled to its line. */
export function follow(a: Target & { name: string }) {
  if (!a.path && a.pane) return void selectTab(a.pane)
  if (!a.path && a.ui) return void uiElement(a.ui)?.scrollIntoView({ block: "nearest" })
  if (!a.path) return notify(`${a.name} isn't in a note now`)
  const path = a.path, go = () => {
    const v = viewOf(path)
    if (!v) return false
    scroller(v, posIn(v, { find: a.find, line: a.line || 1 })!)
    return true
  }
  if (go()) return
  openFile(path)
  let n = 0
  const t = setInterval(() => { if (go() || ++n > 40) clearInterval(t) }, 100)
}

/** Approve or Deny what its session asks: a chat session's in the chat (`chat:<id>`), a terminal's through its inbox event. */
export const answerAsk = (event: string, v: "approve" | "deny") => (event.startsWith("chat:")
  ? op("claude-code.chat-answer", { id: event.slice(5), allow: v === "approve" }) : op("inbox.answer", { id: event, answer: v }))

/** A note's line at x, y (the word there, or the selection when it's on one); null off a note's text. */
function noteAt(x: number, y: number): (Target & { path: string; line: number; selection?: string }) | null {
  const el = document.elementsFromPoint(x, y).find((e) => !e.closest(".companion-overlay") && e.closest(".cm-editor"))
  const v = el ? [...views.keys()].find((x) => x.dom === el.closest(".cm-editor")) : undefined
  const pos = v?.posAtCoords({ x, y })
  if (!v || pos === null || pos === undefined) return null
  const st = v.state, sel = st.selection.main, on = !sel.empty && pos >= sel.from && pos <= sel.to
  const word = on ? null : st.wordAt(pos), selection = on ? st.sliceDoc(sel.from, sel.to) : undefined
  const find = on ? selection!.split("\n")[0].slice(0, 200) : word ? st.sliceDoc(word.from, word.to) : undefined
  return { path: views.get(v)!, line: st.doc.lineAt(on ? sel.from : pos).number, find: find || undefined, ...(selection ? { selection } : {}) }
}

/** What's at x, y off a note's text: a pane (a terminal's row, a point of a page, a view) or the app's UI (a tab, a tab
 *  group, a panel, a button), with its words; null on nothing it knows. */
type PanePlace = { pane?: string; ui?: string; row?: number; x?: number; y?: number; text?: string; title?: string }
function paneAt(x: number, y: number): PanePlace | null {
  const hit = document.elementsFromPoint(x, y).filter((e) => !e.closest(".companion-overlay")).map((e) => e.closest<HTMLElement>("[data-ui]")).find(Boolean)
  // (a half of a split tab's row or chip: the whole tab)
  const el = hit?.dataset.ui?.startsWith("pane:") ? hit.parentElement?.closest<HTMLElement>('[data-ui^="tab:"]') ?? hit : hit
  const id = el?.dataset.ui
  if (!el || !id) return null
  const words = (e: HTMLElement) => (e.innerText || "").trim().slice(0, 1200) || undefined
  if (!id.startsWith("pane:")) return { ui: id, text: words(el), title: el.getAttribute("aria-label") ?? el.dataset.heading ?? undefined }
  const pane = id.slice(5), scr = screenOf(el)
  if (scr) { const row = clamp(Math.floor((y - scr.r.top) / scr.rowH) + 1, 1, scr.lines.length); return { pane, row, text: scr.lines[row - 1]?.trim() || undefined } }
  const page = el.querySelector<HTMLElement>("[data-web-box]")?.getBoundingClientRect()
  if (page) return { pane, x: Math.round(x - page.left), y: Math.round(y - page.top) }
  return { pane, text: words(el) }
}
/** Put a bubble in the note, as its agent's words; it goes from the screen once it's there. */
const placeSay = (id: string) => op("companion.place", { id }).catch((e) => notifyError(e, "Couldn't put it in the note"))

const ICON = "grid size-6 shrink-0 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground [@media(pointer:coarse)]:size-9"

/** A bubble's or a past say's buttons: Put in note, Pin as a comment (once each). */
export function SayActions({ n, small }: { n: Note; small?: boolean }) {
  const icon = small ? "size-3" : "size-3.5"
  return <>
    {n.placed ? <TextCursorInput className={cn(icon, "m-1.5 shrink-0 text-muted-foreground")} aria-label="In the note" />
      : <button type="button" aria-label="Put in note" data-tip="Put in note" className={ICON} onClick={(e) => { e.stopPropagation(); void placeSay(n.id) }}><TextCursorInput className={icon} /></button>}
    {n.pinned ? <Pin className={cn(icon, "m-1.5 shrink-0 text-muted-foreground")} aria-label="Pinned" />
      : <button type="button" aria-label="Pin as a comment" data-tip="Pin as a comment" className={ICON} onClick={(e) => { e.stopPropagation(); pin(n.id) }}><Pin className={icon} /></button>}
  </>
}

/** Its last words (each can be put in the note or pinned into a comment) above a box to ask it something, there. Never
 *  opened by a Talk key: that companion comes over the screen (electron/helper.ts). */
export function Popover({ a, close, menu, phone }: { a: Agent; close: () => void; menu: (e: React.MouseEvent) => void
  /** A phone's: a card across the bottom, its box not taking the keyboard till tapped. */
  phone?: boolean }) {
  const s = useSyncExternalStore(subscribe, getState)
  const [draft, setDraft] = useState("")
  const mine = s.said.filter((n) => n.agent === a.name)
  // (its history open: all of it seen)
  useEffect(() => { sawSays(mine.map((n) => n.id)) }, [mine.length])
  const send = () => {
    const text = draft.trim()
    if (!text) return
    const v = a.path ? viewOf(a.path) : null, pos = v ? posIn(v, a) : null
    if (!sendMoment({ kind: "ask", agent: a.name, path: a.path, line: v && pos !== null ? v.state.doc.lineAt(pos).number : a.line, text })) return unsent()
    close()
  }
  return (
    <Chat name={a.name} tint={tintOf(a.name)} items={mine} draft={draft} setDraft={setDraft} send={send} close={close} more={(e) => { close(); menu(e) }}
      words={(n) => <Markdown text={n.text ?? ""} className="companion-md" />} time={(t) => fmtTime(new Date(t).toISOString())} actions={(n) => <SayActions n={n as Note} />}
      busy={a.state === "thinking" || a.state === "reading"} focus={!phone && !coarse.matches} phone={phone} className={phone ? "pointer-events-auto" : "pointer-events-auto absolute top-0 left-0"}
      style={phone ? { width: "100%", maxWidth: "none" } : undefined} />
  )
}

/** What's at x, y of the window as a Talk key's ask over it says it (electron/helper.ts asks): a note's line (its word or
 *  selection), a pane's row or point (the words under the pointer as `under`), the app's UI; nothing known there, null. */
export function placeAt(x: number, y: number): Record<string, unknown> | null {
  // (the toasts of the last minute: one they point at may be gone by the time they let go)
  const told = noticesText(), notices = told ? { notices: told } : {}
  const at = noteAt(x, y) ?? paneAt(x, y)
  if (!at) return told ? notices : null
  if ("path" in at && at.path) {
    const near = landmarks(x, y, new Set())
    return { path: at.path, line: at.line, ...(at.find ? { find: at.find } : {}), ...(at.selection ? { selection: at.selection } : {}), ...(near.length ? { near } : {}), ...notices }
  }
  const { text, ...p } = at as PanePlace, near = elementsNear(x, y)
  return { ...p, ...(text ? { under: text } : {}), ...(near.length ? { near } : {}), ...notices }
}

/** What the window draws near x, y that a mark can name, nearest first, as things (uimodel.ts; frame in CSS px): the
 *  ids an ask over Vaultite's UI points at, as Accessibility's are in another app. */
const NAMED = "button, a[href], input, select, textarea, h1, h2, h3, h4, [role], [data-ui], [aria-label], [data-tip]"
export function elementsNear(x: number, y: number, radius = 260, most = 30): Thing[] {
  const seen = new Set<string>(), out: (Thing & { d: number })[] = [], tree = domTree()
  for (const el of document.querySelectorAll<HTMLElement>(NAMED)) {
    if (el.closest(".companion-overlay")) continue
    const r = el.getBoundingClientRect()
    // (a whole pane or column holds everything: no help naming one thing)
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.right < 0 || r.top > innerHeight || r.left > innerWidth || r.width * r.height > innerWidth * innerHeight * 0.3) continue
    const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom))
    // (a pane's kept tab, or what a web page's view covers: not what they see)
    if (d > radius || !onTop(el, r)) continue
    const aria = el.getAttribute("role")
    if (aria === "none" || aria === "presentation") continue
    const t = tree.thing(el)
    if (!t || !t.label || seen.has(key(t.frame))) continue
    seen.add(key(t.frame))
    out.push({ ...t, d })
  }
  // (nearest first; of those it's on, the smallest: the one thing, before what holds it)
  const area = (e: { frame: { width: number; height: number } }) => e.frame.width * e.frame.height
  const nearest = out.sort((a, b) => a.d - b.d || area(a) - area(b)).slice(0, most).map(({ d: _, ...e }) => e)
  return [...nearest, ...landmarks(x, y, new Set(nearest.map((e) => key(e.frame))), tree)]
}
const key = (f: { x: number; y: number; width: number; height: number }) => `${f.x},${f.y},${f.width},${f.height}`
/** The window's regions however far from x, y (a sidebar's panels and foot, panes, the status bar), nearest first, each
 *  as much as shows: a frame round one is then exact. At most 10, so an ask's 40 elements hold them all. */
const LANDMARKS = "[data-ui^='panel:'], section[data-pane-frame]:not([data-away]), [data-status-bar], [data-sidebar-foot]"
function landmarks(x: number, y: number, seen: Set<string>, tree = domTree()) {
  const out: (Thing & { d: number })[] = []
  for (const el of document.querySelectorAll<HTMLElement>(LANDMARKS)) {
    const r = shownRect(el), frame = { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }
    if (r.width < 4 || r.height < 4 || seen.has(key(frame)) || el.closest(".companion-overlay") || !onTop(el, r)) continue
    const t = tree.thing(el), label = t?.label || (el.innerText || "").trim().split("\n")[0].trim().slice(0, 120)
    if (!t || !label) continue
    seen.add(key(frame))
    // (a folded panel says so, its heading's state: pressing it opens it, and only its heading shows)
    const fold = el.id ? document.querySelector(`[aria-controls~="${CSS.escape(el.id)}"][aria-expanded]`) : null
    const role = t.role !== "generic" ? t.role : el.matches("[data-status-bar]") ? "status" : "region"
    out.push({ ...t, role, label, frame, state: fold ? { ...t.state, expanded: fold.getAttribute("aria-expanded") === "true" } : t.state,
      d: Math.hypot(Math.max(r.left - x, 0, x - r.left - r.width), Math.max(r.top - y, 0, y - r.top - r.height)) })
  }
  return out.sort((a, b) => a.d - b.d).slice(0, 10).map(({ d: _, ...e }) => e)
}
/** What of `el` shows: its box cut to each scroller or clipper it's in (a panel scrolled half out frames only its half). */
function shownRect(el: HTMLElement) {
  const b = el.getBoundingClientRect()
  let left = Math.max(0, b.left), top = Math.max(0, b.top), right = Math.min(innerWidth, b.right), bottom = Math.min(innerHeight, b.bottom)
  for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a)
    if (s.overflowX === "visible" && s.overflowY === "visible") continue
    const c = a.getBoundingClientRect()
    left = Math.max(left, c.left); top = Math.max(top, c.top); right = Math.min(right, c.right); bottom = Math.min(bottom, c.bottom)
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}
/** The window's toasts of the last minute, newest last, as words: "Claude isn't running" (an error, 12 s ago). */
export function noticesText(now = Date.now()) {
  return noticesSince(now - 60_000).slice(-5).map((n) => `${JSON.stringify(n.text)} (${n.kind === "error" ? "an error, " : ""}${Math.max(0, Math.round((now - n.at) / 1000))} s ago)`).join("; ")
}

/** A box's corner nearest its cursor's tip, sharper (`data-side`, `data-up`: where boxes.ts put it). */
const CORNER = "data-[side=right]:data-up:rounded-bl-[4px] data-[side=left]:data-up:rounded-br-[4px] data-[side=right]:not-data-up:rounded-tl-[4px] data-[side=left]:not-data-up:rounded-tr-[4px]"

/** How long a bubble takes to read (ms): shown this long with the window in front, it's seen. */
export const readMs = (text: string) => 1500 + text.split(/\s+/).length * 220

/** Its words by its cursor: a click (a tap) opens a box to reply in, Enter sends it; a question shows its box from the
 *  start. Put in note, Pin and Close by it; held still (past its time) while the pointer or the focus is in it. */
function Bubble({ n, tint, maxWidth, room, drawn, hold }: { n: Note; tint: string; maxWidth: number; drawn: boolean
  /** How tall its words may grow, inside the window. */
  room: number
  hold: (on: boolean) => void }) {
  const [replying, setReplying] = useState(!!n.question)
  const [draft, setDraft] = useState("")
  const [inside, setInside] = useState(false)
  // (answered or closed here: gone at once, held or not)
  const [gone, setGone] = useState(false)
  const box = useRef<HTMLDivElement>(null), field = useRef<HTMLInputElement>(null)
  useEffect(() => { setReplying(!!n.question); setDraft(""); setGone(false) }, [n.id])
  const held = !gone && (inside || !!draft || (replying && !n.question))
  useEffect(() => { hold(held); return () => hold(false) }, [held])
  // (on screen from now: writing on takes it away only once it showed a moment)
  useEffect(() => { sawShown(n.id) }, [n.id])
  // (seen once it showed long enough to read with the window in front)
  useEffect(() => {
    if (n.seen) return
    const t = setTimeout(() => { if (document.visibilityState === "visible" && document.hasFocus()) sawSays([n.id]) }, readMs(n.text ?? ""))
    return () => clearTimeout(t)
  }, [n.id])
  const send = () => {
    const text = draft.trim()
    if (!text) return
    if (!answer(n.id, "reply", text)) return unsent()
    setDraft("")
    setGone(true)
  }
  const close = () => { answer(n.id, "dismiss"); setGone(true) }
  const open = () => { setReplying(true); requestAnimationFrame(() => field.current?.focus()) }
  if (gone) return null
  return (
    <div ref={box} key={n.id} data-companion-bubble={n.id} data-floats data-question={n.question || undefined} role={n.question ? "group" : undefined} aria-label={n.question ? "A question" : undefined}
      onPointerEnter={(e) => { if (e.pointerType !== "touch") setInside(true) }} onPointerLeave={(e) => { if (e.pointerType !== "touch") setInside(false) }}
      onFocus={() => setInside(true)} onBlur={(e) => { if (!box.current?.contains(e.relatedTarget as Node | null)) setInside(false) }}
      onClick={(e) => { if (!drawn && !replying && !(e.target as Element).closest("button, a")) open() }}
      className={cn("group/bubble companion-pop pointer-events-auto absolute top-0 left-0 flex w-max min-w-[104px] flex-col rounded-[12px] border border-border/60 text-[13.5px] leading-snug text-foreground shadow-lg",
        n.question ? "bg-[color-mix(in_srgb,var(--c)_9%,var(--background))]" : "bg-background", !replying && !drawn && "cursor-text", CORNER)}
      style={{ "--c": tint, maxWidth, boxShadow: `0 0 0 ${n.question ? 2 : 1.5}px color-mix(in srgb, ${tint} ${n.question ? 70 : 45}%, transparent), 0 8px 24px rgba(0,0,0,.12)` } as React.CSSProperties}>
      {/* (a long one scrolls with no bar: its edges fade where there's more, as the sidebar's) */}
      <div style={{ maxHeight: `min(50vh, 360px, ${room}px)` }} className="edge-fade-y min-w-0 overflow-y-auto overscroll-contain px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <Markdown text={n.text ?? ""} className="companion-md" />
      </div>
      {/* (its buttons float on its far corner, away from the cursor, taking no room from its words; by touch, a row under them) */}
      {!drawn && (
        <div className={cn("absolute -top-[22px] right-2 z-[1] flex rounded-[8px] border border-border/60 bg-background shadow-sm transition-opacity group-data-[side=left]/bubble:right-auto group-data-[side=left]/bubble:left-2",
          "[@media(pointer:coarse)]:static [@media(pointer:coarse)]:-mt-1 [@media(pointer:coarse)]:justify-end [@media(pointer:coarse)]:border-0 [@media(pointer:coarse)]:bg-transparent [@media(pointer:coarse)]:px-1 [@media(pointer:coarse)]:shadow-none",
          inside || replying ? "opacity-100" : "opacity-0 group-hover/bubble:opacity-100 [@media(pointer:coarse)]:opacity-100")}>
          <SayActions n={n} small />
          <button type="button" aria-label="Close" data-tip={`Close (${keyHint("Escape")})`} className={ICON} onClick={(e) => { e.stopPropagation(); close() }}><X className="size-3" /></button>
        </div>
      )}
      {replying && !drawn && (
        <input ref={field} autoFocus={!n.question} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Reply" aria-label={`Reply to ${n.agent}`} enterKeyHint="send"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
            else if (e.key === "Escape") { e.preventDefault(); if (draft) setDraft(""); else close() }
          }}
          className="mx-1.5 mb-1.5 h-7 min-w-[180px] rounded-[7px] border border-border/70 bg-background px-2 text-[13px] outline-none focus:border-foreground/30 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:text-[17px]" />
      )}
    </div>
  )
}

/** Agents stacked on one spot (their carets side by side): hovered, focused or tapped, the top one's flag fans out into
 *  a chip per agent, each opening that one's box; arrows go between them. */
function Fan({ agents, up, right, pop, close, keep }: { agents: Agent[]; up: boolean; right: boolean; pop: (name: string) => void; close: (focusFlag?: boolean) => void; keep: () => void }) {
  const box = useRef<HTMLDivElement>(null)
  const move = (e: React.KeyboardEvent, by: number) => {
    const chips = [...box.current!.querySelectorAll<HTMLElement>("button")], i = chips.indexOf(document.activeElement as HTMLElement)
    e.preventDefault()
    chips[(i + by + chips.length) % chips.length]?.focus()
  }
  return (
    <div ref={box} role="menu" aria-label="Agents here" data-companion-fan onPointerEnter={keep} onPointerLeave={() => close()}
      onKeyDown={(e) => { if (e.key === "ArrowDown") move(e, 1); else if (e.key === "ArrowUp") move(e, -1); else if (e.key === "Escape") { e.preventDefault(); close(true) } }}
      onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !(e.relatedTarget as Element | null)?.closest?.("[data-companion-flag]")) close() }}
      className={cn("companion-pop pointer-events-auto absolute flex flex-col gap-1", right ? "right-[-6px] items-end" : "left-[13px] items-start", up ? "bottom-[22px] flex-col-reverse" : "top-[40px]")}>
      {agents.map((x) => (
        <button key={x.name} type="button" role="menuitem" data-agent={x.name} onClick={() => pop(x.name)}
          className="flex h-6 cursor-pointer items-center gap-1 rounded-full px-2 text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm outline-offset-2 hover:brightness-110 max-sm:h-9 max-sm:px-3 max-sm:text-[14px]"
          style={{ background: `var(--${x.tint})` }}>
          {x.name}<span className="font-medium opacity-85">{x.asks ? "needs you" : STATUS[x.state]}</span>
          <Mark mark={presence(x, { age: 3 }).mark} />
        </button>
      ))}
    </div>
  )
}

/** The same props, but callbacks (made again each draw, doing the same) and objects equal key by key (a spot, a stack):
 *  a keystroke elsewhere redraws no cursor or card that stays where it was. */
const shallow = (x: unknown, y: unknown) => !!x && !!y && typeof x === "object" && typeof y === "object"
  && Object.keys(x).length === Object.keys(y).length && Object.entries(x).every(([k, v]) => Object.is(v, (y as Record<string, unknown>)[k]))
const sameProps = <P extends object>(a: P, b: P) => Object.entries(b).every(([k, v]) => typeof v === "function" || Object.is((a as Record<string, unknown>)[k], v) || shallow((a as Record<string, unknown>)[k], v))

/** A flag's mark (look.ts): dots working, a wave listening, a tick for a moment let pass (`at`: when, to play it anew). */
export function Mark({ mark, label, at }: { mark: ReturnType<typeof presence>["mark"]; label?: string; at?: number }) {
  if (mark === "dots") return <span className="companion-dots" data-companion-sign="dots" aria-label={label} aria-hidden={!label || undefined}><i /><i /><i /></span>
  if (mark === "wave") return <span className="companion-wave" data-companion-sign="wave" aria-label={label} aria-hidden={!label || undefined}><i /><i /><i /></span>
  if (mark === "tick") return <Check key={at} data-companion-sign="tick" className="companion-seen size-3" strokeWidth={3} aria-label="seen" />
  return null
}

/** Typing an edit in, it keeps up with the caret (settling in 120 ms). */
const WRITING_MS = 120
/** Its cursor's place on screen moved by the cursor's spring (the one over the screen moves by it too: one cursor), written
 *  onto `el` as it goes, not through React. `instant`: there at once (dragged, back from the screen, a first showing). */
function useGlide(el: React.RefObject<HTMLDivElement | null>, x: number, y: number, instant: boolean, w: number) {
  const g = useRef<Glide | null>(null), to = useRef({ x, y, w }), raf = useRef(0)
  to.current = { x, y, w }
  useLayoutEffect(() => {
    const put = () => { if (el.current && g.current) el.current.style.translate = `${g.current.x}px ${g.current.y}px` }
    if (!g.current || instant || !moves()) {
      cancelAnimationFrame(raf.current)
      raf.current = 0
      g.current = { x, y, vx: 0, vy: 0 }
      return put()
    }
    put()
    if (raf.current) return
    let last = performance.now()
    const frame = (now: number) => {
      const t = to.current, still = springStep(g.current!, t.x, t.y, t.w, Math.max(0, now - last) / 1000)
      last = now
      put()
      raf.current = still ? 0 : requestAnimationFrame(frame)
    }
    raf.current = requestAnimationFrame(frame)
  })
  useEffect(() => () => cancelAnimationFrame(raf.current), [])
}

const Cursor = memo(function Cursor({ a, spot, said, waiting, others, under, shift, age, typed, open, setOpen, pop, hold }: { a: Agent; spot: Spot; said: Note | null; others: Agent[]; under: boolean
  /** It has words waiting for the user's pause (they're speaking). */
  waiting: boolean
  /** Its place in a stack on one spot: drawn this many steps to the right, so each colour shows. */
  shift: number
  /** Since it last acted: 0 under 3 s (its name shows), 1 under 4 s, 2 under 8 s, 3 after (only watching, it fades). */
  age: 0 | 1 | 2 | 3
  /** It's typing an edit in. */
  typed: boolean
  open: boolean; setOpen: (open: boolean) => void; pop: (name: string) => void
  /** It's under the pointer or open: it holds still (`at`: a Talk key's point, on `on`'s text or off it). */
  hold: (on: boolean, at?: { x: number; y: number }, text?: Target) => void }) {
  const tint = `var(--${a.tint})`
  const [hover, setHover] = useState(false)
  const [fan, setFan] = useState(false)
  // (its menu showing: it stays by it)
  const menuOn = useMenuShowing(), [menued, setMenued] = useState(false)
  useEffect(() => { if (!menuOn) setMenued(false) }, [menuOn])
  const menu = (e: React.MouseEvent, below = false) => { setMenued(true); if (below) menuBelow(e, agentMenu(a)); else menuFor(() => agentMenu(a))(e) }
  // (its bubble held, by the pointer or a reply being written: shown past its time, as it was)
  const [keep, setKeep] = useState(false), last = useRef<Note | null>(null)
  if (said) last.current = said
  const bubble = said ?? (keep ? last.current : null)
  const still = hover || open || fan || menued || keep
  useEffect(() => {
    if (!still) return
    hold(true)
    return () => hold(false)
  }, [still])
  const shut = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const flagRef = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)
  const at = { ...spot, x: spot.x + shift * 4 }
  const many = others.length > 0
  const keepFan = () => { clearTimeout(shut.current); if (many) setFan(true) }
  // (a moment to reach it: the chips sit a little away from the flag)
  const closeFan = (focusFlag = false) => { clearTimeout(shut.current); if (focusFlag) { setFan(false); flagRef.current?.focus() } else shut.current = setTimeout(() => setFan(false), 350) }
  useEffect(() => () => clearTimeout(shut.current), [])
  useEffect(() => { if (!many) setFan(false) }, [many])
  // (its flag goes toward the room; its words go where boxes.ts finds room)
  const flagRight = at.x > innerWidth - 140
  // (its name and its mark show while it does anything, then it fades to the bare arrow, as in a shared doc; hovered, again)
  const shown = presence(a, { bubble: !!bubble, held: waiting, typed, age, looked: hover || open || fan })
  const seen = shown.mark === "tick", why = shown.why
  const low = !!spot.low, tag = shown.flag && (!under || hover || open)
  useEffect(() => {
    if (!open && !fan) return
    const down = (e: PointerEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setFan(false) } }
    addEventListener("pointerdown", down, true)
    return () => removeEventListener("pointerdown", down, true)
  }, [open, fan, setOpen])
  // (resting, it fades out where it was, its words and asks waiting in its history and the inbox)
  const docked = !!spot.docked && !open
  // (its question is here, with its buttons: the inbox's toast of it, now or arriving just after, would cover them)
  const asked = docked ? undefined : a.asks?.event
  useEffect(() => {
    if (!asked) return
    dismissNotice(`inbox-${asked}`)
    const t = setTimeout(() => dismissNotice(`inbox-${asked}`), 1500)
    return () => clearTimeout(t)
  }, [asked])
  const away = !!spot.away && !open
  // (back from the screen: it's where it's going at once, showing as the screen's cursor lands there)
  const wasAway = useRef(false), arriveBy = useRef(0)
  if (wasAway.current && !away) arriveBy.current = Date.now() + 700
  wasAway.current = away
  const arriving = Date.now() < arriveBy.current
  // (shown, it's drawn over a web page it reaches, as a toast is: layers.ts checks each float's box against the page's)
  const floats = !docked && !away
  const tx = docked ? at.x : at.x - 3, ty = docked ? at.y : at.y - 2
  // (back from resting: it fades in where it's going, never gliding over from where it faded)
  const wasDocked = useRef(docked), rested = wasDocked.current && !docked
  wasDocked.current = docked
  useGlide(box, tx, ty, away || arriving || rested, a.state === "writing" || typed ? stiffness(WRITING_MS) : CURSOR_SPRING)
  // (its words, its box or its question placed by one rule (boxes.ts): never over its arrow, its name or what it points at)
  useLayoutEffect(() => {
    const el = box.current, words = el?.querySelector<HTMLElement>(":scope > [data-companion-bubble], :scope > [data-companion-popover], :scope > [data-companion-ask]")
    if (!el || !words || docked) return
    const o = { x: at.x - 3, y: at.y - 2 }, f = flagRef.current
    const clear = [arrowBox(at), ...(f && f.offsetWidth ? [{ x: o.x + f.offsetLeft, y: o.y + f.offsetTop, width: f.offsetWidth, height: f.offsetHeight }] : []), ...(spot.target ? [spot.target] : [])]
    const b = boxAt(at, { width: words.offsetWidth, height: words.offsetHeight }, { x: 4, y: 4, width: innerWidth - 8, height: innerHeight - 8 }, clear)
    words.style.left = `${b.x - o.x}px`
    words.style.top = `${b.y - o.y}px`
    words.dataset.side = b.side
    words.toggleAttribute("data-up", b.up)
  })
  if (spot.drawn && !bubble && !a.asks) return null
  const enter = (e: React.PointerEvent) => { if (e.pointerType !== "touch") setHover(true) }
  return (
    <div ref={box} className="companion-cursor pointer-events-none fixed top-0 left-0 z-(--z-page-float)" data-agent={a.name} data-floats={floats ? "" : undefined} data-state={a.state} data-seen={seen || undefined} data-open={open || undefined} data-stacked={many ? others.length + 1 : undefined}
      onPointerEnter={enter} onPointerLeave={() => setHover(false)}
      data-docked={docked || undefined} data-faded={(docked && spot.faded) || undefined} data-away={away || undefined} data-to={`${Math.round(tx)},${Math.round(ty)}`}
      style={{
        transition: away ? "none" : arriving ? "opacity .2s .35s" : docked ? "opacity .6s ease-out, visibility 0s .6s" : "opacity .3s",
        opacity: docked || away ? 0 : shown.dim ? 0.55 : 1, visibility: docked || away ? "hidden" : undefined, zIndex: spot.rides ? "var(--z-peek-rider)" : open || fan ? "calc(var(--z-page-float) + 2)" : many ? "calc(var(--z-page-float) + 1)" : undefined }}>
      {!spot.drawn && <>
      <div className={cn("relative", shown.bob && "companion-bob")}>
        <Arrow tint={tint} />
      </div>
      <button ref={flagRef} type="button" tabIndex={tag || many ? 0 : -1} aria-label={many ? `${[a, ...others].map((x) => x.name).join(", ")} here` : `Go to ${a.name}`} aria-haspopup={many ? "menu" : undefined} aria-expanded={many ? fan : undefined}
        data-companion-flag data-floats={floats && (tag || fan) ? "" : undefined} data-under-pages={floats && (tag || fan) ? undefined : ""} data-tip={many || !(a.path || a.pane) ? undefined : "Go to where it is"}
        onPointerEnter={(e) => { if (e.pointerType !== "touch") keepFan() }} onPointerLeave={(e) => { if (e.pointerType !== "touch") closeFan() }}
        onFocus={keepFan} onBlur={(e) => { if (!box.current?.querySelector("[data-companion-fan]")?.contains(e.relatedTarget as Node | null)) closeFan() }}
        onKeyDown={(e) => { if (many && e.key === "ArrowDown") { e.preventDefault(); setFan(true); requestAnimationFrame(() => box.current?.querySelector<HTMLElement>("[data-companion-fan] button")?.focus()) } else if (e.key === "Escape" && fan) { e.preventDefault(); setFan(false) } }}
        onContextMenu={menu}
        onClick={(e) => { if (!many) return follow(a); if (e.detail === 0 || (e.nativeEvent as PointerEvent).pointerType === "touch") setFan((f) => !f); else follow(a) }}
        className={cn("absolute flex items-center gap-1 rounded-full px-2 py-[2px] text-[11.5px] font-semibold whitespace-nowrap text-white shadow-sm transition-opacity duration-300",
          flagRight ? "right-[-6px]" : "left-[13px]", low ? "top-[-20px]" : "top-[18px]", tag || fan ? "pointer-events-auto cursor-pointer" : "opacity-0 focus-visible:opacity-100")} style={{ background: tint }}>
        {a.name}
        {many && <span className="font-medium opacity-85">+{others.length}</span>}
        {shown.words && !many && <span className="font-medium opacity-85">{shown.words}</span>}
        <Mark mark={shown.mark} label={a.state} at={a.t} />
        {why && <span data-companion-why className="max-w-[220px] truncate font-medium opacity-90">{why}</span>}
      </button>
      {fan && many && !open && <Fan agents={[a, ...others]} up={low} right={flagRight} keep={keepFan} close={closeFan} pop={(name) => { setFan(false); pop(name) }} />}
      {/* (kept inside the window) */}
      {open && <Popover a={a} close={() => setOpen(false)} menu={(e) => menu(e, true)} />}
      </>}
      {/* (none while it's hidden: an unseen float would still raise the window over a page) */}
      {!floats ? null : a.asks && !open ? (
        <div key={a.asks.event} data-companion-ask={a.asks.event} data-floats role="group" aria-label={`${a.name} asks`}
          className={cn("companion-pop pointer-events-auto absolute top-0 left-0 flex w-max flex-col gap-1.5 rounded-[12px] border border-border/60 bg-background px-3 py-2 text-[13.5px] leading-snug text-foreground shadow-lg", CORNER)}
          style={{ maxWidth: Math.min(300, innerWidth - 16), boxShadow: `0 0 0 1.5px color-mix(in srgb, ${tint} 45%, transparent), 0 8px 24px rgba(0,0,0,.12)` }}>
          <span>{a.asks.text}</span>
          <span className="flex justify-end gap-1">
            {(["deny", "approve"] as const).map((v) => (
              <button key={v} type="button" data-gate={v} className={cn("cursor-pointer rounded-[7px] px-2.5 py-1 text-[12.5px] font-medium max-sm:py-1.5",
                v === "approve" ? "text-white hover:brightness-110" : "text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground")}
                style={v === "approve" ? { background: tint } : undefined}
                onClick={() => { haptic("medium"); const undo = answered(a.name); answerAsk(a.asks!.event, v).catch((e) => { undo(); notifyError(e, "Couldn't answer it") }) }}>
                {v === "approve" ? "Approve" : "Deny"}</button>
            ))}
          </span>
        </div>
      ) : bubble && !open && (
        <Bubble n={bubble} tint={tint} drawn={!!spot.drawn} hold={setKeep}
          maxWidth={Math.min(320, innerWidth - 16)} room={Math.min(360, innerHeight - 24)} />
      )}
    </div>
  )
}, sameProps)

const CLOCK = { hour: "numeric", minute: "2-digit" } as const, DAY = { day: "numeric", month: "short" } as const, YEAR = { ...DAY, year: "numeric" } as const
/** When, as a shared doc's comment says it: now, 5 min, 4:05 PM (today), Oct 30. */
function when(t: number) {
  const s = (Date.now() - t) / 1000, d = new Date(t), today = new Date()
  if (s < 60) return "now"
  if (s < 3600) return `${Math.floor(s / 60)} min`
  if (d.toDateString() === today.toDateString()) return dateText(d, CLOCK)
  return dateText(d, d.getFullYear() === today.getFullYear() ? DAY : YEAR)
}

/** Someone in a thread: their initial in their colour (as Presence draws faces), their name and when they wrote. */
function Who({ name, tint, t, small, suffix }: { name: string; tint: string; t?: number; small?: boolean; suffix?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-1 items-center", small ? "gap-1.5" : "gap-2")}>
      <span aria-hidden className={cn("grid shrink-0 place-items-center rounded-full font-bold text-white", small ? "size-[18px] text-[9.5px]" : "size-6 text-[11px]")} style={{ background: tint }}>
        {name === "You" ? <UserRound className={small ? "size-2.5" : "size-3.5"} strokeWidth={2.75} /> : name.charAt(0).toUpperCase()}
      </span>
      <div className={cn("min-w-0 flex-1 leading-tight", small && "flex items-baseline gap-1.5")}>
        <div className="truncate text-[12.5px] font-semibold text-foreground">{name}{suffix && <span className="font-normal text-muted-foreground"> {suffix}</span>}</div>
        {t ? <div className="shrink-0 text-[11.5px] text-muted-foreground" data-tip={fmtStamp(t)}>{when(t)}</div> : null}
      </div>
    </div>
  )
}

const BTN = "grid size-6 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground [@media(pointer:coarse)]:size-9"

/** A margin card, as a shared doc's comment: who and when, Resolve and a menu. Not open, it's its first words and how
 *  many replies (a dot, where the margin's narrow); open, the whole thread and a box to reply. */
const Card = memo(function Card({ n, x, y, folded, open, cap, onHeight, onOpen, onHover }: { n: Note; x: number; y: number; folded: boolean; open: boolean; cap: number
  /** (the minute: its times redrawn as they age) */ minute: number
  onHeight: (h: number) => void; onOpen: (open: boolean) => void; onHover: (on: boolean) => void }) {
  const ref = useRef<HTMLElement | null>(null), keep = (el: HTMLElement | null) => { ref.current = el }
  const body = useRef<HTMLDivElement>(null)
  const [more, setMore] = useState(false)
  const writing = n.id === DRAFT, suggestion = n.kind === "suggestion", proposal = n.kind === "proposal"
  const [draft, setDraft] = useState(() => (writing ? getState().draft?.text ?? "" : ""))
  const tint = threadTint(n), author = writing ? (share ? share.guest : "You") : authorOf(n)
  // (a guest closes only their own threads; the user, any)
  const closes = !share || (n.by === "guest" && n.agent === share.guest)
  // (how far below its line it reaches: the next card goes under it, and the note keeps room to scroll to it)
  useLayoutEffect(() => {
    if (ref.current) onHeight(ref.current.offsetHeight)
    const b = body.current
    setMore(!open && !!b && b.scrollHeight > b.clientHeight + 2)
  })
  const replies = n.replies ?? [], had = useRef(replies.length)
  useEffect(() => { if (replies.length > had.current) body.current?.scrollTo({ top: body.current.scrollHeight }); had.current = replies.length }, [replies.length])
  if (folded && !open) {
    return (
      <button ref={keep} type="button" aria-label={`${author}'s ${n.kind}`} data-companion-dot={n.id} className="companion-fade pointer-events-auto absolute top-0 left-0 grid size-5 cursor-pointer place-items-center rounded-full shadow"
        style={{ transform: `translate(${x}px, ${y}px)`, background: tint }} onClick={() => onOpen(true)}>
        <span className="size-1.5 rounded-full bg-white" />
      </button>
    )
  }
  const send = () => {
    const t = draft.trim()
    if (writing) return t ? void (comment(t) || unsent()) : startComment(null)
    if (t && !answer(n.id, "reply", t)) return unsent()
    setDraft("")
  }
  const words = n.text ?? n.replace ?? ""
  const items = (): MenuItem[] => [
    ...(words ? [{ label: "Copy text", icon: Copy, run: () => void copyText(words) }] : []),
    ...(!share && n.by === "user" ? [{ label: "Delete", icon: Trash2, danger: true, sep: !!words, run: () => void confirmDialog({ title: "Delete this comment?", body: "It won't be kept with the resolved ones.", confirm: "Delete", danger: true })
      .then((ok) => ok && answer(n.id, "reject")) }] : []),
  ]
  const replyTint = (r: Reply) => (r.by === "agent" ? (n.by ? tintOf(r.name ?? n.ask ?? n.agent) : tint) : r.by === "guest" && r.name === n.agent ? tint : "var(--muted-foreground)")
  return (
    <div ref={keep} data-companion-note={n.id} data-open={open || undefined} onPointerDown={(e) => !open && !(e.target as Element).closest("button") && onOpen(true)}
      onPointerEnter={() => onHover(true)} onPointerLeave={() => onHover(false)} onContextMenu={writing ? undefined : menuFor(items)}
      className={cn("companion-pop pointer-events-auto absolute top-0 left-0 flex w-[212px] flex-col rounded-[10px] border bg-background text-[13px] leading-snug transition-[transform,box-shadow,border-color] duration-[250ms] ease-out",
        open ? "border-transparent shadow-[0_2px_6px_rgb(0_0_0/0.10),0_10px_28px_rgb(0_0_0/0.14)]" : "cursor-pointer border-border/70 shadow-[0_1px_2px_rgb(0_0_0/0.06)] hover:border-border")}
      style={{ transform: `translate(${x}px, ${y}px)`, maxHeight: cap, zIndex: open ? 2 : undefined }}>
      <div className="flex shrink-0 items-center gap-0.5 pt-2 pr-1.5 pl-2.5">
        <Who name={author} tint={tint} t={writing ? undefined : n.t} suffix={suggestion ? "suggests" : proposal ? proposes(n) : undefined} />
        {closes && !writing && <button type="button" aria-label={suggestion ? "Reject" : proposal ? "Reject all" : "Resolve"} data-tip={suggestion ? `Reject (${keyHint("Escape")})` : proposal ? "Reject all" : "Resolve"} className={BTN}
          onClick={() => (proposal ? review(n.id, "reject") : answer(n.id, suggestion ? "reject" : "dismiss"))}>
          {suggestion || proposal ? <X className="size-4" /> : <Check className="size-4" strokeWidth={2.25} />}
        </button>}
        {!writing && items().length > 0 && <button type="button" aria-label="More" data-tip="More" className={BTN} onClick={(e) => menuBelow(e, items())}><Ellipsis className="size-4" /></button>}
      </div>
      {/* (open, one taller than the pane scrolls inside, its buttons kept in sight) */}
      <div ref={body} className={cn("min-h-0 px-2.5", open ? "overflow-y-auto overscroll-contain" : "max-h-[62px] overflow-hidden", more && "companion-more")}>
        {n.orphaned && <div className="pt-1.5 text-[12px] text-muted-foreground">Its text was removed</div>}
        {n.text && <div className="pt-1.5 text-foreground"><Markdown text={n.text} className="companion-md" /></div>}
        {proposal && <Proposal n={n} tint={tint} />}
        {open && replies.map((r, i) => (
          <div key={i} className="mt-2 border-t border-border/50 pt-2">
            <Who small name={replyAuthor(n, r)} tint={replyTint(r)} t={r.t} />
            <div className="mt-1"><Markdown text={r.text} className="companion-md" /></div>
          </div>
        ))}
      </div>
      {!open && replies.length > 0 && <div className="shrink-0 px-2.5 pt-1 text-[12px] font-medium text-muted-foreground">{plural(replies.length, "reply", "replies")}</div>}
      {proposal && (n.changes ?? []).some((c) => !c.intent && !c.stale) && (
        <div className="flex shrink-0 items-center gap-1.5 px-2.5 pt-2">
          <button type="button" className="flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-semibold text-white" style={{ background: tint }} onClick={() => review(n.id, "accept")}>
            <Check className="size-3.5" strokeWidth={2.5} />Accept all
          </button>
          <span className="flex-1" />
          <button type="button" aria-label="Previous change" data-tip={`Previous change (${keyHint("Alt+[")})`} className={BTN} onClick={() => stepTo(n, -1)}><ChevronUp className="size-4" /></button>
          <button type="button" aria-label="Next change" data-tip={`Next change (${keyHint("Alt+]")})`} className={BTN} onClick={() => stepTo(n, 1)}><ChevronDown className="size-4" /></button>
        </div>
      )}
      {suggestion && (
        <div className="flex shrink-0 gap-1.5 px-2.5 pt-2">
          <button type="button" className="flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-[12.5px] font-semibold text-white" style={{ background: tint }} onClick={() => void accept(n)}>
            <Check className="size-3.5" strokeWidth={2.5} />Accept<span className="opacity-70">{keyHint("Tab")}</span>
          </button>
        </div>
      )}
      {n.kind === "comment" && (open || writing) ? (
        <div className="shrink-0 px-2.5 pt-2">
          <input autoFocus={writing} value={draft} onFocus={(e) => e.currentTarget.setSelectionRange(draft.length, draft.length)} onChange={(e) => setDraft(e.target.value)} placeholder={writing ? "Comment" : "Reply"} aria-label={writing ? "Comment" : "Reply"} enterKeyHint="send"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); send() }
              else if (e.key === "Escape") { e.preventDefault(); if (writing) startComment(null); else { setDraft(""); onOpen(false) } }
            }}
            onBlur={() => writing && !draft && startComment(null)}
            className="h-7 w-full rounded-[6px] border border-border bg-transparent px-2 text-[13px] outline-none focus:border-foreground/30 [@media(pointer:coarse)]:h-10 [@media(pointer:coarse)]:text-[17px]" />
          {(writing || draft) && (
            <div className="flex justify-end gap-1 pt-1.5">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => (writing ? startComment(null) : setDraft(""))}
                className="h-6.5 cursor-pointer rounded-[6px] px-2 text-[12.5px] font-medium text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground">Cancel</button>
              <button type="button" disabled={!draft.trim()} onClick={send}
                className="h-6.5 cursor-pointer rounded-[6px] bg-primary px-2.5 text-[12.5px] font-semibold text-primary-foreground disabled:cursor-default disabled:opacity-50">{writing ? "Comment" : "Reply"}</button>
            </div>
          )}
          <div className="h-2.5" />
        </div>
      ) : <div className="h-2.5 shrink-0" />}
    </div>
  )
}, sameProps)

/** A proposal's state on its card: what it's writing (its placeholders), the changes that no longer fit the note, what
 *  was decided so far. */
function Proposal({ n, tint }: { n: Note; tint: string }) {
  const changes = n.changes ?? [], intents = changes.filter((c) => c.intent), stale = changes.filter((c) => c.stale && !c.intent)
  const ready = changes.length - intents.length - stale.length, done = (n.took ?? 0) + (n.left ?? 0)
  return (
    <div className="flex flex-col gap-1 pt-1.5 text-[12px] text-muted-foreground">
      {ready > 0 && <div data-companion-count>{done > 0 ? `${ready} of ${changes.length - intents.length + done} left` : plural(ready, "change", "changes")}</div>}
      {intents.map((c) => (
        <div key={c.id} className="flex items-center gap-1.5"><span className="companion-dots shrink-0" style={{ color: tint }}><i /><i /><i /></span><span className="min-w-0 truncate">{c.intent}</span></div>
      ))}
      {stale.length > 0 && (
        <div className="flex items-center gap-1">
          <span className="flex-1">{stale.length === 1 ? "1 change no longer fits: its text changed" : `${stale.length} changes no longer fit: their text changed`}</span>
          <button type="button" className="cursor-pointer rounded-[5px] px-1 font-medium hover:bg-foreground/[0.07] hover:text-foreground" onClick={() => stale.forEach((c) => review(n.id, "reject", c.id))}>Leave</button>
        </div>
      )}
    </div>
  )
}

/** Add comment, in the margin level with a selection being made (as in a shared doc): it keeps the note's focus. */
function AddComment({ x, y }: { x: number; y: number }) {
  const keys = commandKeys("companion:comment")
  return (
    <button type="button" aria-label="Add comment" data-tip={`Add comment${keys ? ` (${keys})` : ""}`} data-companion-add onMouseDown={(e) => e.preventDefault()} onClick={() => runCommandById("companion:comment")}
      className="companion-fade pointer-events-auto absolute top-0 left-0 grid size-7 cursor-pointer place-items-center rounded-full border border-border/70 bg-background text-muted-foreground shadow-md hover:text-foreground"
      style={{ transform: `translate(${x}px, ${y}px)`, zIndex: 3 }}>
      <MessageSquarePlus className="size-4" />
    </button>
  )
}

const STYLE = `
.companion-bob { animation: companion-bob 1.1s ease-in-out infinite; }
@keyframes companion-bob { 50% { transform: translate(1px, -3px) rotate(-6deg); } }
.companion-dots { display: inline-flex; gap: 2px; }
.companion-dots i { width: 3px; height: 3px; border-radius: 9px; background: currentColor; animation: companion-dot 1s infinite ease-in-out; }
.companion-dots i:nth-child(2) { animation-delay: .15s } .companion-dots i:nth-child(3) { animation-delay: .3s }
@keyframes companion-dot { 0%, 80%, 100% { opacity: .35 } 40% { opacity: 1 } }
.companion-wave { display: inline-flex; align-items: center; gap: 1.5px; height: 9px; }
.companion-wave i { width: 2px; height: 100%; border-radius: 9px; background: currentColor; transform-origin: center; animation: companion-wave 1s infinite ease-in-out; }
.companion-wave i:nth-child(2) { animation-delay: .2s } .companion-wave i:nth-child(3) { animation-delay: .4s }
@keyframes companion-wave { 0%, 100% { transform: scaleY(.35) } 50% { transform: scaleY(1) } }
.companion-seen { animation: companion-seen .5s ease-out; }
@keyframes companion-seen { from { opacity: 0; scale: .4; } }
.companion-pop { animation: companion-pop .28s cubic-bezier(.2,.9,.3,1.25); transform-origin: top left; }
@keyframes companion-pop { from { opacity: 0; scale: .9; } }
.companion-fade { animation: companion-fade .25s ease-out; }
@keyframes companion-fade { from { opacity: 0; } }
.companion-more { mask-image: linear-gradient(to bottom, #000 55%, transparent); }
.note-prose.companion-md { font-size: inherit; line-height: inherit; }
.note-prose.companion-md :where(p, ul, ol, pre, blockquote, table) { margin: 0 0 4px; }
.note-prose.companion-md > :last-child { margin-bottom: 0; }
.note-prose.companion-md :where(ul, ol) { padding-left: 16px; }
.note-prose.companion-md li + li { margin-top: 1px; }
.note-prose.companion-md :where(.h1, .h2, .h3, h1, h2, h3) { font-size: inherit; line-height: inherit; font-weight: 650; margin: 0 0 2px; }
html[data-drawer] .companion-overlay { visibility: hidden; }
@media (prefers-reduced-motion: reduce) { .companion-cursor, .companion-bob, .companion-pop, .companion-fade, .companion-dots i, .companion-wave i, .companion-seen { animation: none !important; transition: none !important; } }
`

/** nudge: how far right of where it opens it rests (the open one steps toward the text, as in a shared doc). */
type Placed = { n: Note; v: EditorView; x: number; y: number; folded: boolean; nudge: number; open?: boolean }
/** A thread's dot by its line, in the agent's colour (comments in the sidebar): a click opens it in the panel. */
type Dot = { n: Note; x: number; y: number }
type Pane = { id: number; top: number; bottom: number; under: number; cards: Placed[]; dots: Dot[]; add?: { x: number; y: number } }
const paneIds = new WeakMap<Element, number>()
let lastPane = 0
let insets = new WeakMap<Element, { top: number; foot: number }>()
const roomy = new Set<EditorView>()
/** Add comment showed last frame (so a selection's end takes it away); a finger has the editor's menu instead. */
let adding = false
const coarse = matchMedia("(pointer: coarse)")
/** The note being selected in, where comments may be added. */
function selecting() {
  if (coarse.matches || (share && share.role === "read")) return null
  for (const v of views.keys()) {
    const sel = v.state.selection.main
    if (v.hasFocus && !sel.empty && (share?.role === "comment" || v.contentDOM.contentEditable === "true") && v.state.sliceDoc(sel.from, sel.to).trim()) return v
  }
  return null
}

/** What of a pane's scroller shows: under its bar (a phone's header), above the status bar (a phone's bar). */
function shownOf(el: Element) {
  let i = insets.get(el)
  if (!i) {
    const probe = document.createElement("div")
    probe.style.cssText = "position:absolute;visibility:hidden;height:var(--vau-panel-top,0px);width:var(--vau-panel-bottom,0px)"
    el.append(probe)
    i = { top: probe.offsetHeight, foot: probe.offsetWidth }
    probe.remove()
    insets.set(el, i)
  }
  const r = el.matches("[data-pane]") ? el.getBoundingClientRect() : { top: 0, bottom: innerHeight }, bar = document.querySelector("[data-phone-bar]")?.getBoundingClientRect()
  const bottom = Math.min(bar?.height ? bar.top : innerHeight, innerHeight, r.bottom - i.foot)
  return { top: Math.max(0, r.top + i.top), bottom, under: r.bottom - bottom }
}

/** Where on screen the line of `pos` starts, drawn or not. */
function topOf(v: EditorView, pos: number) {
  // (a position in markup drawn hidden, as a read-only task's box, has no box of its own: its line's then)
  try { const c = v.coordsAtPos(pos); if (c && c.bottom > c.top) return c.top } catch { /* outside the drawn part */ }
  return v.documentTop + v.lineBlockAt(pos).top
}

/** Open agent `name`'s box by its cursor: what it said, and asking it (the status bar's menu, where its cursor rests). */
let popOpen: ((name: string | null) => void) | null = null
export const showSaid = (name: string) => popOpen?.(name)

export function Overlay() {
  const s = useSyncExternalStore(subscribe, getState)
  // (the user dictating: what an agent says meanwhile waits for their pause)
  const spokeAt = useDictation((d) => d?.spokeAt ?? 0)
  // (a bubble with no words yet is none: its cursor's dots show it working)
  const heldBack = (n: Note) => spokeAt > 0 && arrivedAt(n.id) >= spokeAt
  const says = (a: Agent) => s.notes.filter((n) => n.kind === "say" && n.agent === a.name && !!n.text?.trim())
  const margin = useInMargin()
  const [, redraw] = useReducer((x: number) => x + 1, 0)
  const [popped, setPopped] = useState<string | null>(null)
  popOpen = setPopped
  // (a phone: no cursor, but a caret where it works and a card by the thumb, Phone.tsx)
  const phone = usePhone()
  const [hovered, setHovered] = useState<string | null>(null)
  const heights = useRef(new Map<string, number>())
  const rooms = useRef(new Map<EditorView, number>())
  // (a cursor under the pointer or open stays where it is: nothing moves under the user's pointer)
  const holds = useRef(new Map<string, Place>()), drawn = useRef(new Map<string, Place>()), lastSpots = useRef(new Map<string, Spot>())
  const hold = (name: string, on: boolean, at?: { x: number; y: number }, text?: Target) => {
    // (one the user left somewhere stays when the pointer goes)
    if (!on) { if (!holds.current.get(name)?.left && holds.current.delete(name)) redraw(); return }
    const d = drawn.current.get(name)
    if (!d) return
    if (!at) { if (!holds.current.has(name)) holds.current.set(name, d); return }
    // (a Talk key's: it stays at the pointer, on the line it points at (scrolling with it), else on that point of the window)
    const a = getState().agents.find((x) => x.name === name)
    if (!a) return
    const left: Left = { last: placeKey(a), echo: Date.now() + 3000 }
    const there = text && { ...placeOf({}), ...text }, spot = there && spotOf({ ...a, ...there }, d.i, true)
    const over = document.elementsFromPoint(at.x, at.y).some((e) => !e.closest(".companion-overlay") && !!e.closest("[data-web-box]"))
    holds.current.set(name, there && spot && !spot.parked ? { at: there, i: d.i, shift: 0, dx: at.x - spot.x, dy: at.y - spot.y, left }
      : { ...d, shift: 0, dx: 0, dy: 0, screen: { ...at, over }, left })
    redraw()
  }
  /** A cursor the user left stays until its agent looks elsewhere (its place changes past the drop's own echo) or types. */
  const stays = (a: Agent, left: Left) => {
    if (typing?.agent === a.name) return false
    const k = placeKey(a)
    if (k === left.last) return true
    if (Date.now() > left.echo) return false
    Object.assign(left, { last: k, echo: 0 })
    return true
  }
  // The card open: the one clicked, else the one whose text the user's caret is in (as in a shared doc).
  useEffect(() => {
    // (its text clicked: that one)
    const down = (e: PointerEvent) => {
      const t = e.target as Element | null, mark = t?.closest?.<HTMLElement>("[data-companion-mark]")
      if (mark) pick(mark.dataset.companionMark!)
      else if (!t?.closest?.("[data-companion-note], [data-companion-dot], [data-companion-gutter], [data-companion-thread], [data-companion-add]")) pick(null)
    }
    addEventListener("pointerdown", down, true)
    return () => removeEventListener("pointerdown", down, true)
  }, [])
  useEffect(() => {
    let frame = 0
    // (nothing placed nor any room left to take back: a keystroke or a scroll draws nothing, nor looks for panes)
    // (a thread counts only in a note on screen: the vault's others, in files not open, place nothing)
    const placed = (n: Note) => !n.path || !!viewOf(n.path)
    const idle = () => { const st = getState(); return !st.draft && !roomy.size && !adding && (st.mode === "off" ? !st.notes.some((n) => n.by && placed(n)) : !st.agents.length && !st.notes.some(placed)) && !selecting() }
    // (ticks only with something to place: an idle app with no agents or comments wakes for nothing; turning idle, it
    // draws once more to take down what it showed)
    let tick = 0, busy = false
    const later = () => { if (idle() && !busy) return; arm(); if (!frame) frame = requestAnimationFrame(() => { frame = 0; watch(); busy = !idle(); redraw() }) }
    const arm = () => { if (!tick && !idle()) tick = window.setInterval(() => { if (idle()) { clearInterval(tick); tick = 0; later() } else if (document.visibilityState === "visible") later() }, 1500) }
    const off = onBump(later)
    const resized = () => { insets = new WeakMap(); later() }
    addEventListener("scroll", later, { capture: true, passive: true })
    addEventListener("resize", resized)
    // (a sidebar opening moves a pane's text without resizing its editor; a tab switch or a split moves editors unsaid)
    const ro = new ResizeObserver(later), watch = () => { for (const el of document.querySelectorAll("[data-pane], #main-scroll")) ro.observe(el) }
    watch()
    const unsub = subscribe(arm)
    arm()
    return () => { off(); unsub(); ro.disconnect(); removeEventListener("scroll", later, { capture: true }); removeEventListener("resize", resized); clearInterval(tick); cancelAnimationFrame(frame) }
  }, [])
  // The note's own room under its text, so scrolling reaches its lowest card.
  useLayoutEffect(() => {
    for (const v of roomy) if (!rooms.current.has(v)) { v.contentDOM.style.marginBottom = ""; roomy.delete(v) }
    for (const [v, px] of rooms.current) {
      const m = px > 0 ? `${Math.ceil(px)}px` : ""
      if (v.contentDOM.style.marginBottom !== m) v.contentDOM.style.marginBottom = m
      if (m) roomy.add(v); else roomy.delete(v)
    }
  })
  rooms.current = new Map()
  // (off, the companion draws nothing of its own: people's threads still show)
  const off = s.mode === "off"
  const notes = [...(off ? s.notes.filter((n) => n.by) : s.notes), ...(s.draft ? [{ ...s.draft, id: DRAFT, kind: "comment", agent: "", by: share ? "guest" : "user", t: Date.now() } as Note] : [])]
  const sv = s.draft ? null : selecting()
  adding = false
  if (off && !notes.length && !sv) return null

  const cursors = (off ? [] : s.agents).map((a, i) => {
    // (on another app's window, with the desktop helper drawing it and its bubbles there: here, hidden where it was, for
    // that one to glide out from)
    if (dictationSource && !a.path && (a.app || a.sx !== undefined)) {
      const was = lastSpots.current.get(a.name)
      return { a, i, spot: was ? { ...was, away: true } : null, said: null, waiting: false, with: [] as Agent[], under: false, shift: 0, held: undefined }
    }
    // (riding with the pointer over the screen, the helper's: one companion, so none here; hidden where its place is,
    // for the riding one to fly there (helper.ts inAppPoint), never at home)
    if (s.riding === a.name) {
      const at = spotOf(a, i)
      return { a, i, spot: at && !at.docked ? { ...at, away: true } : null, said: null, waiting: false, with: [] as Agent[], under: false, shift: 0, held: undefined }
    }
    const mine = says(a), said = mine.findLast((n) => !heldBack(n)) ?? null, waiting = mine.some(heldBack)
    let h = holds.current.get(a.name)
    if (h?.left && !stays(a, h.left)) { holds.current.delete(a.name); h = undefined }
    // (only while it works, writes, speaks or points, as a collaborator in a shared doc: idle a while, or moved there
    // without acting, it rests at home)
    const quiet = !h && !said && !waiting && !a.asks && typing?.agent !== a.name && a.state === "watching"
    const idle = quiet && (!!a.rests || Date.now() - a.t > IDLE_MS)
    let at = h?.screen ? screenSpot(h.screen) : h ? spotOf({ ...a, ...h.at }, h.i, true) : idle ? home(a, i) : spotOf(a, i)
    // (past its act's moment, a quiet one whose line is scrolled away hides there, never kept at the edge; back with the line)
    if (quiet && at?.out && Date.now() - a.t >= 3000) at = { ...at, parked: true, docked: true, faded: true }
    // (left on a line of a note not on screen now: where that note is, as it would be)
    const off = !!h?.left && !h.screen && !(h.at.path && viewOf(h.at.path))
    return { a, i, spot: at && h && !h.screen && !off ? { ...at, x: at.x + h.dx, y: at.y + h.dy } : at, said, waiting, with: [] as Agent[], under: false, shift: 0, held: h }
  })
  // (cursors on the same spot, as in a shared doc: side by side, one flag, "Perf +1", fanning out into each of them)
  for (const c of cursors) {
    // (resting ones are unseen: no stack)
    const top = c.spot && !c.spot.docked && !c.spot.away && cursors.find((o) => o !== c && o.spot && !o.spot.docked && !o.spot.away && !o.under && Math.abs(o.spot.x - c.spot!.x) < 14 && Math.abs(o.spot.y - c.spot!.y) < 10 && cursors.indexOf(o) < cursors.indexOf(c))
    if (top) { c.under = true; top.with.push(c.a); c.shift = top.with.length }
  }
  for (const c of cursors) if (c.held) c.shift = c.held.shift
  for (const c of cursors) if (c.spot && !c.spot.away) { lastSpots.current.set(c.a.name, c.spot); if (!c.spot.docked) lastShown.set(c.a.name, c.spot) }
  drawn.current = new Map(cursors.map((c) => [c.a.name, c.held ?? { at: placeOf(c.a), i: c.i, shift: c.shift, dx: 0, dy: 0 }]))
  // Comments beside their lines, scrolling with the note and clipped to what of its pane shows: cards in the margin (as
  // in a shared doc), or a dot each by the text, the threads being in the Conversations panel.
  const panes = new Map<Element, Pane>()
  const perLine = new Map<string, number>()
  let caret: string | null = null
  const paneOf = (v: EditorView) => {
    // (a phone's page scrolls the window; a sheet is a modal dialog, drawn over the margin)
    const el = v.dom.closest("[data-pane]") ?? v.dom.closest("#main-scroll")
    if (!el?.getClientRects().length) return null
    let p = panes.get(el)
    if (!p) {
      if (!paneIds.has(el)) paneIds.set(el, ++lastPane)
      panes.set(el, p = { id: paneIds.get(el)!, ...shownOf(el), cards: [], dots: [] })
    }
    return { el, p }
  }
  for (const n of notes) {
    if (n.kind !== "comment" && n.kind !== "suggestion" && n.kind !== "proposal") continue
    const v = n.path ? viewOf(n.path) : null
    const pos = v ? posIn(v, n) : null
    if (!v || pos === null) continue
    const at = paneOf(v)
    if (!at) continue
    const { el, p } = at
    const box = el.getBoundingClientRect(), text = v.contentDOM.getBoundingClientRect()
    if (!margin && n.id !== DRAFT) {
      // (in the gutter left of the text; without room there, at the line's end. Several on one line side by side)
      const line = v.state.doc.lineAt(pos).number, k = `${paneIds.get(el)}:${views.get(v)}:${line}`, i = perLine.get(k) ?? 0
      perLine.set(k, i + 1)
      const gutter = text.left - box.left >= 18
      const x = gutter ? text.left - 15 - i * 9 : Math.min(text.right + 2 + i * 9, box.right - 22)
      p.dots.push({ n, x, y: topOf(v, pos) + v.defaultLineHeight / 2 })
      continue
    }
    const edge = box.right, right = text.right
    const folded = edge - right < MARGIN
    p.cards.push({ n, v, x: folded ? Math.min(right + 4, edge - 26) : right + 10, y: topOf(v, pos), folded, nudge: Math.max(0, Math.min(12, edge - right - MARGIN)) })
    if (!caret && v.hasFocus) {
      const doc = v.state.doc, head = doc.lineAt(v.state.selection.main.head).number
      if (head >= doc.lineAt(pos).number && head <= doc.lineAt(Math.min(doc.length, pos + (n.find?.length ?? 0))).number) caret = n.id
    }
  }
  const open = s.picked ?? caret
  const hOf = (c: Placed) => heights.current.get(c.n.id) ?? (c.folded && !c.open ? 20 : 80)
  for (const p of panes.values()) {
    const lo = p.top + 8, hi = p.bottom - 8
    // (one open past the pane's foot slides up to fit, when its line shows)
    const fit = (c: Placed) => { if (c.y < hi && c.y + hOf(c) > hi) c.y = Math.max(lo, hi - hOf(c)) }
    p.cards.sort((a, b) => a.y - b.y)
    for (const c of p.cards) {
      c.open = c.n.id === open
      if (c.folded && c.open) { c.x -= 198; c.y += 24; fit(c) }
      if (!c.open) c.x += c.nudge
    }
    // (top to bottom, none covering another: the open one by its line, the others moved off it)
    const stack = p.cards.filter((c) => !c.folded), f = stack.findIndex((c) => c.open)
    if (f >= 0) fit(stack[f])
    for (let i = Math.max(0, f) + (f >= 0 ? 1 : 0), bottom = f >= 0 ? stack[f].y + hOf(stack[f]) : -Infinity; i < stack.length; i++) {
      stack[i].y = Math.max(stack[i].y, bottom + 8); bottom = stack[i].y + hOf(stack[i])
    }
    for (let i = f - 1; i >= 0; i--) stack[i].y = Math.min(stack[i].y, stack[i + 1].y - 8 - hOf(stack[i]))
    for (const c of p.cards) {
      const need = c.y + hOf(c) + 16 + p.under - c.v.contentDOM.getBoundingClientRect().bottom
      rooms.current.set(c.v, Math.max(rooms.current.get(c.v) ?? 0, need))
    }
  }
  // (a selection being made: Add comment in the margin, level with where it ends)
  const sp = sv && paneOf(sv)
  if (sv && sp) {
    const sel = sv.state.selection.main, box = sp.el.getBoundingClientRect(), right = sv.contentDOM.getBoundingClientRect().right
    const head = sel.head === sel.to && sv.state.doc.lineAt(sel.to).from === sel.to ? sel.to - 1 : sel.head, y = topOf(sv, head)
    if (y >= sp.p.top && y <= sp.p.bottom - 28) { sp.p.add = { x: box.right - right < MARGIN ? Math.min(right + 4, box.right - 30) : right + 10, y: y - 2 }; adding = true }
  }
  // (the open and the hovered card's text lit more)
  const lit = [...new Set([open, hovered])].filter((x): x is string => !!x).map((id) => `.cm-content .cm-companion-anchor[data-companion-mark="${CSS.escape(id)}"]`).join(", ")
  const minute = Math.floor(Date.now() / 60000)
  const measured = (id: string, h: number) => { if (heights.current.get(id) !== h) { heights.current.set(id, h); requestAnimationFrame(redraw) } }
  return createPortal(
    <div className="companion-overlay" data-companion={s.connected ? "on" : "off"}>
      <style>{STYLE}</style>
      {lit && <style>{`${lit} { background-color: color-mix(in srgb, var(--c) 38%, transparent); box-shadow: 0 1.5px 0 color-mix(in srgb, var(--c) 85%, transparent); }`}</style>}
      {[...panes.values()].map((p) => (
        <div key={p.id} className="pointer-events-none fixed inset-x-0 z-(--z-page-float) overflow-hidden" style={{ top: p.top, height: Math.max(0, p.bottom - p.top) }}>
          {p.cards.map((c) => <Card key={c.n.id} n={c.n} x={c.x} y={c.y - p.top} folded={c.folded} open={!!c.open} cap={Math.max(120, p.bottom - p.top - 16)}
            minute={minute} onHeight={(h) => measured(c.n.id, h)} onOpen={(o) => pick(o ? c.n.id : null)} onHover={(on) => setHovered((h) => (on ? c.n.id : h === c.n.id ? null : h))} />)}
          {p.add && <AddComment x={p.add.x} y={p.add.y - p.top} />}
          {p.dots.map((d) => <Gutter key={d.n.id} n={d.n} x={d.x} y={d.y - p.top} picked={s.picked === d.n.id} />)}
        </div>
      ))}
      {!off && notes.filter((n) => n.kind === "highlight" && !n.path && (n.pane || n.ui)).map((n) => <PaneMark key={n.id} n={n} />)}
      {phone && <PhoneLayer agents={off ? [] : s.agents} popped={popped} setPopped={setPopped}
        sayOf={(a) => { const mine = says(a); return { said: mine.findLast((n) => !heldBack(n)) ?? null, waiting: mine.some(heldBack) } }} />}
      {!phone && cursors.map(({ a, spot, said, waiting, with: others, under, shift }) => spot && <Cursor key={a.name} a={a} spot={spot} said={said} waiting={waiting} others={others} under={under} shift={shift}
        age={Date.now() - a.t < 3000 ? 0 : Date.now() - a.t <= 4000 ? 1 : Date.now() - a.t <= 8000 ? 2 : 3} typed={typing?.agent === a.name}
        open={popped === a.name} setOpen={(o) => setPopped((was) => (o ? a.name : was === a.name ? null : was))} pop={setPopped} hold={(on, at, text) => hold(a.name, on, at, text)} />)}
    </div>,
    document.body,
  )
}

/** An agent's highlight in a pane (a terminal's text, a page's element) or on the app's UI: a ring in its colour. */
function PaneMark({ n }: { n: Note }) {
  const el = n.ui ? uiElement(n.ui) : null, b = el ? el.getBoundingClientRect() : paneBox(n)
  if (!b || !b.width) return null
  const over = !el && !!(b as { over?: boolean }).over, tint = tintOf(n.agent)
  return (
    <div data-companion-highlight={n.id} data-floats={over ? "" : undefined} data-under-pages={over ? undefined : ""} className="companion-fade pointer-events-none fixed rounded-[5px] z-(--z-page-float)"
      style={{ left: b.left - 3, top: b.top - 2, width: b.width + 6, height: b.height + 4, boxShadow: `0 0 0 2px ${tint}`, background: `color-mix(in srgb, ${tint} 14%, transparent)` }} />
  )
}

/** A thread's dot by its line (centred on `y`): hovered, who and its first words; clicked, the thread in the panel. */
function Gutter({ n, x, y, picked }: { n: Note; x: number; y: number; picked: boolean }) {
  const tint = threadTint(n)
  return (
    <button type="button" aria-label={`${authorOf(n)}'s ${n.kind}`} data-companion-gutter={n.id} data-picked={picked || undefined} data-tip={`${authorOf(n)}: ${cut(snippet(n.text ?? n.replace ?? ""), 80)}`}
      onClick={() => showThread(n.id)}
      className="companion-fade pointer-events-auto absolute top-0 left-0 grid size-5 cursor-pointer place-items-center rounded-full [@media(pointer:coarse)]:size-8"
      style={{ transform: `translate(${x}px, ${y}px) translate(-50%, -50%)` }}>
      <span className={cn("rounded-full transition-[width,height,box-shadow]", picked ? "size-2.5" : "size-2")}
        style={{ background: tint, boxShadow: picked ? `0 0 0 3px color-mix(in srgb, ${tint} 30%, transparent)` : undefined }} />
    </button>
  )
}
