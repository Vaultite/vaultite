// Suggestions inside a ```block-<name> fence from its declaration (core/blocks.ts): the options it doesn't have yet at a
// line's start, an option's values after `key: `. Live preview shows a block's text while the cursor is in it, so both.
import type { Completion, CompletionContext } from "@codemirror/autocomplete"
import type { EditorView } from "@codemirror/view"
import { allOptions, typeText, type BlockDecl, type OptionDecl } from "../../../core/blocks.ts"
import { blockOpening, FENCE } from "../../../core/sections.ts"

/** How far up a block's opening fence is looked for (a block's options are a few lines). */
const REACH = 100

const types = (d: OptionDecl) => (Array.isArray(d.type) ? d.type : [d.type])

/** The block the cursor is in, by its fence (```block-<name> above it, no ``` between), and the keys it has. */
function blockAt(ctx: CompletionContext): { name: string; keys: Set<string> } | null {
  const doc = ctx.state.doc, at = doc.lineAt(ctx.pos).number
  if (FENCE.test(doc.line(at).text)) return null
  for (let n = at - 1; n >= 1 && n >= at - REACH; n--) {
    const t = doc.line(n).text
    if (!FENCE.test(t)) continue
    const name = blockOpening(t)
    if (!name) return null
    const keys = new Set<string>()
    for (let k = n + 1; k <= doc.lines && !FENCE.test(doc.line(k).text); k++) {
      const key = k !== at && /^([\w-]+)\s*:/.exec(doc.line(k).text)
      if (key) keys.add(key[1])
    }
    return { name, keys }
  }
  return null
}

/** The completion source; `declFor`: a block's declaration by its name (null: none, nothing suggested). */
export function blockOptionSource(declFor: (name: string) => BlockDecl | null) {
  return (ctx: CompletionContext) => {
    const block = blockAt(ctx)
    const decl = block && declFor(block.name)
    if (!block || !decl) return null
    const line = ctx.state.doc.lineAt(ctx.pos)
    const before = ctx.state.sliceDoc(line.from, ctx.pos)
    const all = allOptions(decl)
    const key = /^[\w-]*$/.exec(before)
    if (key) {
      // (on an empty line only when asked: Ctrl-Space)
      if (!before && !ctx.explicit) return null
      const options: Completion[] = Object.entries(all).filter(([k]) => !block.keys.has(k)).map(([k, d], i) => ({
        label: k, detail: typeText(d), info: d.description, type: "property", boost: -i,
        apply: (view: EditorView, _c: Completion, from: number, to: number) => {
          const insert = `${k}: `
          view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length }, userEvent: "input.complete" })
        },
      }))
      return options.length ? { from: line.from, options, validFor: /^[\w-]*$/ } : null
    }
    const value = /^([\w-]+):[ \t]*([\w-]*)$/.exec(before)
    const d = value && Object.hasOwn(all, value[1]) ? all[value[1]] : null
    if (!value || !d) return null
    const ts = types(d)
    const values = [...(ts.includes("enum") ? d.values ?? [] : []), ...(ts.includes("boolean") ? [true, false] : [])]
    if (!values.length) return null
    return {
      from: ctx.pos - value[2].length, validFor: /^[\w-]*$/,
      options: values.map((v) => ({ label: String(v), detail: v === d.default ? "default" : undefined, type: "constant" })),
    }
  }
}
