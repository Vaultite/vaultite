import { useEffect, useRef } from "react"
import { autocompletion, closeBrackets, closeBracketsKeymap, closeCompletion, completionStatus } from "@codemirror/autocomplete"
import { defaultKeymap, history, historyKeymap, indentLess, indentMore, isolateHistory, redo, undo } from "@codemirror/commands"
import { html as htmlLang } from "@codemirror/lang-html"
import { json as jsonLang } from "@codemirror/lang-json"
import { markdown, markdownKeymap, markdownLanguage } from "@codemirror/lang-markdown"
import { yamlFrontmatter, yamlLanguage } from "@codemirror/lang-yaml"
import { HighlightStyle, indentUnit, languageDataProp, syntaxHighlighting } from "@codemirror/language"
import { languages } from "@codemirror/language-data"
import { tags } from "@lezer/highlight"
import { Annotation, Compartment, EditorSelection, EditorState, Prec, Text, Transaction, type Extension, type SelectionRange } from "@codemirror/state"
import { EditorView, keymap, placeholder, tooltips, type ViewUpdate } from "@codemirror/view"
import { codeStyle, indentOf, languageFor, ownIndent } from "./languages"
import { drawnBlocks, fenceMenu, findable, linkHandler, livePreview, offBlocks, previewConfig, type PreviewConfig } from "./livePreview"
import { textStart, textStartIn } from "./scan"
import { bodyStart, frontmatter, frontmatterSyntax, hiddenFrontmatter, shownStart, titled, titleEnd, withBodyLine } from "./frontmatter"
import { slashSource } from "./slash"
import { followReader, sightMargins } from "./sight"
import { blockOptionSource } from "./blockOptions"
import { highlightSource, optionDot } from "./highlights"
import { optionGlyph, optionTrail, PICK_DELAY, pluginSuggest, quiet, suggestKeys } from "./suggest"
import { linkSource, type Linking } from "./linkComplete"
import { tagSource } from "./tags"
import { numberGutter } from "./numbers"
import { cursors } from "./cursors"
import { keepState, keptKey, keptState } from "./kept"
import { blockFor } from "@/core/plugins"
import { ink } from "@/lib/ink"
import { getPrefs } from "@/core/prefs"
import type { SlashItem } from "@/core/define"
import type { LinkClick } from "@/core/links"
import { docChanged, registerDoc } from "@/core/anchors"
import { textChanged } from "@/core/anchor"
import { registerEditor } from "@/core/editors"
import { runShortcut } from "@/core/commands"
import { textChanges, type Clash } from "@/core/merge"
import { conflicts, leaveConflicts, revealConflict, showConflicts, type Open } from "./conflicts"
import { pastedFiles } from "@/core/files"
import { droppedFrom, fromOutside, type Dropped } from "@/core/filedrop"
import { dropInto, fileDrops, markDrop, spotAt } from "./filedrop"
import { linkDrops, takesDrops } from "./linkDrop"
import { mirror, mirroredIn } from "./mirror"
import { pasteTable } from "./tables"
import { pasteHtml, pasteLink } from "./paste"
import { editorExtensions, usePluginsVersion } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { usePane } from "@/core/pane"
import { useEditorSettings, type EditorSettings } from "@/core/editorPrefs"
import { cn, scrollingBox } from "@/lib/utils"
import { sightOf } from "@/core/sight"
import { trace } from "@/core/trace"
import { nodeOf } from "@/core/dom"

export type EditorApi = {
  replace: (text: string) => void
  change: (text: string) => void
  focus: (at?: "start" | "end") => void
  reveal: (line: number) => void
  offBlocks: (pos: number) => number | null
  conflict: (text: string, clashes: Clash[], who: string | undefined, open: Open, note?: string) => boolean
  revealConflict: () => void
  dropMark: (at: { x: number; y: number } | null) => void
  drop: (d: Dropped, at: { x: number; y: number }) => boolean
  restored: boolean
  view: EditorView
}

type Props = {
  doc: string
  editable: boolean
  config: PreviewConfig
  onChange: (doc: string, start: number, from: Edited) => void
  onUndoFrontmatter?: () => void
  onOpen: (link: { wiki?: string; url?: string }, how: boolean | LinkClick) => void
  links?: Linking
  tags?: () => { tag: string; count: number }[]
  onAttach?: (d: Dropped) => Promise<string | null>
  docPath?: string
  slash?: () => SlashItem[]
  onReady?: (api: EditorApi) => void | (() => void)
  placeholderText?: string
  label?: string
  source?: boolean
  frontmatter?: boolean
  title?: string
  code?: "json" | "html" | "text"
  language?: string
  onEscape?: () => void
  onBlur?: () => void
  floatingTooltips?: boolean
  numbered?: boolean
  keep?: string
}

const hosts = Annotation.define<boolean>()
const news = (u: ViewUpdate) => u.docChanged && !u.transactions.every((t) => !t.docChanged || t.annotation(hosts))
export type Edited = "here" | "mirror" | "elsewhere"
const edited = (u: ViewUpdate): Edited => (!u.transactions.every((t) => !t.docChanged || t.annotation(Transaction.remote)) ? "here" : mirroredIn(u) ? "mirror" : "elsewhere")

let tooltipLayer: HTMLElement | null = null
function tooltipHost() {
  if (!tooltipLayer?.isConnected) {
    tooltipLayer = document.createElement("div")
    tooltipLayer.className = "vau-tooltips"
    document.body.appendChild(tooltipLayer)
  }
  return tooltipLayer
}

const fmStyle = HighlightStyle.define([
  { tag: [tags.definition(tags.propertyName), tags.meta, tags.separator], color: "var(--muted-foreground)" },
])
const jsonStyle = HighlightStyle.define([
  { tag: tags.propertyName, color: ink("var(--blue)") },
  { tag: tags.string, color: ink("var(--green)") },
  { tag: tags.number, color: ink("var(--orange)") },
  { tag: [tags.bool, tags.null], color: ink("var(--purple)") },
  { tag: [tags.brace, tags.squareBracket, tags.separator, tags.punctuation], color: ink("var(--muted-foreground)") },
])
const htmlStyle = HighlightStyle.define([
  { tag: [tags.tagName, tags.angleBracket], color: ink("var(--blue)") },
  { tag: tags.attributeName, color: ink("var(--orange)") },
  { tag: [tags.string, tags.attributeValue], color: ink("var(--green)") },
  { tag: [tags.keyword, tags.definitionKeyword, tags.modifier], color: ink("var(--purple)") },
  { tag: [tags.number, tags.bool, tags.null], color: ink("var(--orange)") },
  { tag: tags.comment, color: ink("var(--muted-foreground)"), fontStyle: "italic" },
  { tag: [tags.propertyName, tags.function(tags.variableName)], color: ink("var(--teal)") },
])

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

const MD_PAIRS = new Set(["*", "_", "~", "=", "`"])
const wrapTyped = EditorView.inputHandler.of((view, _from, _to, text) => {
  if (!MD_PAIRS.has(text) || view.state.selection.ranges.every((r) => r.empty) || view.state.readOnly) return false
  view.dispatch(view.state.changeByRange((r) => (r.empty
    ? { changes: { from: r.from, insert: text }, range: EditorSelection.cursor(r.from + 1) }
    : { changes: [{ from: r.from, insert: text }, { from: r.to, insert: text }], range: EditorSelection.range(r.anchor + 1, r.head + 1) })),
  { userEvent: "input.type", scrollIntoView: true })
  return true
})

function writing(e: EditorSettings, doc: string) {
  const brackets = [...(e.autoPairBrackets ? ["(", "[", "{", "'", '"'] : []), ...(e.autoPairMarkdown ? ["`"] : [])]
  return [
    indentUnit.of(ownIndent(doc, true) ?? (e.useTab ? "\t" : " ".repeat(e.tabSize))), EditorState.tabSize.of(e.tabSize),
    EditorView.contentAttributes.of({ spellcheck: e.spellcheck ? "true" : "false" }),
    brackets.length ? [Prec.highest(EditorState.languageData.of(() => [{ closeBrackets: { brackets } }])), closeBrackets(), keymap.of(closeBracketsKeymap)] : [],
    e.autoPairMarkdown ? wrapTyped : [],
  ]
}

function scrollToLine(v: EditorView, line: number) {
  const n = Math.min(Math.max(line + 1, 1), v.state.doc.lines)
  const pos = v.state.doc.line(n).from
  v.dispatch({ effects: EditorView.scrollIntoView(textStart(v.state, pos), { y: "start", yMargin: 72 }) })
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const { node } = v.domAtPos(pos)
    const el = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>(".cm-line, .cm-block")
    if (!el) return
    el.classList.remove("cm-flash")
    void el.offsetWidth
    el.classList.add("cm-flash")
    setTimeout(() => el.classList.remove("cm-flash"), 1600)
  }))
}



function pasteFiles(e: Event, view: EditorView, files: File[], attach?: (d: Dropped) => Promise<string | null>) {
  if (!files.length || !attach || !view.state.facet(EditorView.editable)) return false
  e.preventDefault()
  const at = view.state.selection.main
  attach({ files, images: [], links: [] }).then((text) => {
    if (!text) return
    const from = Math.min(at.from, view.state.doc.length), to = Math.min(at.to, view.state.doc.length)
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + text.length }, userEvent: "input.paste" })
  })
  return true
}

function traceUpdate(u: ViewUpdate, path: string) {
  const was = u.startState.selection.main.head, head = u.state.selection.main.head
  const lines = Math.abs(u.state.doc.lineAt(head).number - u.startState.doc.lineAt(was).number)
  const editable = u.startState.facet(EditorView.editable) !== u.state.facet(EditorView.editable)
  if (!u.docChanged && lines <= 1 && !editable) return
  const by = [...new Set(u.transactions.map((t) => (t.annotation(Transaction.remote) ? "remote" : t.annotation(Transaction.userEvent) ?? "app")))]
  const changes: [number, number, number][] = []
  u.changes.iterChanges((from, to, _f, _t, ins) => { if (changes.length < 3) changes.push([from, to, ins.length]) })
  const jump = by.includes("app") && (lines > 1 || changes.some(([f, t]) => t - f > u.startState.doc.length / 2))
  trace("editor", { ev: "update", path, by: by.join(","), was, head, ...(changes.length ? { changes } : {}),
    ...(editable ? { editable: u.state.facet(EditorView.editable) } : {}), focus: u.view.hasFocus, ...(jump ? { stack: callers() } : {}) })
}
const callers = () => (new Error().stack ?? "").split("\n").slice(3, 12).map((l) => l.trim().replace(/^at /, "")).join(" < ")

export default function Editor({ doc, editable, config, onChange, onOpen, links, tags, slash, onReady, placeholderText, label, source, frontmatter: hides, title, code, language, onAttach, docPath, floatingTooltips, onEscape, onBlur, numbered, onUndoFrontmatter, keep }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const cfg = useRef(new Compartment())
  const edit = useRef(new Compartment())
  const lang = useRef(new Compartment())
  const plugged = useRef(new Compartment())
  const nums = useRef(new Compartment())
  const prose = useRef(new Compartment())
  const naming = useRef(new Compartment())
  const { disabled, enabled, lineNumbers: numbersOn } = usePrefs()
  const settings = useEditorSettings()
  const plugins = usePluginsVersion()
  const { tab } = usePane()
  const showNumbers = !!numbered && numbersOn && language === undefined
  const cb = useRef({ onChange, onOpen, links, tags, slash, onAttach, onEscape, onBlur, onUndoFrontmatter })
  cb.current = { onChange, onOpen, links, tags, slash, onAttach, onEscape, onBlur, onUndoFrontmatter }
  const fill = (text: string) => (hides ? withBodyLine(text) : text)

  useEffect(() => {
    // Only an open list takes Escape: one still being looked up would just be cancelled by it.
    const end = (view: EditorView) => {
      const f = cb.current.onEscape
      if (!f || completionStatus(view.state) === "active") return false
      closeCompletion(view)
      f()
      return true
    }
    const leaving = [
      Prec.highest(keymap.of([{ key: "Escape", run: end }, { key: "Mod-Enter", run: end }])),
      Prec.high(EditorView.domEventHandlers({ keydown: (e) => runShortcut(e) })),
      EditorView.domEventHandlers({
        blur(e, view) {
          const to = nodeOf(e.relatedTarget)
          if (!cb.current.onBlur || !document.hasFocus() || (to && view.dom.contains(to))) return false
          cb.current.onBlur()
          return false
        },
      }),
      floatingTooltips ? tooltips({ parent: tooltipHost() }) : [],
      EditorView.updateListener.of((u) => { traceUpdate(u, docPath ?? label ?? ""); if (u.docChanged) textChanged(u.view, u.changes) }),
    ]
    const sight = [sightMargins, followReader]
    const plain = [
      edit.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
      keymap.of([{ key: "Tab", run: indentMore }, { key: "Shift-Tab", run: indentLess }, ...defaultKeymap, ...historyKeymap]),
      EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off", "aria-label": label ?? "File" }),
      EditorView.updateListener.of((u) => {
        if (news(u)) cb.current.onChange(u.state.doc.toString(), 0, edited(u))
      }),
    ]
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
        selection: hides ? EditorSelection.cursor(((t) => textStartIn(t, titleEnd(t, bodyStart(t), title ?? "")))(Text.of(fill(doc).split(/\r\n?|\n/)))) : undefined,
        extensions: language !== undefined ? [
          Prec.highest(plugged.current.of([])),
          leaving, sight, history(), cursors, conflicts, indentUnit.of(indentOf(doc)), EditorView.lineWrapping, numberGutter(),
          lang.current.of([]), syntaxHighlighting(codeStyle),
          plain,
        ] : code ? [
          Prec.highest(plugged.current.of([])),
          leaving, sight, history(), cursors, conflicts, indentUnit.of("  "), EditorView.lineWrapping, nums.current.of(showNumbers ? numberGutter() : []),
          code === "json" ? [jsonLang(), syntaxHighlighting(jsonStyle)] : code === "html" ? [htmlLang(), syntaxHighlighting(htmlStyle)] : [],
          plain,
        ] : [
          Prec.highest(fenceMenu), Prec.highest(plugged.current.of([])),
          leaving, sight, history(), cursors, conflicts,
          EditorView.updateListener.of((u) => { if (u.docChanged && docPath) docChanged(u) }), docPath ? mirror(docPath) : [],
          fencedCode(!!source), source ? syntaxHighlighting(fmStyle) : [],
          prose.current.of(writing(settings, doc)),
          EditorView.lineWrapping, nums.current.of(showNumbers ? numberGutter() : []),
          cfg.current.of(previewConfig.of(config)),
          edit.current.of([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]),
          livePreview,
          linkHandler((l, t) => cb.current.onOpen(l, t)),
          fileDrops, linkDrops(() => { const l = cb.current.links; return l && { isFile: l.isFile, link: (p) => l.link({ path: p, embed: !/\.md$/i.test(p) }) } }),
          EditorView.domEventHandlers({
            paste: (e, view) => pasteFiles(e, view, pastedFiles(e.clipboardData), cb.current.onAttach) || pasteTable(e, view) || pasteLink(e, view) || pasteHtml(e, view),
            dragover(e, view) {
              if (!takesDrops(view) || !fromOutside(e.dataTransfer)) return false
              e.preventDefault()
              e.dataTransfer!.dropEffect = "copy"
              markDrop(view, spotAt(view, { x: e.clientX, y: e.clientY }))
              return true
            },
            drop(e, view) {
              if (!takesDrops(view) || !fromOutside(e.dataTransfer)) return false
              e.preventDefault()
              markDrop(view, null)
              const d = droppedFrom(e.dataTransfer)
              if (d) void dropInto(view, spotAt(view, { x: e.clientX, y: e.clientY }), cb.current.onAttach!(d))
              return true
            },
          }),
          suggestKeys,
          autocompletion({
            override: [linkSource(() => cb.current.links), tagSource(() => cb.current.tags?.() ?? []), slashSource(() => cb.current.slash?.() ?? []), blockOptionSource((name) => blockFor(name, getPrefs().disabled).decl), highlightSource, pluginSuggest].map(quiet),
            icons: false, interactionDelay: PICK_DELAY, addToOptions: [{ render: optionDot, position: 20 }, { render: optionGlyph, position: 20 }, { render: optionTrail, position: 90 }],
          }),
          keymap.of([
            { key: "Mod-b", run: wrap("**") }, { key: "Mod-i", run: wrap("*") },
            { key: "Tab", run: indentMore }, { key: "Shift-Tab", run: indentLess },
            ...markdownKeymap, ...defaultKeymap, ...historyKeymap,
          ]),
          hides ? [naming.current.of(titled.of(title ?? "")), hiddenFrontmatter(placeholderText ?? "Start writing")] : placeholder(placeholderText ?? "Start writing"),
          EditorView.contentAttributes.of({ autocorrect: "on", autocapitalize: "sentences", "aria-label": label ?? "Note" }),
          EditorView.updateListener.of((u) => {
            const start = u.state.field(frontmatter, false) ?? 0
            if (news(u)) cb.current.onChange(u.state.doc.toString(), start, edited(u))
            const was = u.startState.field(frontmatter, false) ?? 0
            if (u.transactions.some((t) => t.isUserEvent("undo") || t.isUserEvent("redo")) && u.startState.doc.sliceString(0, was) !== u.state.doc.sliceString(0, start)) cb.current.onUndoFrontmatter?.()
          }),
        ],
      }),
    })
    view.current = v
    if (language) languageFor(language).then((l) => { if (l && view.current === v) v.dispatch({ effects: lang.current.reconfigure(l) }) })
    const placed = (pos: number | null) => (pos !== null && pos === v.state.doc.lineAt(pos).from ? textStart(v.state, pos) : pos)
    const api: EditorApi = {
      view: v,
      restored,
      replace: (text) => {
        const changes = textChanges(v.state.doc.toString(), fill(text))
        if (!changes.length) return
        // CodeMirror keeps what's read in place only while focused, so the pane is scrolled by as much as the top line moved.
        const sc = scrollingBox(v.dom)
        const h = (sc ? sc.getBoundingClientRect().top : 0) - v.documentTop
        const anchor = !v.hasFocus && h > 0 && h < v.contentHeight ? v.lineBlockAtHeight(h) : null
        const tr = v.state.update({ changes, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false), hosts.of(true)] })
        v.dispatch(tr)
        if (!anchor) return
        const pos = tr.changes.mapPos(anchor.from, 1), was = v.documentTop + anchor.top
        v.requestMeasure({
          read: () => v.documentTop + v.lineBlockAt(Math.min(pos, v.state.doc.length)).top - was,
          write: (moved) => { if (Math.abs(moved) >= 1) { if (sc) sc.scrollTop += moved; else window.scrollBy(0, moved) } },
        })
      },
      conflict: (text, clashes, who, open, note) => {
        const at = shownStart(v.state)
        if (at && clashes.some((k) => k.at < v.state.doc.lineAt(at).number - 1)) return false
        api.replace(text)
        return showConflicts(v, clashes, who, open, note)
      },
      revealConflict: () => revealConflict(v),
      dropMark: (at) => markDrop(v, at && spotAt(v, at)),
      drop: (d, at) => {
        if (!cb.current.onAttach) return false
        markDrop(v, null)
        void dropInto(v, spotAt(v, at), cb.current.onAttach!(d))
        return true
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
      offBlocks: (pos) => placed(offBlocks(v.state, pos)),
      focus: (at) => {
        const pos = at ? placed(offBlocks(v.state, at === "start" ? shownStart(v.state) : v.state.doc.length)) : null
        if (pos !== null) v.dispatch({ selection: EditorSelection.cursor(pos) })
        v.focus()
      },
    }
    const unready = onReady?.(api)
    const unregister = docPath && language === undefined && !code ? registerDoc({
      path: docPath,
      text: () => v.state.doc.toString(),
      scrollTo: (line) => scrollToLine(v, line),
      topLine: () => {
        const top = sightOf(v.dom).top + 80
        const h = top - v.documentTop
        const first = v.state.doc.lineAt(shownStart(v.state)).number - 1
        return Math.max(first, h <= 0 ? 0 : v.state.doc.lineAt(v.lineBlockAtHeight(Math.min(h, v.contentHeight)).from).number - 1)
      },
      dom: v.dom,
    }) : null
    const unlist = registerEditor({ view: v, kind: language !== undefined ? "code" : code ? "text" : "markdown", path: docPath ?? (language || undefined), source: !!source,
      start: shownStart, undo: () => undo(v), redo: () => redo(v), findable, blocks: () => drawnBlocks(v) })
    trace("editor", { ev: "mount", path: docPath ?? label, head: v.state.selection.main.head, editable, source: !!source })
    return () => { trace("editor", { ev: "destroy", path: docPath ?? label, head: v.state.selection.main.head }); leaveConflicts(v); unready?.(); unregister?.(); unlist(); if (keepAs) keepState(keepAs, v.state, !!source); v.destroy(); view.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one editor per file: the parent keys it by path
  }, [])

  useEffect(() => {
    let live = true
    const kind = language !== undefined ? "code" : code ? "text" : "markdown"
    editorExtensions({ kind, path: docPath, source: !!source }, disabled).then((ext) => {
      if (live) view.current?.dispatch({ effects: plugged.current.reconfigure(ext) })
    })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- kind, path and source are fixed for an editor's life
  }, [disabled, enabled, plugins])

  useEffect(() => {
    view.current?.dispatch({ effects: cfg.current.reconfigure(previewConfig.of(config)) })
  }, [config])
  useEffect(() => {
    const v = view.current
    if (v && language === undefined && !code) v.dispatch({ effects: prose.current.reconfigure(writing(settings, v.state.doc.toString())) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- language and code are fixed for an editor's life
  }, [settings])
  useEffect(() => {
    if (language === undefined) view.current?.dispatch({ effects: nums.current.reconfigure(showNumbers ? numberGutter() : []) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- language is fixed for an editor's life
  }, [showNumbers])
  useEffect(() => {
    view.current?.dispatch({ effects: edit.current.reconfigure([EditorView.editable.of(editable), EditorState.readOnly.of(!editable)]) })
  }, [editable])
  useEffect(() => {
    const v = view.current
    if (!v || !hides) return
    v.dispatch({ effects: naming.current.reconfigure(titled.of(title ?? "")) })
    const start = shownStart(v.state)
    if (v.state.selection.main.from < start) v.dispatch({ selection: EditorSelection.cursor(start) })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- whether it hides the frontmatter is fixed for an editor's life
  }, [title])

  return <div ref={host} data-file-drop={editable && onAttach && language === undefined && !code ? "" : undefined}
    className={language !== undefined ? "vau-editor is-source is-code" : cn("vau-editor", source && "is-source", showNumbers && "has-numbers")} />
}
