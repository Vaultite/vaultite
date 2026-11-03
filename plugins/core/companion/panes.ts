// The window's panes for the companion (live.ts' `where`): each pane's tab, title and tab group, and the focused one;
// and the parts of the app's UI it follows, watched here (their text, as it settles).
import { focusedPane, getStore, getTabLayout, onTabLayoutChange, panesOf, shownTab, tabLabel } from "@vaultite"
import { getState, sayWhereSoon, setPanes, subscribe, uiChanged } from "./live"

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

/** Start telling the server: the panes as the tabs change, and the UI it follows. */
export function watchPanes() {
  const offs = [onTabLayoutChange(() => sayWhereSoon()), subscribe(() => { if (!timer && getState().follows.some((f) => f.ui)) timer = window.setInterval(check, TEXT_GAP) })]
  return () => { for (const off of offs) off(); clearInterval(timer); timer = 0 }
}
