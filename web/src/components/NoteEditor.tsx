import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { useStore, type Store } from "@/core/data"
import type { FileCtx } from "@/core/define"
import { conflictText, useAutosave, type Autosave, type SaveStatus } from "@/core/autosave"
import { fmLines } from "@/components/filePlace"
import { gone, isReadOnly, joinFm, readFile, splitFm, stem, type FileText } from "@/core/files"
import { readProps } from "@/core/frontmatter"
import { useVaultChange } from "@/core/live"
import { followLink } from "@/core/links"
import { openLinkMenu } from "@/components/LinkMenu"
import { renderMarkdown } from "@/core/markdown"
import { dismissNotice, notify } from "@/core/notify"
import { timelineKinds, usePluginsVersion } from "@/core/plugins"
import { usePrefs } from "@/core/prefs"
import { BlockView, useKindSections } from "@/components/Blocks"
import { assetUrl, drawEmbed, imageActions, island, linkKind, useVaultEditing } from "@/components/editing"
import { TimelineSection } from "@/components/Timeline"
import { Editor } from "@/editor/lazy"
import type { EditorApi } from "@/editor/Editor"
import type { PreviewConfig } from "@/editor/livePreview"
import { capitalize, cn } from "@/lib/utils"
import { Arriving } from "@/components/kit"
import { joinSection, sectionParts } from "../../../core/sections.ts"

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

function Wired({ store, from, doc, editable, autoFocus, onEscape, onBlur, placeholder, className, ctx, text, fm = "", whole, onReady, onChange }: {
  store: Store; from: string; doc: string; editable: boolean; autoFocus?: boolean; onEscape?: () => void; onBlur?: () => void
  placeholder?: string; className?: string
  ctx: () => FileCtx
  text: () => string
  fm?: string
  whole?: boolean
  onReady: (api: EditorApi) => void; onChange: (text: string, start: number) => void }) {
  const { disabled } = usePrefs()
  const { resolve, attach, ...wiring } = useVaultEditing(store, from, text)
  const [version, setVersion] = useState(0)
  const plugins = usePluginsVersion()
  useEffect(() => setVersion((v) => v + 1), [store, fm, disabled, plugins])
  const sections = useKindSections(store, from)
  const config = useMemo<PreviewConfig>(() => ({
    live: true,
    writable: editable,
    resolves: (t) => linkKind(resolve, t),
    asset: (name) => assetUrl(store, name, from),
    ...imageActions(store),
    sections,
    renderSection: (name, t, el) => island((x) => <TimelineSection text={x} title={capitalize(name)} kinds={timelineKinds(disabled)} />, t, el),
    renderBlock: (name, t, el, edit) => island((x) => <BlockView name={name} text={x} ctx={ctx()} disabled={disabled} edit={edit} />, t, el),
    renderEmbed: (target, height, el, edit) => drawEmbed(store, target, height, el, from, edit),
    renderMarkdown: (md) => renderMarkdown(md, { resolves: resolve, asset: (name) => assetUrl(store, name, from) }),
    follow: (link, newTab) => followLink(store, link, newTab, from),
    linkMenu: (link, at, text) => openLinkMenu(link, at, { from, text }),
    version,
  }), [editable, resolve, store, disabled, version, from, ctx, sections])
  // Layout effect cleanups run before React removes the DOM, so a blur after that is the unmount's, not the user's.
  const over = useRef(false)
  useLayoutEffect(() => { over.current = false; return () => { over.current = true } }, [])
  const blur = useMemo(() => onBlur && (() => { if (!over.current) onBlur() }), [onBlur])
  return (
    <div className={cn("note-editor", className)}>
      <Suspense fallback={<Arriving className="min-h-6" />}>
        <Editor doc={doc} frontmatter={whole} editable={editable} config={config} {...wiring} onAttach={editable ? attach : undefined} placeholderText={editable ? placeholder ?? "Start writing" : ""}
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
  /** Only this heading's section (`Plan`, `Week#Plan`): its lines, edited in place, the rest of the file kept as is. */
  section?: string
  /** Drawn instead when the file has no such heading. */
  noSection?: ReactNode
}

/** A vault Markdown file's body, or one of its sections, edited in place (a canvas card showing a note). */
export function FileEditor(props: FileEditorProps) {
  return <FileLoad key={`${props.path}#${props.section ?? ""}`} {...props} />
}

function FileLoad({ path, store, editable = true, autoFocus, onEscape, className, section, noSection }: FileEditorProps) {
  const [file, setFile] = useState<FileText | "missing" | "failed" | null>(null)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let on = true
    readFile(path).then((f) => { if (on) setFile(f) })
      .catch((e) => on && setFile((cur) => (gone(e) ? "missing" : cur && typeof cur === "object" ? cur : "failed")))
    return () => { on = false }
  }, [path, tries])
  useVaultChange(() => { if (typeof file === "string") setTries((n) => n + 1) }, [path])
  if (typeof file === "string") {
    return <p className={cn("text-[13px] text-muted-foreground", className)}>{file === "missing" ? `No file ${stem(path)} in the vault.` : `Couldn't read ${stem(path)}.`}</p>
  }
  if (!file) return <div className={cn("min-h-6", className)} aria-busy />
  if (section) {
    return <SectionBody store={store} initial={file} section={section} noSection={noSection} editable={editable && !isReadOnly(path)} autoFocus={autoFocus}
      onEscape={onEscape} className={className} onGone={() => setFile("missing")} />
  }
  return <FileBody store={store} initial={file} editable={editable && !isReadOnly(path)} autoFocus={autoFocus} onEscape={onEscape}
    className={className} onGone={() => setFile("missing")} />
}

const toasted = new WeakSet<Autosave>()
function saveToast(s: SaveStatus, path: string, above: number, saver: Autosave) {
  if (s.kind === "ok") { if (toasted.delete(saver)) dismissNotice(`unsaved:${path}`); return }
  if (s.kind === "conflict" || s.kind === "error") toasted.add(saver)
  if (s.kind === "conflict" && s.inline === false) {
    notify(`${stem(path)}: ${conflictText(s, above)} Both versions are kept in its history.`, {
      kind: "error", duration: 15_000, id: `unsaved:${path}`, action: { label: "Keep yours", run: () => saver.keep("mine") },
    })
  } else if (s.kind === "error") {
    notify(`Couldn't save ${stem(path)}${s.message ? `: ${s.message}` : ""}`, { kind: "error", id: `unsaved:${path}`, action: { label: "Try again", run: () => saver.save(true) } })
  }
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
    conflict: (text, clashes, who, left) => {
      const ok = !!api.current?.view.dom.isConnected && editable && api.current.conflict(text, clashes, who, left)
      if (ok) { const s = splitFm(text); cur.current = s; setFm(s.fm) }
      return ok
    },
    onStatus: (s) => saveToast(s, path, fmLines(cur.current), saver),
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

function SectionBody({ store, initial, section, noSection, editable, autoFocus, onEscape, className, onGone }: {
  store: Store; initial: FileText; section: string; noSection?: ReactNode; editable: boolean; autoFocus?: boolean; onEscape?: () => void
  className?: string; onGone: () => void }) {
  const path = initial.path
  const split = (text: string) => ({ text, parts: sectionParts(text, section) })
  const [shown, setShown] = useState(() => split(initial.text))
  const cur = useRef({ ...shown, part: shown.parts?.part ?? "" })
  const api = useRef<EditorApi | null>(null)
  const whole = useCallback(() => (cur.current.parts ? joinSection(cur.current.parts, cur.current.part) : cur.current.text), [])
  const saver = useAutosave(path, initial.text, {
    text: whole,
    apply: (text) => {
      const next = split(text)
      cur.current = { ...next, part: next.parts?.part ?? "" }
      setShown(next)
      if (next.parts) api.current?.replace(next.parts.part)
    },
    conflict: () => false,
    onStatus: (s) => saveToast(s, path, cur.current.parts ? cur.current.parts.before.split("\n").length - 1 : 0, saver),
    onGone, readOnly: !editable,
  })
  const body = useCallback(() => splitFm(whole()).body, [whole])
  const ctx = useCallback((): FileCtx => ({ store, path, fm: readProps(splitFm(whole()).fm).props, body: body() }), [store, path, whole, body])
  if (!shown.parts) return <>{noSection ?? <p className={cn("text-[13px] text-muted-foreground", className)}>No heading {section} in {stem(path)}.</p>}</>
  return (
    <Wired store={store} from={path} doc={cur.current.part} editable={editable} autoFocus={autoFocus} onEscape={onEscape}
      className={className} ctx={ctx} text={body}
      onReady={(a) => { api.current = a }}
      onChange={(t) => { cur.current.part = t; saver.changed() }} />
  )
}
