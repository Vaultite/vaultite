import { closeCompletion, type Completion, type CompletionContext, completionStatus, selectedCompletion, startCompletion } from "@codemirror/autocomplete"
import { StateEffect, StateField, Transaction } from "@codemirror/state"
import { EditorView, showTooltip, type Tooltip, type ViewUpdate } from "@codemirror/view"
import { capitalize, keyHint, notifyError, op } from "@vaultite"
import { canMention, effortName, getState, type How, howOf, howText, liveAgents, mentionAgent, nameAs, views } from "./live"
import { privateNote } from "./private"

const startOf = (c: Completion | null) => (c as (Completion & { startAs?: string }) | null)?.startAs

function begin(view: EditorView, path: string, name: string, from: number, to: number, how: How) {
  const insert = `${name.toLowerCase()} `
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.complete" })
  void op("companion.start", { as: nameAs(name), ...(how.agent ? { agent: how.agent } : {}), ...(how.model ? { model: how.model } : {}), ...(how.effort ? { effort: how.effort } : {}),
    path, line: view.state.doc.lineAt(from).number }).catch((e) => notifyError(e, `Couldn't start ${nameAs(name)}`))
}

export const mentions = (path: string) => (ctx: CompletionContext) => {
  const m = ctx.matchBefore(/@[\w-]*$/)
  if (!m || getState().mode === "off" || privateNote(path, ctx.state.doc.sliceString(0, 4096)) || !canMention(ctx.state.sliceDoc(ctx.state.doc.lineAt(m.from).from, m.from))) return null
  const st = getState(), names = liveAgents().map((a) => a.name), typed = m.text.slice(1)
  const known = [...new Set(["companion", st.fresh.agent.split("_")[0] || "claude", st.name, ...names].map((n) => n.toLowerCase()))]
  const named = Object.keys(st.profiles).filter((p) => !known.includes(p))
  const some = (t: string) => [...known, ...named].some((n) => n.startsWith(t.toLowerCase()))
  const options: (Completion & { highlight?: string; startAs?: string; trail?: (view: EditorView) => Node })[] = (names.length ? names : [st.name]).map((n) => ({ label: n.toLowerCase(), detail: n === st.name ? "companion" : undefined,
    boost: n === st.name ? 1 : 0, apply: `${n.toLowerCase()} `, highlight: mentionAgent(n)?.tint ?? "orange" }))
  const start = (name: string, how: How, boost: number) => ({ label: name, displayLabel: `Start @${name}`, boost, startAs: name,
    ...(rowsOf(how).length ? { trail: (view: EditorView) => startChip(view, name, how) } : { detail: howText(how) }),
    apply: (view: EditorView, _c: Completion, from: number, to: number) => begin(view, path, name, from, to, how) })
  if (typed) for (const p of named) options.push(start(p, st.profiles[p], -50))
  const fresh = !!typed && typed.length <= 30 && !some(typed)
  if (fresh) options.push(start(typed, howOf(typed), -99))
  return { from: m.from + 1, options, ...(fresh ? {} : { validFor: (t: string) => /^[\w-]*$/.test(t) && (typed ? some(t) : !t) }) }
}

type Row = { key: "agent" | "model" | "effort"; label: string; list: { id: string; label: string }[]; on: string }
function rowsOf(c: How): Row[] {
  const id = c.agent.split("_")[0], hs = getState().harnesses.filter((x) => x.installed || x.id === id), h = hs.find((x) => x.id === id)
  return [
    ...(hs.length > 1 ? [{ key: "agent" as const, label: "Agent", list: hs.map((x) => ({ id: x.id, label: x.name })), on: id }] : []),
    ...(h?.models.length ? [{ key: "model" as const, label: "Model", list: h.models, on: c.model }] : []),
    ...(h?.efforts.length ? [{ key: "effort" as const, label: "Effort", list: h.efforts.map((e) => ({ id: e, label: capitalize(effortName(e)) })), on: c.effort }] : []),
  ]
}
function agentPicked(id: string): How {
  const st = getState()
  return st.fresh.agent.split("_")[0] === id ? st.fresh : st.profiles[id] ?? { agent: id, model: "", effort: "" }
}

type Choice = How & { name: string; from: number; row: number; tip: Tooltip }
const choose = StateEffect.define<Choice | null>()
export const chooser = StateField.define<Choice | null>({
  create: () => null,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(choose)) return e.value
    if (v && tr.docChanged && !tr.selection && tr.annotation(Transaction.remote) && !tr.changes.touchesRange(v.from - 1, v.from + v.name.length)) {
      const from = tr.changes.mapPos(v.from)
      return from === v.from ? v : { ...v, from, tip: { ...v.tip, pos: from - 1 } }
    }
    return v && (tr.docChanged || tr.selection) ? null : v
  },
  provide: (f) => showTooltip.from(f, (v) => v?.tip ?? null),
})

function openChooser(view: EditorView, name = completionStatus(view.state) === "active" ? startOf(selectedCompletion(view.state)) : undefined) {
  if (!name) return false
  const st = getState(), how = Object.hasOwn(st.profiles, name.toLowerCase()) ? st.profiles[name.toLowerCase()] : howOf(name)
  if (!rowsOf(how).length) return false
  const from = view.state.selection.main.head - name.length
  closeCompletion(view)
  view.dispatch({ effects: choose.of({ ...how, name, from, row: 0, tip: { pos: from - 1, above: false, create: (v) => chooserView(v) } }) })
  return true
}

export const picked = (c: Choice, r: Row, id: string): Choice => (r.key === "agent" ? { ...c, ...agentPicked(id) } : { ...c, [r.key]: id })

export function chooserKey(key: string) {
  return (view: EditorView) => {
    const c = view.state.field(chooser, false)
    if (!c) return key === "Tab" || key === "ArrowRight" ? openChooser(view) : false
    const rows = rowsOf(c), row = Math.min(c.row, rows.length - 1), r = rows[row]
    if (r && (key === "ArrowLeft" || key === "ArrowRight")) {
      const at = r.list.findIndex((x) => x.id === r.on), n = r.list.length
      const next = at < 0 ? (key === "ArrowLeft" ? n - 1 : 0) : (at + (key === "ArrowLeft" ? n - 1 : 1)) % n
      view.dispatch({ effects: choose.of({ ...picked(c, r, r.list[next].id), row }) })
    } else if (key === "ArrowUp" || key === "Shift-Tab") view.dispatch({ effects: choose.of({ ...c, row: (row + rows.length - 1) % rows.length }) })
    else if (key === "ArrowDown" || key === "Tab") view.dispatch({ effects: choose.of({ ...c, row: (row + 1) % rows.length }) })
    else if (key === "Enter") { view.dispatch({ effects: choose.of(null) }); begin(view, pathOf(view), c.name, c.from, c.from + c.name.length, c) }
    else if (key === "Escape") { view.dispatch({ effects: choose.of(null) }); startCompletion(view) }
    return true
  }
}
const pathOf = (view: EditorView) => views.get(view) ?? ""

function startChip(view: EditorView, name: string, how: How) {
  const chip = document.createElement("span")
  chip.className = "cm-companion-chip"
  chip.setAttribute("role", "button")
  chip.textContent = `${howText(how)} ›`
  // CodeMirror's completion list applies its row on mousedown, a tap's too: stopped before it bubbles there
  chip.addEventListener("mousedown", (e) => { e.preventDefault(); e.stopPropagation(); openChooser(view, name) })
  return chip
}

function chooserView(view: EditorView) {
  const dom = document.createElement("div")
  dom.className = "cm-companion-start"
  dom.setAttribute("data-companion-start", "")
  dom.addEventListener("mousedown", (e) => e.preventDefault())
  const draw = (c: Choice | null) => {
    if (!c) return
    dom.replaceChildren()
    rowsOf(c).forEach((rw, i, rows) => {
      const r = dom.appendChild(document.createElement("div"))
      r.className = `cm-companion-start-row${Math.min(c.row, rows.length - 1) === i ? " cm-companion-start-on" : ""}`
      r.setAttribute("data-row", rw.key)
      r.appendChild(document.createElement("span")).textContent = rw.label
      const picks = r.appendChild(document.createElement("div"))
      for (const x of rw.list.some((y) => y.id === rw.on) || !rw.on ? rw.list : [{ id: rw.on, label: capitalize(rw.on) }, ...rw.list]) {
        const b = picks.appendChild(document.createElement("button"))
        b.type = "button"
        b.textContent = x.label
        if (x.id === rw.on) b.setAttribute("aria-pressed", "true")
        b.onclick = () => view.dispatch({ effects: choose.of({ ...picked(c, rw, x.id), row: i }) })
      }
    })
    const go = dom.appendChild(document.createElement("button"))
    go.type = "button"
    go.className = "cm-companion-start-go"
    go.textContent = `Start @${c.name}`
    go.appendChild(document.createElement("kbd")).textContent = keyHint("Enter")
    go.onclick = () => chooserKey("Enter")(view)
  }
  draw(view.state.field(chooser, false) ?? null)
  return { dom, update: (u: ViewUpdate) => { const c = u.state.field(chooser, false); if (c !== u.startState.field(chooser, false)) draw(c ?? null) } }
}