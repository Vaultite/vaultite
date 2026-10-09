// The Markdown editor (CodeMirror 6): live preview, [[link]] and block-option suggestions, a file's whole text with its
// frontmatter hidden (drawn as Properties) or shown (source mode; YAML, JSON, code). Plugins' extensions first. Lazy chunk.
import { useEffect, useRef } from "react"
import { autocompletion, closeBrackets, closeBracketsKeymap, closeCompletion, completionStatus, type CompletionContext } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, isolateHistory, redo, undo } from "@codemirror/commands"
import { html as htmlLang } from "@codemirror/lang-html"
import { json as jsonLang } from "@codemirror/lang-json"
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown"
import { yamlFrontmatter, yamlLanguage } from "@codemirror/lang-yaml"
import { HighlightStyle, indentUnit, languageDataProp, syntaxHighlighting } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { tags } from "@lezer/highlight"
import { Compartment, EditorSelection, EditorState, Prec, Text, Transaction, type Extension, type SelectionRange } from "@codemirror/state"
import { EditorView, keymap, placeholder, tooltips, type ViewUpdate } from "@codemirror/view"
import { codeStyle, indentOf, languageFor } from "./languages"
import { fenceMenu, linkHandler, livePreview, offBlocks, previewConfig, textStart, type PreviewConfig } from "./livePreview"
import { bodyStart, frontmatter, frontmatterSyntax, hiddenFrontmatter, withBodyLine } from "./frontmatter"
import { slashSource } from "./slash"
import { blockOptionSource } from "./blockOptions"
import { numberGutter } from "./numbers"
import { keepState, keptKey, keptState } from "./kept"
import { blockFor } from "@/core/plugins"
import { getPrefs } from "@/core/prefs"
import type { SlashItem } from "@/core/define"
import { docChanged, registerDoc } from "@/core/anchors"
import { registerEditor } from "@/core/editors"
import { runShortcut } from "@/core/commands"
import { textChanges } from "@/core/merge"
import { pastedFiles } from "@/core/files"
import { editorExtensions, usePluginsVersion } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { usePane } from "@/core/pane"
import { useEditorSettings, type EditorSettings } from "@/core/editorPrefs"
import { cn, scrollingBox } from "@/lib/utils"
import { trace } from "@/core/trace"

export type EditorApi = {
  /** Put in text that changed elsewhere (on disk), keeping the cursor where it was as far as possible. */
  replace: (text: string) => void
  /** Put in a change the user made around the text (Properties, a header's chip, a command): one step in its history,
   *  so ⌘Z undoes it as it does typing. */
  change: (text: string) => void
  focus: (at?: "start" | "end") => void
  /** Scroll so that this line (0-based) is at the top of what scrolls it (measured on the way, unlike a guess from the
   *  heights of lines not drawn yet). */
  reveal: (line: number) => void
  /** Where the app can put the cursor near `pos` without opening a drawn block (livePreview's offBlocks). */
  offBlocks: (pos: number) => number | null
  /** It came back as its tab's editor was left (editor/kept.ts), selection included: that's where its cursor goes. */
  restored: boolean
  view: EditorView
}

type Props = {
  doc: string
  editable: boolean
  config: PreviewConfig
  /** The text, and where its body starts (after the hidden frontmatter; 0 without `frontmatter`). */
  onChange: (doc: string, start: number) => void
  /** An undo or redo changed the hidden frontmatter (Properties show it). */
  onUndoFrontmatter?: () => void
  onOpen: (link: { wiki?: string; url?: string }, newTab: boolean) => void
  /** Names to suggest after [[ (file names, people), with the file's path when it's one and what picking it writes; an
   *  alias with the link to what it stands for (`link`), put in as [[link|alias]]. */
  names: () => { label: string; detail?: string; path?: string; insert?: string; link?: string }[]
  /** Headings to suggest after [[Name# (a note's; "" is this file's). */
  headings?: (name: string) => Promise<string[]>
  /** Write links as Markdown, [name](Folder/Name.md), instead of [[name]] (.obsidian/app.json's useMarkdownLinks). */
  markdownLinks?: () => boolean
  /** Files pasted into it (an image): saved somewhere, and what to type for them (an embed), or null. */
  onPasteFiles?: (files: File[]) => Promise<string | null>
  /** The file it shows (Markdown), so links to a heading or a block in it scroll there (core/anchors.ts). */
  docPath?: string
  /** What the slash menu offers (Markdown only). */
  slash?: () => SlashItem[]
  onReady?: (api: EditorApi) => void
  placeholderText?: string
  label?: string
  /** Source mode: the whole file, frontmatter included, as plain text. */
  source?: boolean
  /** A Markdown file's whole text with its frontmatter hidden (live preview and reading): positions are the file's. */
  frontmatter?: boolean
  /** Not Markdown (source only): JSON, HTML (an artifact) or plain text (CSV). */
  code?: "json" | "html" | "text"
  /** A code file (source only): its name, for its language. */
  language?: string
  /** Escape (or ⌘Enter): the caller ends editing. An open suggestion list closes first; the next Escape calls it. */
  onEscape?: () => void
  /** The focus left the editor for something else on the page (not for another window, nor for a field drawn inside
   *  the editor). */
  onBlur?: () => void
  /** Draw [[ suggestions and the slash menu over the page (in <body>), at their own size: for an editor inside a box
   *  that clips (`overflow: hidden`) or is scaled (a canvas card under `transform: scale()`). */
  floatingTooltips?: boolean
  /** A file's own editor (not a canvas card's): line numbers beside it while the user has them on (appearance.json
   *  `lineNumbers`). Code files have them anyway. */
  numbered?: boolean
  /** The file it shows, whose history and selection are kept while its tab isn't drawn (editor/kept.ts). */
  keep?: string
}


/** Where floating suggestions go: one layer on <body> (styled like the editor's own: index.css, `.vau-tooltips`). */
let tooltipLayer: HTMLElement | null = null
function tooltipHost() {
  if (!tooltipLayer?.isConnected) {
    tooltipLayer = document.createElement("div")
    tooltipLayer.className = "vau-tooltips"
    document.body.appendChild(tooltipLayer)
  }
  return tooltipLayer
}

// The frontmatter in source mode: keys and the --- lines muted, values as text.
const fmStyle = HighlightStyle.define([
  { tag: [tags.definition(tags.propertyName), tags.meta, tags.separator], color: "var(--muted-foreground)" },
])
// JSON: the scheme's colours, so every scheme recolours it.
const jsonStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: "var(--blue)" },
  { tag: tags.string, color: "var(--green)" },
  { tag: tags.number, color: "var(--orange)" },
  { tag: [tags.bool, tags.null], color: "var(--purple)" },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: "var(--muted-foreground)" },
])
// HTML (an artifact's source): the same idea.
const htmlStyle = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: "var(--blue)" },
  { tag: tags.attributeName, color: "var(--orange)" },
  { tag: [tags.string, tags.attributeValue], color: "var(--green)" },
  { tag: [tags.keyword, tags.definitionKeyword, tags.modifier], color: "var(--purple)" },
  { tag: [tags.number, tags.bool, tags.null], color: "var(--orange)" },
  { tag: tags.comment, color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [tags.propertyName, tags.function(tags.variableName)], color: "var(--teal)" },
])

/** Code inside ```fences: each language's parser (loaded when a fence names it) and the scheme's code colours, but only
 *  inside the fences: Markdown itself (and, in source mode, the frontmatter's YAML) keeps the editor's own look. */
function fencedCode(source: boolean) {
  const md = markdown({ base: markdownLanguage, codeLanguages: languages, extensions: frontmatterSyntax })
  const fm = source ? yamlFrontmatter({ content: md }) : null
  const skip = new Set<unknown>([markdownLanguage.data, ...(fm ? [fm.language.data, yamlLanguage.data] : [])])
  return [
    fm ?? md,
    EditorView.styleModule.of(codeStyle.module!),
    syntaxHighlighting({ style: codeStyle.style, scope: (type) => !skip.has(type.prop(languageDataProp)) }),
  ]
}

/** Wrap the selection in a marker (**, *), or take it off. */
const wrap = (m: string) => (view: EditorView) => {
  view.dispatch(view.state.changeByRange((r) => {
    const text = view.state.sliceDoc(r.from, r.to)
    const before = view.state.sliceDoc(r.from - m.length, r.from), after = view.state.sliceDoc(r.to, r.to + m.length)
    if (before === m && after === m) {
      return { changes: [{ from: r.from - m.length, to: r.from }, { from: r.to, to: r.to + m.length }],
        range: EditorSelection.range(r.from - m.length, r.to - m.length) }
    }
    return { changes: { from: r.from, to: r.to, insert: m + text + m }, range: EditorSelection.range(r.from + m.length, r.to + m.length) }
  }))
  return true
}

/** Markdown's marks a selection is wrapped in when one is typed over it (autoPairMarkdown). */
const MD_PAIRS = new Set(["*", "_", "~", "=", "`"])
const wrapTyped = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (!MD_PAIRS.has(text) || view.state.selection.ranges.every((r) => r.empty) || view.state.readOnly) return false
  view.dispatch(view.state.changeByRange((r) => (r.empty
    ? { changes: { from: r.from, insert: text }, range: EditorSelection.cursor(r.from + 1) }
    : { changes: [{ from: r.from, insert: text }, { from: r.to, insert: text }], range: EditorSelection.range(r.anchor + 1, r.head + 1) })),
  { userEvent: "input.type", scrollIntoView: true })
  return true
})

/** A note's editor as its settings say (editorPrefs.ts): spelling, indent, what typed characters close or wrap. */
function writing(e: EditorSettings) {
  const brackets = [...(e.autoPairBrackets ? ["(", "[", "{", "'", '"'] : []), ...(e.autoPairMarkdown ? ["`"] : [])]
  return [
    indentUnit.of(e.useTab ? "\t" : " ".repeat(e.tabSize)), EditorState.tabSize.of(e.tabSize),
    EditorView.contentAttributes.of({ spellcheck: e.spellcheck ? "true" : "false" }),
    brackets.length ? [Prec.highest(EditorState.languageData.of(() => [{ closeBrackets: { brackets } }])), closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
    e.autoPairMarkdown ? wrapTyped : [],
  ]
}

/** A path in a Markdown link: spaces and parentheses escaped. */
const linkPath = (p: string) => p.replace(/%/g, "%25").replace(/ /g, "%20").replace(/\(/g, "%28").replace(/\)/g, "%29")

/** Scroll the pane (or the page) so a line is near the top, and flash it. */
function scrollToLine(v: EditorView, line: number) {
  const n = Math.min(Math.max(line + 1, 1), v.state.doc.lines)
  const pos = v.state.doc.line(n).from
  v.dispatch({ effects: EditorView.scrollIntoView(textStart(v.state, pos), { y: "start", yMargin: 72 }) })
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const { node } = v.domAtPos(pos)
    const el = (node instanceof Element ? node : node.parentElement)?.closest(".cm-line, .cm-block")
    if (!el) return
    el.classList.remove("cm-flash")
    void (el as HTMLElement).offsetWidth
    el.classList.add("cm-flash")
    setTimeout(() => el.classList.remove("cm-flash"), 1600)
  }))
}


/** Files saved as attachments through `paste` and the embeds it answers put in at `at` (a drop's: focused). */
function attach(e: Event, view: EditorView, files: File[], at: { from: number; to: number }, userEvent: string, paste?: (files: File[]) => Promise<string | null>) {
  if (!files.length || !paste || !view.state.facet(EditorView.editable)) return false
  e.preventDefault()
  paste(files).then((text) => {
    if (!text) return
    const from = Math.min(at.from, view.state.doc.length), to = Math.min(at.to, view.state.doc.length)
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent })
    if (userEvent === "input.drop") view.focus()
  })
  return true
}

/** An editor's changes and cursor jumps for the trace: where and by whom, never the text. */
function traceUpdate(u: ViewUpdate, path: string) {
  const was = u.startState.selection.main.head, head = u.state.selection.main.head
  const lines = Math.abs(u.state.doc.lineAt(head).number - u.startState.doc.lineAt(was).number)
  const editable = u.startState.facet(EditorView.editable) !== u.state.facet(EditorView.editable)
  if (!u.docChanged && lines <= 1 && !editable) return
  const by = [...new Set(u.transactions.map((t) => (t.annotation(Transaction.remote) ? "remote" : t.annotation(Transaction.userEvent) ?? "app")))]
  const changes: [number, number, number][] = []
  u.changes.iterChanges((from, to, _f, _t, ins) => { if (changes.length < 3) changes.push([from, to, ins.length]) })
  // The app moving the cursor or rewriting most of the text: who did it (a plugin's file is in its stack)
  const jump = by.includes("app") && (lines > 1 || changes.some(([f, t]) => t - f > u.startState.doc.length / 2))
  trace("editor", { ev: "update", path, by: by.join(","), was, head, ...(changes.length ? { changes } : {}),
    ...(editable ? { editable: u.state.facet(EditorView.editable) } : {}), focus: u.view.hasFocus, ...(jump ? { stack: callers() } : {}) })
}
const callers = () => (new Error().stack ?? "").split("\n").slice(3, 12).map((l) => l.trim().replace(/^at /, "")).join(" < ")

export default function Editor({ doc, editable, config, onChange, onOpen, names, headings, slash, onReady, placeholderText, label, source, frontmatter: hides, code, language, markdownLinks, onPasteFiles, docPath, floatingTooltips, onEscape, onBlur, numbered, onUndoFrontmatter, keep }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cfg = useRef(new Compartment())
  const edit = useRef(new Compartment())
  const lang = useRef(new Compartment())
  const plugged = useRef(new Compartment())
  const nums = useRef(new Compartment())
  const prose = useRef(new Compartment())
  const { disabled, enabled, order, lineNumbers: numbersOn } = usePrefs()
  const settings = useEditorSettings()
  const plugins = usePluginsVersion()
  const { tab } = usePane()
  const showNumbers = !!numbered && numbersOn && language === undefined
  // Callbacks change every render; the editor reads the latest through refs.
  const cb = useRef({ onChange, onOpen, names, headings, slash, markdownLinks, onPasteFiles, onEscape, onBlur, onUndoFrontmatter })
  cb.current = { onChange, onOpen, names, headings, slash, markdownLinks, onPasteFiles, onEscape, onBlur, onUndoFrontmatter }
  // (its frontmatter hidden: the body always has a line, even in a file that ends with its closing ---)
  const fill = (text: string) => (hides ? withBodyLine(text) : text)

  useEffect(() => {
    const complete = async (ctx: CompletionContext) => {
      const m = ctx.matchBefore(/\[\[[^[\]\n]*/)
      if (!m) return null
      const closed = ctx.state.sliceDoc(ctx.pos, ctx.pos + 2) === "]]"
      const md = !!cb.current.markdownLinks?.()
      // [[Note# (or [[# in this file): its headings.
      const hash = m.text.indexOf("#")
      if (hash >= 0) {
        const rest = m.text.slice(hash + 1)
        if (md || m.text.includes("|") || rest.startsWith("^") || !cb.current.headings) return null
        const list = await cb.current.headings(m.text.slice(2, hash))
        if (!list.length) return null
        return {
          from: m.from + hash + 1,
          options: list.map((h) => ({ label: h, apply: closed ? h : `${h}]]` })),
          validFor: /^[^[\]\n|#^]*$/,
        }
      }
      return {
        from: m.from + 2,
        options: cb.current.names().map((n) => ({
          label: n.label, detail: n.detail,
          // Markdown links: the whole [[… becomes [name](path.md)
          apply: md && n.path
            ? (view: EditorView, _c: unknown, _from: number, to: number) => {
              const insert = `[${n.label}](${linkPath(n.path!)})`
              view.dispatch({ changes: { from: m.from, to: closed ? to + 2 : to, insert }, selection: { anchor: m.from + insert.length } })
            }
            : `${n.link ? `${n.link}|${n.label}` : n.insert ?? n.label}${closed ? "" : "]]"}`,
        })),
        validFor: /^[^[\]\n|]*$/,
      }
    }
    // Ending editing (a caller that has one): Escape, ⌘Enter, the focus leaving. An open suggestion list closes first;
    // ones still being looked up don't take Escape, or it would only cancel them.
    const end = (view: EditorView) => {
      const f = cb.current.onEscape
      if (!f || completionStatus(view.state) === "active") return false
      closeCompletion(view)
      f()
      return true
    }
    const leaving = [
      Prec.highest(keymap.of([{ key: "Escape", run: end }, { key: "Mod-Enter", run: end }])),
      // The app's ⌘/⌃/⌥ shortcuts win over the editor's keys (⌘L), as in a terminal, so any key can be rebound;
      // plugins' extensions (Vim, Find's ⌘G) still come first.
      Prec.high(EditorView.domEventHandlers({ keydown: (e) => runShortcut(e) })),
      EditorView.domEventHandlers({
        blur(e, view) {
          const to = e.relatedTarget as Node | null
          if (!cb.current.onBlur || !document.hasFocus() || (to && view.dom.contains(to))) return false
          cb.current.onBlur()
          return false
        },
      }),
      floatingTooltips ? tooltips({ parent: tooltipHost() }) : [],
      EditorView.updateListener.of((u) => traceUpdate(u, docPath ?? label ?? "")),
    ]
    // (as this tab's editor of the file was left, its history with it, when it went: editor/kept.ts)
    const keepAs = keep ? keptKey(tab, keep) : null
    let restored = false
    const start = (c: { doc: string; selection?: EditorSelection | SelectionRange; extensions: Extension }) => {
      const back = keepAs ? keptState(keepAs, c.doc, !!source, { extensions: c.extensions }) : null
      if (!back) return EditorState.create(c)
      restored = back.selection
      return back.selection || !c.selection ? back.state : back.state.update({ selection: c.selection }).state
    }
    const v = new EditorView({
      parent: host.current!,
      state: start({
        doc: fill(doc),
        // (a new editor's cursor starts at the body, never inside the hidden frontmatter: typing there went before `---`)
        selection: hides ? EditorSelection.cursor(bodyStart(Text.of(fill(doc).split(/\r\n?|\n/)))) : undefined,
        extensions: language !== undefined ? [
          Prec.highest(plugged.current.of([])),
          leaving, history(), indentUnit.of(indentOf(doc)), EditorView.lineWrapping, numberGutter(),
          lang.current.of([]), syntaxHighlighting(codeStyle),
          edit.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          keymap.of([{ key: "Tab", run: indentMore }, { key: "Shift-Tab", run: indentLess }, ...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", "aria-label": label ?? "File" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.every((t) => t.annotation(Transaction.remote))) cb.current.onChange(u.state.doc.toString(), 0)
          }),
        ] : code ? [
          Prec.highest(plugged.current.of([])),
          leaving, history(), indentUnit.of("  "), EditorView.lineWrapping, nums.current.of(showNumbers ? numberGutter() : []),
          code === "json" ? [jsonLang(), syntaxHighlighting(jsonStyle)] : code === "html" ? [htmlLang(), syntaxHighlighting(htmlStyle)] : [],
          edit.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          keymap.of([{ key: "Tab", run: indentMore }, { key: "Shift-Tab", run: indentLess }, ...defaultKeymap, ...historyKeymap]),
          EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", "aria-label": label ?? "File" }),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.every((t) => t.annotation(Transaction.remote))) cb.current.onChange(u.state.doc.toString(), 0)
          }),
        ] : [
          Prec.highest(fenceMenu), Prec.highest(plugged.current.of([])),
          leaving, history(),
          EditorView.updateListener.of((u) => { if (u.docChanged && docPath) docChanged() }),
          fencedCode(!!source), source ? syntaxHighlighting(fmStyle) : [],
          prose.current.of(writing(settings)),
          EditorView.lineWrapping, nums.current.of(showNumbers ? numberGutter() : []),
          cfg.current.of(previewConfig.of(config)),
          edit.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          livePreview,
          linkHandler((l, t) => cb.current.onOpen(l, t)),
          // Files pasted (a screenshot) or dropped from the computer: saved as attachments, embedded where they went
          // (not read into the note as text, which is what the editor would do with dropped ones).
          EditorView.domEventHandlers({
            paste: (e, view) => attach(e, view, pastedFiles(e.clipboardData), view.state.selection.main, "input.paste", cb.current.onPasteFiles),
            drop(e, view) {
              const at = view.posAtCoords({ x: e.clientX, y: e.clientY }) ?? view.state.selection.main.head
              return attach(e, view, [...(e.dataTransfer?.files ?? [])], { from: at, to: at }, "input.drop", cb.current.onPasteFiles)
            },
          }),
          autocompletion({ override: [complete, slashSource(() => cb.current.slash?.() ?? []), blockOptionSource((name) => blockFor(name, getPrefs().disabled).decl)], icons: false }),
          keymap.of([
            { key: "Mod-b", run: wrap("**") }, { key: "Mod-i", run: wrap("*") },
            { key: "Tab", run: indentMore }, { key: "Shift-Tab", run: indentLess },
            ...markdownKeymap, ...defaultKeymap, ...historyKeymap,
          ]),
          hides ? hiddenFrontmatter(placeholderText ?? "Start writing") : placeholder(placeholderText ?? "Start writing"),
          EditorView.contentAttributes.of({ autocorrect: "on", autocapitalize: "sentences", "aria-label": label ?? "Note" }),
          EditorView.updateListener.of((u) => {
            const start = u.state.field(frontmatter, false) ?? 0
            if (u.docChanged && !u.transactions.every((t) => t.annotation(Transaction.remote))) cb.current.onChange(u.state.doc.toString(), start)
            const was = u.startState.field(frontmatter, false) ?? 0
            if (u.transactions.some((t) => t.isUserEvent("undo") || t.isUserEvent("redo")) && u.startState.doc.sliceString(0, was) !== u.state.doc.sliceString(0, start)) cb.current.onUndoFrontmatter?.()
          }),
        ],
      }),
    })
    view.current = v
    if (language) languageFor(language).then((l) => { if (l && view.current === v) v.dispatch({ effects: lang.current.reconfigure(l) }) })
    onReady?.({
      view: v,
      restored,
      replace: (text) => {
        const changes = textChanges(v.state.doc.toString(), fill(text))
        if (!changes.length) return
        // What's read stays put when lines come or go above it: the top line is found again and the pane scrolled by
        // as much as it moved (CodeMirror does this only while focused).
        const sc = scrollingBox(v.dom)
        const h = (sc ? sc.getBoundingClientRect().top : 0) - v.documentTop
        const anchor = !v.hasFocus && h > 0 && h < v.contentHeight ? v.lineBlockAtHeight(h) : null
        const tr = v.state.update({ changes, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] })
        v.dispatch(tr)
        if (!anchor) return
        const pos = tr.changes.mapPos(anchor.from, 1), was = v.documentTop + anchor.top
        v.requestMeasure({
          read: () => v.documentTop + v.lineBlockAt(Math.min(pos, v.state.doc.length)).top - was,
          write: (moved) => { if (Math.abs(moved) >= 1) { if (sc) sc.scrollTop += moved; else window.scrollBy(0, moved) } },
        })
      },
      reveal: (line) => {
        const n = Math.min(Math.max(line + 1, 1), v.state.doc.lines)
        v.dispatch({ effects: EditorView.scrollIntoView(v.state.doc.line(n).from, { y: "start", yMargin: 0 }) })
      },
      change: (text) => {
        const changes = textChanges(v.state.doc.toString(), fill(text))
        if (!changes.length) return
        v.dispatch({ changes, annotations: isolateHistory.of("full"), userEvent: "input.app" })
      },
      offBlocks: (pos) => offBlocks(v.state, pos),
      focus: (at) => {
        const pos = at ? offBlocks(v.state, at === "start" ? v.state.field(frontmatter, false) ?? 0 : v.state.doc.length) : null
        if (pos !== null) v.dispatch({ selection: EditorSelection.cursor(pos) })
        v.focus()
      },
    })
    // A Markdown file: others find its headings and blocks here (links to them, the Outline panel).
    const unregister = docPath && language === undefined && !code ? registerDoc({
      path: docPath,
      text: () => v.state.doc.toString(),
      scrollTo: (line) => scrollToLine(v, line),
      topLine: () => {
        const sc = scrollingBox(v.dom)
        const top = (sc ? sc.getBoundingClientRect().top : 0) + 80
        const h = top - v.documentTop
        // (never above the body: a hidden frontmatter's lines aren't on screen)
        const first = v.state.doc.lineAt(v.state.field(frontmatter, false) ?? 0).number - 1
        return Math.max(first, h <= 0 ? 0 : v.state.doc.lineAt(v.lineBlockAtHeight(Math.min(h, v.contentHeight)).from).number - 1)
      },
      dom: v.dom,
    }) : null
    // Every editor: commands find the one the user means (Find, folding: core/editors.ts).
    const unlist = registerEditor({ view: v, kind: language !== undefined ? "code" : code ? "text" : "markdown", path: docPath ?? (language || undefined), source: !!source,
      start: (s) => s.field(frontmatter, false) ?? 0, undo: () => undo(v), redo: () => redo(v) })
    trace("editor", { ev: "mount", path: docPath ?? label, head: v.state.selection.main.head, editable, source: !!source })
    return () => { trace("editor", { ev: "destroy", path: docPath ?? label, head: v.state.selection.main.head }); unregister?.(); unlist(); if (keepAs) keepState(keepAs, v.state, !!source); v.destroy(); view.current = null }
    // One editor per file: the parent keys this component by path.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Plugins' extensions, again whenever a plugin is turned on or off, or a vault plugin's code arrives.
  useEffect(() => {
    let live = true
    const kind = language !== undefined ? "code" : code ? "text" : "markdown"
    editorExtensions({ kind, path: docPath, source: !!source }, disabled, order).then((ext) => {
      if (live) view.current?.dispatch({ effects: plugged.current.reconfigure(ext) })
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled, enabled, order, plugins])

  useEffect(() => {
    view.current?.dispatch({ effects: cfg.current.reconfigure(previewConfig.of(config)) })
  }, [config])
  useEffect(() => {
    if (language === undefined && !code) view.current?.dispatch({ effects: prose.current.reconfigure(writing(settings)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])
  useEffect(() => {
    if (language === undefined) view.current?.dispatch({ effects: nums.current.reconfigure(showNumbers ? numberGutter() : []) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNumbers])
  useEffect(() => {
    view.current?.dispatch({ effects: edit.current.reconfigure([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]) })
  }, [editable])

  // (the desktop app opens files dropped elsewhere; here they're attachments)
  return <div ref={host} data-file-drop={editable && onPasteFiles && language === undefined && !code ? "" : undefined}
    className={language !== undefined ? "vau-editor is-source is-code" : cn("vau-editor", source && "is-source", showNumbers && "has-numbers")} />
}
