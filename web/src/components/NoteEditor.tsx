// The note editor for plugins outside a file's view: NoteEditor edits Markdown the caller keeps, FileEditor a vault
// file's body in place (saving and merging like a tab). Suggestions float in <body> so clipping or scaling can't cut them.
import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useStore, type Store } from "@/core/data"
import type { FileCtx } from "@/core/define"
import { useAutosave } from "@/core/autosave"
import { gone, isReadOnly, joinFm, readFile, splitFm, stem, type FileText } from "@/core/files"
import { readProps } from "@/core/frontmatter"
import { useVaultChange } from "@/core/live"
import { followLink } from "@/core/links"
import { renderMarkdown } from "@/core/markdown"
import { notify } from "@/core/notify"
import { timelineKinds, usePluginsVersion } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { BlockView, useKindBlocks, useKindSections } from "@/components/Blocks"
import { assetUrl, drawEmbed, imageActions, island, linkKind, useVaultEditing } from "@/components/editing"
import { TimelineSection } from "@/components/Timeline"
import { Editor } from "@/editor/lazy"
import type { EditorApi } from "@/editor/Editor"
import type { PreviewConfig } from "@/editor/livePreview"
import { cn } from "@/lib/utils"

type Shared = {
  /** Focus it with the cursor at the end once it's drawn. */
  autoFocus?: boolean
  /** Escape (once no suggestion list is open) or ⌘Enter: the caller ends editing. */
  onEscape?: () => void
  className?: string
}

export type NoteEditorProps = Shared & {
  /** The Markdown. When it changes from outside (to something other than what the editor last said), it's put in
   *  keeping the cursor. */
  text: string
  onChange: (text: string) => void
  /** The store (default: the app's). */
  store?: Store
  /** The file it's in (a canvas): links are followed from it, `![[#Heading]]` finds it, pasted images go beside it. */
  from?: string
  /** The focus left it for something else on the page (not another window, nor a field drawn inside it). */
  onBlur?: () => void
  placeholder?: string
}

/** Markdown that isn't a file, edited like a note (a canvas's text card). */
export function NoteEditor(props: NoteEditorProps) {
  const app = useStore().store
  const store = props.store ?? app
  if (!store) return <div className={cn("note-editor min-h-6", props.className)} aria-busy />
  return <TextEditor {...props} store={store} />
}

function TextEditor({ text, onChange, store, from = "", autoFocus, onEscape, onBlur, placeholder, className }: NoteEditorProps & { store: Store }) {
  // What the editor has: what it said last, or what was put in.
  const last = useRef(text)
  const api = useRef<EditorApi | null>(null)
  useEffect(() => {
    if (text === last.current) return
    last.current = text
    api.current?.replace(text)
  }, [text])
  const ctx = useCallback((): FileCtx => ({ store, path: from, fm: {}, body: last.current }), [store, from])
  return (
    <Wired store={store} from={from} doc={text} editable autoFocus={autoFocus} onEscape={onEscape} onBlur={onBlur}
      placeholder={placeholder} className={className} ctx={ctx} text={() => last.current}
      onReady={(a) => { api.current = a }}
      onChange={(t) => { last.current = t; onChange(t) }} />
  )
}

/** The editor itself, wired to the vault like a note's (FileView's): what both editors here draw. */
function Wired({ store, from, doc, editable, autoFocus, onEscape, onBlur, placeholder, className, ctx, text, fm = "", whole, onReady, onChange }: {
  store: Store; from: string; doc: string; editable: boolean; autoFocus?: boolean; onEscape?: () => void; onBlur?: () => void
  placeholder?: string; className?: string
  /** What blocks are drawn with (the file's fields and body). */
  ctx: () => FileCtx
  /** The text as typed so far ([[# suggests its headings). */
  text: () => string
  /** The file's frontmatter: blocks draw again when it changes. */
  fm?: string
  /** `doc` is a file's whole text, its frontmatter hidden. */
  whole?: boolean
  onReady: (api: EditorApi) => void; onChange: (text: string, start: number) => void }) {
  const { disabled } = usePrefs()
  const { resolve, paste, ...wiring } = useVaultEditing(store, from, text)
  // Blocks and sections draw again when what they show changes (the store reloaded, the fields, plugins on or off).
  const [version, setVersion] = useState(0)
  const plugins = usePluginsVersion() // (a plugin's fences arriving)
  useEffect(() => setVersion((v) => v + 1), [store, fm, disabled, plugins])
  const kindBlocks = useKindBlocks(store, from)
  const sections = useKindSections(store, from)
  const config = useMemo<PreviewConfig>(() => ({
    live: true,
    writable: editable,
    ...(whole ? { kindBlocks } : {}),
    resolves: (t) => linkKind(resolve, t),
    asset: (name) => assetUrl(store, name, from),
    ...imageActions(store),
    sections,
    renderSection: (name, t, el) => island((x) => <TimelineSection text={x} title={name[0].toUpperCase() + name.slice(1)} kinds={timelineKinds(disabled)} />, t, el),
    renderBlock: (name, t, el, edit) => island((x) => <BlockView name={name} text={x} ctx={ctx()} disabled={disabled} edit={edit} />, t, el),
    renderEmbed: (target, height, el, edit) => drawEmbed(store, target, height, el, from, edit),
    renderMarkdown: (md) => renderMarkdown(md, { resolves: resolve, asset: (name) => assetUrl(store, name, from) }),
    follow: (link, newTab) => followLink(store, link, newTab, from),
    version,
  }), [editable, resolve, store, disabled, version, from, ctx, whole, kindBlocks, sections])
  // Gone (ended with Escape, say): a blur as the editor is taken off the page isn't the user leaving it. (Layout
  // effects end before React takes the elements away.)
  const over = useRef(false)
  useLayoutEffect(() => { over.current = false; return () => { over.current = true } }, [])
  const blur = useMemo(() => onBlur && (() => { if (!over.current) onBlur() }), [onBlur])
  return (
    <div className={cn("note-editor", className)}>
      <Suspense fallback={<div className="min-h-6" />}>
        <Editor doc={doc} frontmatter={whole} editable={editable} config={config} {...wiring} onPasteFiles={editable ? paste : undefined} placeholderText={editable ? placeholder ?? "Start writing" : ""}
          onEscape={onEscape} onBlur={blur} floatingTooltips
          onReady={(a) => { onReady(a); if (autoFocus && editable) a.focus("end") }} onChange={onChange} />
      </Suspense>
    </div>
  )
}

export type FileEditorProps = Shared & {
  /** The Markdown file's vault path. */
  path: string
  store: Store
  /** false: drawn like reading (default true; the trash and the app's copies never are). */
  editable?: boolean
}

/** A vault Markdown file's body, edited in place (a canvas card showing a note). */
export function FileEditor(props: FileEditorProps) {
  return <FileLoad key={props.path} {...props} />
}

function FileLoad({ path, store, editable = true, autoFocus, onEscape, className }: FileEditorProps) {
  const [file, setFile] = useState<FileText | "missing" | "failed" | null>(null)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let on = true
    readFile(path).then((f) => { if (on) setFile(f) })
      .catch((e) => on && setFile((cur) => (gone(e) ? "missing" : cur && typeof cur === "object" ? cur : "failed")))
    return () => { on = false }
  }, [path, tries])
  // Not there (or not read): tried again once it changes on disk. An open file follows its own changes (FileBody).
  useVaultChange(() => { if (typeof file === "string") setTries((n) => n + 1) }, [path])
  if (typeof file === "string") {
    return <p className={cn("text-[13px] text-muted-foreground", className)}>{file === "missing" ? `No file ${stem(path)} in the vault.` : `Couldn't read ${stem(path)}.`}</p>
  }
  if (!file) return <div className={cn("min-h-6", className)} aria-busy />
  return <FileBody store={store} initial={file} editable={editable && !isReadOnly(path)} autoFocus={autoFocus} onEscape={onEscape}
    className={className} onGone={() => setFile("missing")} />
}

function FileBody({ store, initial, editable, autoFocus, onEscape, className, onGone }: {
  store: Store; initial: FileText; editable: boolean; autoFocus?: boolean; onEscape?: () => void; className?: string; onGone: () => void }) {
  const path = initial.path
  const first = useMemo(() => splitFm(initial.text), [initial])
  const [fm, setFm] = useState(first.fm)
  const cur = useRef(first)
  const api = useRef<EditorApi | null>(null)
  const saver = useAutosave(path, initial.text, {
    text: () => joinFm(cur.current.fm, cur.current.body),
    apply: (text) => { const s = splitFm(text); cur.current = s; setFm(s.fm); api.current?.replace(text) },
    // No banner here: a conflict or a failed save is a toast, saved again from it.
    onStatus: (s) => {
      if (s.kind === "conflict") {
        notify(`${stem(path)} changed elsewhere in the same lines, so your edits aren't saved yet`, {
          kind: "error", duration: 15_000, id: `unsaved:${path}`, action: { label: "Keep mine", run: () => saver.keepMine() },
        })
      } else if (s.kind === "error") {
        notify(`Couldn't save ${stem(path)}: ${s.message}`, { kind: "error", id: `unsaved:${path}`, action: { label: "Try again", run: () => saver.save(true) } })
      }
    },
    onGone, readOnly: !editable,
  })

  const props = useMemo(() => readProps(fm).props, [fm])
  const ctx = useCallback((): FileCtx => ({ store, path, fm: props, body: cur.current.body }), [store, path, props])
  return (
    <Wired store={store} from={path} doc={initial.text} fm={fm} whole editable={editable} autoFocus={autoFocus} onEscape={onEscape}
      className={className} ctx={ctx} text={() => cur.current.body}
      onReady={(a) => { api.current = a }}
      onChange={(t, start) => { cur.current = { fm: t.slice(0, start), body: t.slice(start) }; setFm(cur.current.fm); saver.changed() }} />
  )
}
