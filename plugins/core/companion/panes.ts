// The window's panes for the companion (live.ts' `where`): each pane's tab, title and tab group, and the focused one;
// and the parts of the app's UI it follows, watched here (their text, as it settles).
import { Eye } from "lucide-react"
import { focusedPane, getStore, getTabLayout, noticesSince, notifyError, onTabLayoutChange, op, panelSide, panesOf, revealPanel, setSidebarMode, setUiMarks, sidebarMode, shownTab, tabLabel, tabOfPane, type UiMark } from "@vaultite"
import { getState, sayWhereSoon, setPanes, subscribe, tintOf, uiChanged, type Follow } from "./live"

/** The most a window tells: a vault's tabs, rarely this many. */
const MOST = 300

setPanes(() => {
  const w = getTabLayout(), store = getStore(), shown = shownTab(w)
  const panes = w.tabs.flatMap((t) => panesOf(t).map((p) => ({ id: p.id, to: p.to, title: tabLabel(p, store).label, tab: t.id, ...(t.group ? { group: t.group } : {}) }))).slice(0, MOST)
  return { panes, pane: shown && focusedPane(shown).id }
})

/** The element on screen with data-ui `id` (the first shown), or null. */
export function uiElement(id: string): HTMLElement | null {
  return [...document.querySelectorAll<HTMLElement>(`[data-ui="${CSS.escape(id)}"]`)].find((e) => e.getClientRects().length > 0) ?? null
}

const CLICKABLE = "button, a[href], [role=button], [role=link], [role=menuitem], [role=tab], [role=treeitem], [role=option], [role=checkbox], [role=switch], [tabindex], [data-ui]"
/** In `root`, the element showing `find` (its words or its label), the shortest such: what to click for it. */
export function shown(root: HTMLElement, find: string): HTMLElement | null {
  const want = find.toLowerCase(), hits: HTMLElement[] = []
  for (const e of [root, ...root.querySelectorAll<HTMLElement>("*")]) {
    if (!e.getClientRects().length || e.closest(".companion-overlay")) continue
    const label = (e.getAttribute("aria-label") ?? e.dataset.tip ?? "").toLowerCase()
    if (label.includes(want) || (e.childElementCount === 0 && (e.innerText || "").toLowerCase().includes(want))) hits.push(e)
  }
  const exact = (e: HTMLElement) => [(e.innerText || "").trim().toLowerCase(), (e.getAttribute("aria-label") ?? "").toLowerCase()].includes(want)
  const best = hits.sort((a, b) => Number(exact(b)) - Number(exact(a)) || (a.innerText || "").length - (b.innerText || "").length)[0]
  return best ? (best.closest<HTMLElement>(CLICKABLE) && root.contains(best.closest(CLICKABLE)) ? best.closest<HTMLElement>(CLICKABLE)! : best) : null
}
/** What a part of the app's UI shows now, as lines (a panel's rows, a tab's title): what an agent is told after its
 *  click, so it can name and point at what came into sight. */
export function uiText(el: HTMLElement, most = 60) {
  const lines = [...new Set((el.innerText || "").split("\n").map((l) => l.trim()).filter(Boolean))]
  return lines.slice(0, most).map((l) => l.slice(0, 120)).join("\n") + (lines.length > most ? `\n… ${lines.length - most} more` : "")
}
const settle = () => new Promise((done) => setTimeout(done, 400))
/** An agent's click on the app's own UI (companion act --ui): `ui`'s element (none: the window) or what shows `find` in
 *  it, pressed; what it was, shows then, and its toasts. A whole panel opens (its container has no click of its own). */
export async function clickUi(m: Record<string, unknown>) {
  const id = String(m.ui ?? ""), find = String(m.find ?? "").trim(), from = Date.now()
  const panel = /^panel:(.+)$/.exec(id)?.[1]
  if (panel && !find) {
    // (the left sidebar showing one panel alone: this one, shown again; another, its panels again, this one among them)
    const mode = sidebarMode()
    if (mode === panel) setSidebarMode(panel)
    else {
      if (mode && panelSide(panel) === "left") setSidebarMode(null)
      if (!revealPanel(panel)) return { found: false }
    }
    await settle()
    const el = uiElement(id) ?? document.querySelector<HTMLElement>(`[data-sidebar-mode="${CSS.escape(panel)}"]`)
    return { found: !!el, opened: true, label: el?.querySelector<HTMLElement>("[data-heading]")?.dataset.heading ?? "", shows: el ? uiText(el) : "",
      notices: noticesSince(from).map((n) => ({ text: n.text, kind: n.kind })) }
  }
  const root = id ? uiElement(id) : document.body
  if (!root) return { found: false }
  const el = find ? shown(root, find) : root
  if (!el) return { found: false }
  el.scrollIntoView({ block: "nearest" })
  const r = el.getBoundingClientRect(), at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0 }
  const dbl = m.action === "dblclick"
  for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(t.startsWith("pointer") ? new PointerEvent(t, { ...at, pointerId: 1, isPrimary: true, pointerType: "mouse" }) : new MouseEvent(t, at))
  el.click()
  if (dbl) el.dispatchEvent(new MouseEvent("dblclick", at))
  await settle()
  // (what holds it now: a panel's rows after a heading's click, the element itself else)
  const holder = (el.isConnected ? el : null)?.closest<HTMLElement>("[data-ui^='panel:']") ?? (id && uiElement(id)) ?? null
  return { found: true, label: (el.getAttribute("aria-label") || el.innerText || "").trim().slice(0, 120), ...(holder ? { shows: uiText(holder) } : {}),
    notices: noticesSince(from).map((n) => ({ text: n.text, kind: n.kind })) }
}
/** What the app's UI part `ui` shows now (companion see --ui), or null when it isn't on screen. */
export function readUi(m: Record<string, unknown>) {
  const id = String(m.ui ?? ""), alone = /^panel:(.+)$/.exec(id)?.[1]
  const el = uiElement(id) ?? (alone ? document.querySelector<HTMLElement>(`[data-sidebar-mode="${CSS.escape(alone)}"]`) : null)
  return el ? { found: true, label: el.querySelector<HTMLElement>("[data-heading]")?.dataset.heading ?? el.getAttribute("aria-label") ?? "", folded: el.hasAttribute("data-collapsed"), text: uiText(el, 200) } : { found: false }
}

const TEXT_GAP = 5000
/** Each followed UI part's text as last told. */
const told = new Map<string, string>()
let timer = 0

/** What it follows in the app's UI (a panel, a button: not panes or groups, which the server reads), checked every
 *  few seconds while the window is seen: a change in its text goes as a moment, a few lines. */
function check() {
  const st = getState(), ui = st.follows.filter((f) => f.ui && !/^(tab|pane|group):/.test(f.ui))
  for (const k of [...told.keys()]) if (!ui.some((f) => `${f.agent}/${f.ui}` === k)) told.delete(k)
  if (!ui.length) { clearInterval(timer); timer = 0; return }
  if (document.visibilityState !== "visible") return
  for (const f of ui) {
    const el = uiElement(f.ui!), text = el ? (el.innerText || "").trim().slice(0, 8000) : null, k = `${f.agent}/${f.ui}`, was = told.get(k)
    if (text === null) continue
    told.set(k, text)
    if (was === undefined || was === text) continue
    const before = new Set(was.split("\n").map((l) => l.trim())), now = text.split("\n").map((l) => l.trim()).filter(Boolean)
    const added = now.filter((l) => !before.has(l)), gone = [...before].filter((l) => l && !now.includes(l))
    uiChanged(f.agent, f.ui!, [...gone.slice(0, 6).map((l) => `- ${l.slice(0, 200)}`), ...added.slice(0, 18).map((l) => `+ ${l.slice(0, 200)}`)], f.title || undefined)
  }
}

/** What the rows were last marked with (the state changes with every cursor move: marked again only when this does). */
let marked = ""
/** The rows of what it follows (a tab, its pane, a group) show an eye: a click stops following it. */
function markFollows() {
  const marks = new Map<string, UiMark[]>(), l = getTabLayout(), was = marked
  const row = (f: Follow) => (f.tab ? `tab:${f.tab}` : f.group ? `group:${f.group}` : f.pane ? (tabOfPane(l, f.pane) ? `tab:${tabOfPane(l, f.pane)!.id}` : null) : /^(tab|group):/.test(f.ui ?? "") ? f.ui! : null)
  const ids: string[] = []
  for (const f of getState().follows) {
    const at = row(f)
    if (!at) continue
    ids.push(`${at} ${f.id}`)
    const stop = () => { op("companion.unfollow", { id: f.id, as: f.agent }).catch((e) => notifyError(e, "Couldn't stop following it")) }
    marks.set(at, [...(marks.get(at) ?? []), { icon: Eye, label: `Stop ${f.agent} following this`, tint: tintOf(f.agent), run: stop }])
  }
  marked = ids.join("\n")
  if (marked !== was) setUiMarks("companion", marks)
}

/** Start telling the server: the panes as the tabs change, and the UI it follows. */
export function watchPanes() {
  const offs = [onTabLayoutChange(() => { sayWhereSoon(); markFollows() }),
    subscribe(() => { markFollows(); if (!timer && getState().follows.some((f) => f.ui)) timer = window.setInterval(check, TEXT_GAP) })]
  markFollows()
  return () => { for (const off of offs) off(); clearInterval(timer); timer = 0; marked = ""; setUiMarks("companion", new Map()) }
}
