// The editor's side, loaded with the first note: the suggestions, `:fire:` typed whole becoming 🔥, and `:LiName:`
// drawn as its icon (reading and live preview; source mode keeps the text). The data loads when first needed.
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete"
import { syntaxTree } from "@codemirror/language"
import { EditorState, RangeSetBuilder, type Extension } from "@codemirror/state"
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from "@codemirror/view"
import type { ComponentType } from "react"
import { CLOSED, ICON_CODE, iconCode, kebab, matches, recentKey, remember, TYPING, type Emoji, type Found } from "./codes.ts"

export type Settings = { emoji?: boolean; icons?: boolean }

let emoji: Emoji[] | null = null, byName: Map<string, string> | null = null, loadingEmoji: Promise<void> | null = null
const loadEmoji = () => (loadingEmoji ??= import("gemoji").then((m) => {
  emoji = m.gemoji
  byName = new Map(emoji.flatMap((e) => e.names.map((n) => [n, e.emoji] as const)))
}))

type Icons = Record<string, ComponentType>
let icons: Icons | null = null, names: string[] | null = null, loadingIcons: Promise<void> | null = null
const iconsLoaded = new Set<() => void>()
/** Lucide's icons (the same chunk the app's named icons load). */
const loadIcons = () => (loadingIcons ??= import("lucide-react/dist/esm/icons/index.mjs").then((m) => {
  icons = m as unknown as Icons
  names = Object.keys(icons).sort()
  for (const f of iconsLoaded) f()
}))

type Drawing = { node?: [string, Record<string, string>][]; aliases?: string[] }
/** A Lucide component's own drawing and old names (what it renders is Lucide's Icon given them). */
const drawingOf = (pascal: string) => (icons?.[pascal] as unknown as { render?: (p: object, r: null) => { props?: { icon?: Drawing } } } | undefined)?.render?.({}, null)?.props?.icon

let byLower: Map<string, string> | null = null
/** Lucide's component name for one written in any case, or an old name (`:LiSmile:`, as Iconize may have written it). */
export function iconName(written: string): string | null {
  if (!icons || !names) return null
  if (icons[written]) return written
  if (!byLower) {
    byLower = new Map(names.map((k) => [k.toLowerCase(), k]))
    for (const k of names) for (const a of drawingOf(k)?.aliases ?? []) {
      const old = a.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("").toLowerCase()
      if (!byLower.has(old)) byLower.set(old, k)
    }
  }
  return byLower.get(written.toLowerCase()) ?? null
}

const NS = "http://www.w3.org/2000/svg"
const svgs = new Map<string, SVGSVGElement | null>()
/** An icon as SVG (null for an unknown one, or before Lucide's chunk is in). */
export function iconSvg(written: string): Node | null {
  const pascal = iconName(written)
  if (!pascal) return null
  if (!svgs.has(pascal)) {
    const node = drawingOf(pascal)?.node
    let svg: SVGSVGElement | null = null
    if (node) {
      svg = document.createElementNS(NS, "svg")
      const attrs = { viewBox: "0 0 24 24", width: "1em", height: "1em", fill: "none", stroke: "currentColor", "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round", "aria-hidden": "true" }
      for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v)
      for (const [tag, a] of node) {
        const el = document.createElementNS(NS, tag)
        for (const [k, v] of Object.entries(a)) if (k !== "key") el.setAttribute(k, String(v))
        svg.append(el)
      }
    }
    svgs.set(pascal, svg)
  }
  return svgs.get(pascal)?.cloneNode(true) ?? null
}

function iconEl(pascal: string) {
  const span = document.createElement("span")
  span.className = "vau-shortcode-icon"
  span.dataset.tip = kebab(iconName(pascal) ?? pascal)
  const svg = iconSvg(pascal)
  if (svg) span.append(svg)
  return span
}

// ---------- suggestions ----------

const RECENT = "vau:shortcodes:recent"
const recent = (): string[] => { try { const v = JSON.parse(localStorage.getItem(RECENT) ?? "[]"); return Array.isArray(v) ? v : [] } catch { return [] } }
const used = (f: Found) => { try { localStorage.setItem(RECENT, JSON.stringify(remember(recent(), recentKey(f)))) } catch { /* private mode */ } }

const CODE = /^(FencedCode|CodeBlock|CodeText|InlineCode|CodeInfo|CodeMark|URL|Autolink|HTMLTag|Comment)/
const inCode = (state: EditorState, at: number) => {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(at, 1); n; n = n.parent) if (CODE.test(n.name)) return true
  return false
}
/** Whether `at` is in the frontmatter (its YAML, hidden or in source mode). */
const inFrontmatter = (state: EditorState, at: number) => {
  const doc = state.doc
  if (doc.line(1).text !== "---") return false
  for (let i = 2; i <= doc.lines; i++) if (doc.line(i).text === "---") return at <= doc.line(i).from
  return true
}

const glyphOf = (f: Found) => () => {
  if (f.kind === "icon") return iconEl(f.pascal)
  const span = document.createElement("span")
  span.className = "vau-shortcode-emoji"
  span.textContent = f.emoji
  return span
}

/** `:fi` typed: emoji and icons whose names match, recently used first. Enter, Tab or a click puts it in. At once
 *  once the data is in (a list that waits lets Enter through as a new line). */
export function suggest(ctx: CompletionContext, on: Settings): CompletionResult | null | Promise<CompletionResult | null> {
  if (on.emoji === false && on.icons === false) return null
  const m = ctx.matchBefore(TYPING)
  if (!m || inCode(ctx.state, m.from) || inFrontmatter(ctx.state, m.from)) return null
  const wantEmoji = on.emoji !== false, wantIcons = on.icons !== false
  if ((wantEmoji && !emoji) || (wantIcons && !icons)) return Promise.all([wantEmoji && loadEmoji(), wantIcons && loadIcons()]).then(() => listFor(m, wantEmoji, wantIcons))
  return listFor(m, wantEmoji, wantIcons)
}

function listFor(m: { from: number; text: string }, wantEmoji: boolean, wantIcons: boolean): CompletionResult | null {
  const found = matches(m.text.slice(1), wantEmoji ? emoji : null, wantIcons ? names : null, recent())
  if (!found.length) return null
  const both = found.some((f) => f.kind === "emoji") && found.some((f) => f.kind === "icon")
  const options: (Completion & { glyph: () => Node })[] = found.map((f, i) => ({
    label: f.kind === "emoji" ? `:${f.name}:` : f.name, boost: Math.max(-99, -i), glyph: glyphOf(f),
    section: both ? (f.kind === "emoji" ? { name: "Emoji", rank: 0 } : { name: "Icons", rank: 1 }) : undefined,
    apply: (view: EditorView, _c: Completion, from: number, to: number) => {
      const insert = f.kind === "emoji" ? f.emoji : iconCode(f.pascal)
      const end = view.state.sliceDoc(to, to + 1) === ":" ? to + 1 : to
      view.dispatch({ changes: { from, to: end, insert }, selection: { anchor: from + insert.length }, scrollIntoView: true, userEvent: "input.complete" })
      used(f)
    },
  }))
  return { from: m.from, options, filter: false }
}

// ---------- in the editor ----------

class IconWidget extends WidgetType {
  pascal: string
  constructor(pascal: string) { super(); this.pascal = pascal }
  eq(o: IconWidget) { return o.pascal === this.pascal }
  toDOM() { return iconEl(this.pascal) }
}

/** `:LiName:` drawn as its icon, unless the cursor is at it while editing (its text shows, as Markdown's marks do). */
function iconDecos(view: EditorView, on: () => Settings): DecorationSet {
  const b = new RangeSetBuilder<Decoration>()
  if (on().icons === false) return b.finish()
  const { state } = view, editing = view.hasFocus && state.facet(EditorView.editable)
  let wanted = false
  for (const { from, to } of view.visibleRanges) {
    const text = state.sliceDoc(from, to)
    for (const m of text.matchAll(ICON_CODE)) {
      const a = from + m.index, z = a + m[0].length
      if (!icons) { wanted = true; break }
      if (!iconName(m[1]) || inCode(state, a) || inFrontmatter(state, a)) continue
      if (editing && state.selection.ranges.some((r) => r.to >= a && r.from <= z)) continue
      b.add(a, z, Decoration.replace({ widget: new IconWidget(m[1]) }))
    }
  }
  if (wanted) void loadIcons()
  return b.finish()
}

const iconPlugin = (on: () => Settings) => ViewPlugin.fromClass(class {
  decorations: DecorationSet
  done: () => void
  constructor(view: EditorView) {
    this.decorations = iconDecos(view, on)
    this.done = () => { if (view.dom.isConnected) view.dispatch({}) }
    iconsLoaded.add(this.done)
  }
  update(u: ViewUpdate) {
    if (u.docChanged || u.viewportChanged || u.selectionSet || u.focusChanged || u.transactions.length) this.decorations = iconDecos(u.view, on)
  }
  destroy() { iconsLoaded.delete(this.done) }
}, { decorations: (p) => p.decorations })

/** `:fire:` typed whole (its closing ":" typed): the emoji in its place. */
const closeEmoji = (on: () => Settings) => EditorView.inputHandler.of((view, from, to, text) => {
  if (text !== ":" || from !== to || on().emoji === false) return false
  void loadEmoji()
  const line = view.state.doc.lineAt(from)
  const m = CLOSED.exec(view.state.sliceDoc(line.from, from) + ":")
  const e = m && byName?.get(m[1])
  if (!m || !e) return false
  const a = from - m[0].length + 1
  if (inCode(view.state, a) || inFrontmatter(view.state, a)) return false
  view.dispatch({ changes: { from: a, to, insert: e }, selection: { anchor: a + e.length }, userEvent: "input.type" })
  used({ kind: "emoji", name: m[1], emoji: e })
  return true
})

/** `on`: the settings as they are now (switching one needs no new editor). Source mode shows icons as their text. */
export function shortcodesExtension(on: () => Settings, source: boolean): Extension {
  return [EditorState.languageData.of(() => [{ suggest: (ctx: CompletionContext) => suggest(ctx, on()) }]), closeEmoji(on), source ? [] : iconPlugin(on)]
}

// ---------- Markdown drawn outside the editor (embeds, previews, export) ----------

const HAS_ICON = new RegExp(ICON_CODE.source)
/** `:LiName:` in text drawn from Markdown (not in code) as its icon. */
export function drawIcons(root: HTMLElement) {
  if (!HAS_ICON.test(root.textContent ?? "")) return
  if (!icons) { void loadIcons().then(() => { if (root.isConnected) drawIcons(root) }); return }
  // (not in code, nor an editor's own lines: Markdown drawn inside an editor is a widget of its own)
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => { const no = n.parentElement?.closest("code, pre, .cm-line"); return no && root.contains(no) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT },
  })
  const texts: Text[] = []
  for (let n = walk.nextNode(); n; n = walk.nextNode()) if (HAS_ICON.test((n as Text).data)) texts.push(n as Text)
  for (const t of texts) {
    const parts: (string | Node)[] = []
    let last = 0
    for (const m of t.data.matchAll(ICON_CODE)) {
      if (!iconName(m[1])) continue
      parts.push(t.data.slice(last, m.index), iconEl(m[1]))
      last = m.index + m[0].length
    }
    if (!parts.length) continue
    parts.push(t.data.slice(last))
    t.replaceWith(...parts)
  }
}
