import { Eye } from "lucide-react"
import { focusedPane, getStore, getTabLayout, noticesSince, notifyError, onTabLayoutChange, op, panesOf, revealUi, setUiMarks, shownTab, tabLabel, tabOfPane, type UiMark } from "@vaultite"
import { checkDom, domTree, domView, resolveDom, uiElement } from "./uidom"
import { actionable, parseCondition, stateWords, stepEffect, type State, type Target } from "../../../core/desktop/uimodel"
import { shownText } from "./linked"
import { getState, sayWhereSoon, setPanes, subscribe, tintOf, uiChanged, type Follow } from "./live"

const MOST = 300

setPanes(() => {
  const w = getTabLayout(), store = getStore(), shown = shownTab(w)
  const panes = w.tabs.flatMap((t) => panesOf(t).map((p) => ({ id: p.id, to: p.to, title: tabLabel(p, store).label, tab: t.id, ...(t.group ? { group: t.group } : {}) }))).slice(0, MOST)
  return { panes, pane: shown && focusedPane(shown).id }
})

export { uiElement }

export function uiText(el: HTMLElement, most = 60) {
  const lines = [...new Set(shownText(el).split("\n").map((l) => l.trim()).filter(Boolean))]
  return lines.slice(0, most).map((l) => l.slice(0, 120)).join("\n") + (lines.length > most ? `\n… ${lines.length - most} more` : "")
}
const settle = () => new Promise((done) => setTimeout(done, 400))
const WANTS: Record<string, [keyof State, boolean]> = { expand: ["expanded", true], collapse: ["expanded", false], check: ["checked", true], uncheck: ["checked", false], select: ["selected", true] }
let before: string | undefined
const notices = (from: number) => noticesSince(from).map((n) => ({ text: n.text, kind: n.kind }))
const holderOf = (e: Element | null) => e?.closest<HTMLElement>("[data-ui^='panel:']") ?? null

export async function clickUi(m: Record<string, unknown>) {
  const id = String(m.ui ?? ""), find = String(m.find ?? "").trim(), role = String(m.role ?? "").trim(), how = String(m.how ?? "click"), from = Date.now()
  const want = WANTS[how], fold = how === "expand" ? "expand" : how === "collapse" ? "collapse" : undefined
  const target: Target = find ? { name: find, ...(role ? { role } : {}) } : { ui: id }
  if (!find && !id) return { found: false }
  let root: Element | null = find && id ? uiElement(id) : document.body
  if (!root && revealUi(id)) { await settle(); root = uiElement(id) }
  if (!root) return { found: false }
  let r = resolveDom(target, fold, root)
  before = domView().snapshot()
  const place = !find ? id : r && !actionable(r.named) ? r.named.ui : undefined
  if (place && (how === "click" || how === "expand")) {
    if (revealUi(place)) {
      await settle()
      const el = uiElement(place), now = el && resolveDom({ ui: place }, "expand")
      const open = !!el && now?.thing.state.expanded !== false
      return { found: !!el, opened: true, ok: open, saw: open ? `${JSON.stringify(now?.named.label || place)} is open now` : `${JSON.stringify(now?.named.label || place)} didn't open`,
        label: now?.named.label ?? "", ...(el ? { shows: uiText(el) } : {}), notices: notices(from) }
    }
    if (!r) return { found: false }
  }
  if (!r) return { found: false }
  const was = r.thing
  if (want && was.state[want[0]] === want[1]) {
    const holder = holderOf(r.e)
    return { found: true, already: true, ok: true, label: was.label, role: was.role, saw: `${JSON.stringify(was.label)} is already ${stateWords({ [want[0]]: want[1] })}`, ...(holder ? { shows: uiText(holder) } : {}), notices: [] }
  }
  const el = r.e as HTMLElement
  el.scrollIntoView({ block: "nearest" })
  const b = el.getBoundingClientRect(), at = { bubbles: true, cancelable: true, clientX: b.left + b.width / 2, clientY: b.top + b.height / 2, button: 0 }
  for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(t.startsWith("pointer") ? new PointerEvent(t, { ...at, pointerId: 1, isPrimary: true, pointerType: "mouse" }) : new MouseEvent(t, at))
  el.click()
  if (how === "dblclick") el.dispatchEvent(new MouseEvent("dblclick", at))
  await settle()
  const now = el.isConnected ? domTree().thing(el) : resolveDom(target, fold, root.isConnected ? root : document.body)?.thing ?? null
  const effect = stepEffect(fold ?? (how === "select" ? "select" : "click"), was, now, domView().snapshot() !== before)
  const holder = holderOf(el.isConnected ? el : null) ?? (id ? uiElement(id) : null)
  return { found: true, ok: effect.ok, saw: effect.saw, label: was.label, role: was.role, ...(holder ? { shows: uiText(holder) } : {}), notices: notices(from) }
}
export function readUi(m: Record<string, unknown>) {
  const el = uiElement(String(m.ui ?? ""))
  if (!el) return { found: false }
  const r = resolveDom({ ui: String(m.ui) })
  return { found: true, label: r?.named.label ?? "", folded: r?.thing.state.expanded === false, text: uiText(el, 200) }
}
export function checkUi(m: Record<string, unknown>) {
  const v = checkDom(parseCondition(String(m.condition ?? "")), before)
  return { ok: v.ok, saw: v.saw, ...(v.thing ? { thing: v.thing } : {}) }
}

const TEXT_GAP = 5000
const told = new Map<string, string>()
let timer = 0

function check() {
  const st = getState(), ui = st.follows.filter((f) => f.ui && !/^(tab|pane|group):/.test(f.ui))
  for (const k of [...told.keys()]) if (!ui.some((f) => `${f.agent}/${f.ui}` === k)) told.delete(k)
  if (!ui.length) { clearInterval(timer); timer = 0; return }
  if (document.visibilityState !== "visible") return
  for (const f of ui) {
    const el = uiElement(f.ui!), text = el ? shownText(el).trim().slice(0, 8000) : null, k = `${f.agent}/${f.ui}`, was = told.get(k)
    if (text === null) continue
    told.set(k, text)
    if (was === undefined || was === text) continue
    const before = new Set(was.split("\n").map((l) => l.trim())), now = text.split("\n").map((l) => l.trim()).filter(Boolean)
    const added = now.filter((l) => !before.has(l)), gone = [...before].filter((l) => l && !now.includes(l))
    uiChanged(f.agent, f.ui!, [...gone.slice(0, 6).map((l) => `- ${l.slice(0, 200)}`), ...added.slice(0, 18).map((l) => `+ ${l.slice(0, 200)}`)], f.title || undefined)
  }
}

let marked = ""
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

export function watchPanes() {
  const offs = [onTabLayoutChange(() => { sayWhereSoon(); markFollows() }),
    subscribe(() => { markFollows(); if (!timer && getState().follows.some((f) => f.ui)) timer = window.setInterval(check, TEXT_GAP) })]
  markFollows()
  return () => { for (const off of offs) off(); clearInterval(timer); timer = 0; marked = ""; setUiMarks("companion", new Map()) }
}
