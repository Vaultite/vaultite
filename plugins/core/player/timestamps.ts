import { RangeSetBuilder, StateEffect, StateField, type Extension, type Transaction } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view"
import { getStore, resolver, type EditorCtx } from "@vaultite"
import { mediaIn } from "./shelves"
import { getNow, seek, subscribeTime } from "./now"

const TIME = /(?<![\d:.])(?:(\d{1,2}):)?([0-5]?\d):([0-5]\d)(?![\d:])/g
const secs = (m: RegExpExecArray) => Number(m[1] ?? 0) * 3600 + Number(m[2]) * 60 + Number(m[3])

type Stamp = { from: number; to: number; t: number }
function stamps(text: string): Stamp[] {
  const out: Stamp[] = []
  for (const m of text.matchAll(TIME)) out.push({ from: m.index!, to: m.index! + m[0].length, t: secs(m) })
  return out
}

const lit = StateEffect.define<number>()
const again = StateEffect.define<null>()
const mark = Decoration.mark({ class: "cm-timestamp" })
const litMark = Decoration.mark({ class: "cm-timestamp cm-timestamp-now" })

function mediaOf(text: string, path: string) {
  const target = mediaIn(text)
  const store = getStore()
  return target && store ? resolver(store)(target, path)?.file ?? null : null
}

function touchesEmbed(tr: Transaction) {
  let hit = false
  tr.changes.iterChangedRanges((_fa, _ta, from, to) => {
    if (hit) return
    const doc = tr.newDoc, text = doc.sliceString(doc.lineAt(from).from, doc.lineAt(to).to)
    hit = text.includes("![[") || text.includes("]]")
  })
  return hit
}

export function timestamps(ctx: EditorCtx): Extension {
  const path = ctx.path
  if (ctx.kind !== "markdown" || !path) return []
  const field = StateField.define<{ media: string | null; list: Stamp[]; now: number; deco: DecorationSet }>({
    create: (s) => build(s.doc.toString(), -1),
    update(v, tr) {
      let now = v.now, redo = false
      for (const e of tr.effects) { if (e.is(lit)) now = e.value; if (e.is(again)) redo = true }
      if (!tr.docChanged && !redo && now === v.now) return v
      if (!v.media && !redo && now === v.now && !touchesEmbed(tr)) return v
      return build(tr.newDoc.toString(), now)
    },
    provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
  })
  function build(text: string, now: number) {
    const media = mediaOf(text, path!)
    const list = media ? stamps(text) : []
    const b = new RangeSetBuilder<Decoration>()
    list.forEach((s, i) => b.add(s.from, s.to, i === now ? litMark : mark))
    return { media, list, now, deco: b.finish() }
  }
  const follow = ViewPlugin.define((view) => {
    let tries = 0
    const find = setInterval(() => {
      const v = view.state.field(field)
      if (v.media || !mediaIn(view.state.doc.toString()) || ++tries > 20) return clearInterval(find)
      if (getStore()) view.dispatch({ effects: again.of(null) })
    }, 500)
    const off = subscribeTime(() => {
      const v = view.state.field(field), playing = getNow()
      if (!v.media || playing?.path !== v.media) return
      const t = playing.el.currentTime
      let i = -1
      v.list.forEach((s, k) => { if (s.t <= t && (i < 0 || s.t >= v.list[i].t)) i = k })
      if (i !== v.now) view.dispatch({ effects: lit.of(i) })
    })
    return { destroy: () => { off(); clearInterval(find) } }
  })
  const click = EditorView.domEventHandlers({
    click(e, view) {
      const hit = e.target instanceof Element ? e.target.closest(".cm-timestamp") : null
      if (!hit || e.metaKey || e.ctrlKey || e.shiftKey) return false
      const v = view.state.field(field)
      const pos = view.posAtDOM(hit)
      const s = v.list.find((x) => pos >= x.from && pos <= x.to)
      if (!s || !v.media) return false
      e.preventDefault()
      seek(v.media, s.t, view.dom.closest("[data-pane], [data-stacked]") ?? view.dom)
      return true
    },
  })
  return [field, follow, click, theme]
}

const theme = EditorView.baseTheme({
  ".cm-timestamp": { color: "var(--primary)", cursor: "pointer", borderRadius: "4px", textDecoration: "underline", textDecorationColor: "color-mix(in srgb, var(--primary) 35%, transparent)", textUnderlineOffset: "3px" },
  ".cm-timestamp-now": { backgroundColor: "color-mix(in srgb, var(--primary) 16%, transparent)", textDecoration: "none" },
})
