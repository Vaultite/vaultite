import { Fragment, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { BookOpen, Folder, FolderInput, Smile, Trash2, type LucideIcon } from "lucide-react"
import { Banner } from "@/components/Banner"
import { menuFor, menuOnCard } from "@/components/ContextMenu"
import { copyToVault, copyToVaultItem, folderMenu, revealItem } from "@/components/FileActions"
import { mediaItems } from "@/components/EmbedMenu"
import { typingIn, useCommandKeys, useCommands } from "@/core/commands"
import { dropActiveFile, setActiveFile, type ActiveFile } from "@/core/active"
import { askMove } from "@/components/FileTree"
import { fmtAgo, type Store } from "@/core/data"
import { isOutside } from "@/core/desktop"
import { addDropSink } from "@/core/filedrop"
import { useVaultChange } from "@/core/live"
import { followLink } from "@/core/links"
import { openLinkMenu } from "@/components/LinkMenu"
import { drawEmbed, island, linkKind, useVaultEditing } from "@/components/editing"
import { cleanName, folderOf, gone, inTrash, isHidden, isJson, isMd, isProtected, isReadOnly, joinFm, joinPath, moveFile, nameProblem, onMergeIn, onSettle, openFile, openFolder, readFile, refuseName, restoreFile, splitFm, stem, takeNew, type FileText } from "@/core/files"
import { isDesktop } from "@/core/platform"
import { takeRename } from "@/core/workspace"
import { useDraft } from "@/core/statefor"
import { formatSize, isMedia, kindOf, type FileKind } from "@/core/filekinds"
import { FileCard, ImageView, PdfView, PlayerView, rawUrl, useFileInfo } from "@/components/FileViewers"
import { assetUrl, imageActions } from "@/components/editing"
import { readProps, setProp } from "@/core/frontmatter"
import { changeIcon, iconChangeable } from "@/components/FileActions"
import { renderMarkdown } from "@/core/markdown"
import { notify, notifyError } from "@/core/notify"
import { merge3 } from "@/core/merge"
import { draftOf, dropDraft, keepDraft, type Draft } from "@/core/drafts"
import { blockFor, fileFormatFor, noteTopItems, fileViewFor, fillsPane, formatFor, timelineKinds, usePluginsVersion, useReadBlock, type FileCtx, type PageCtx } from "@/core/plugins"
import type { FileFormat, FileHead } from "@/core/define"
import { FormatBox, FormatGuard } from "@/components/FormatView"
import { Drawn, Guard } from "@/components/Guard"
import { FileBar } from "@/components/FileBar"
import { TimelineSection } from "@/components/Timeline"
import { Markdown } from "@/components/Markdown"
import { usePane } from "@/core/pane"
import { usePrefs } from "@/core/prefs"
import { useEditorSettings } from "@/core/editorPrefs"
import { useTextSize, useTextSizeWheel } from "@/core/textsize"
import { BlockView, kindStamps, useKindSections } from "@/components/Blocks"
import { openBlockMenu } from "@/components/BlockSource"
import { optionNotes, parseOptions } from "../../../core/blocks.ts"
import { Properties } from "@/components/Properties"
import { effectiveType } from "../../../core/fileprops.ts"
import { JsonView } from "@/components/JsonView"
import { barButton, ViewBar } from "@/components/ViewBar"
import { usePortalHost } from "@/components/kit"
import { ink } from "@/lib/ink"
import { useWideSheet } from "@/components/DetailSheet"
import { TITLE, TitleRow } from "@/components/FileTitle"
import { useHeldFocus } from "@/core/focus"
import { useEditAt, type DrawnLine } from "@/core/anchors"
import { conflictText, theirName, useAutosave, type SaveStatus } from "@/core/autosave"
import { trace } from "@/core/trace"
import { addRestore, afterPlaced, cancelRestores, cursorOf, hideUntilPlaced, keepCursor, offerPlace, readPlace, takeRestore } from "@/core/viewstate"
import { capitalize, cn, plural } from "@/lib/utils"
import { haptic } from "@/core/haptics"
import type { EditorApi } from "@/editor/Editor"
import { Editor } from "@/editor/lazy"
import type { PreviewConfig } from "@/editor/livePreview"

import { beforeMode, CODE_VIEWS, MODES, opensReading, SOURCE_VIEWS, useMode, usePublish, viewItems, VIEWS, type Mode } from "@/components/fileState"
import { fmLines, keepPlace, lineAtTop, partLineAt, revealProps, spotOf, useTextFocus, type Spot } from "@/components/filePlace"
import { share } from "@/core/share"

const Notebook = lazy(() => import("@/editor/Notebook"))

const aliasesOf = (fm: Record<string, unknown>) => (Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : []).map(String).filter((a) => a.trim())

function HeldFocus() { useHeldFocus(); return null }

const seen = new Map<string, FileText>()
const SEEN = 100
const remember = (path: string, f: FileText) => {
  seen.delete(path); seen.set(path, f)
  if (seen.size > SEEN) seen.delete(seen.keys().next().value!)
}

let renamed: { path: string; mode: Mode; write: boolean } | null = null
const takeRenamed = (path: string) => { const r = renamed?.path === path ? renamed : null; if (r) renamed = null; return r }

const Title = memo(function Title({ path, editable, sheet, focus, settle, mode, onEnter }: { path: string; editable: boolean; sheet: boolean; focus: boolean
  settle: () => Promise<void>
  mode?: Mode
  onEnter?: () => void }) {
  const name = stem(path)
  const [v, setV] = useDraft(name)
  const ref = useRef<HTMLTextAreaElement>(null)
  const enter = useRef(false)
  useEffect(() => { if (focus && editable) { ref.current?.focus(); ref.current?.select() } }, [focus, editable])
  // A hidden tab's textarea measures 0 high: fitting it there would jump the page when it's shown.
  const fit = () => { const t = ref.current; if (t?.offsetWidth) { t.style.height = "0"; t.style.height = `${t.scrollHeight}px` } }
  useEffect(fit, [v, editable])
  useEffect(() => {
    const t = ref.current
    if (!t) return
    let w = t.offsetWidth
    const ro = new ResizeObserver(() => { if (t.offsetWidth !== w) { w = t.offsetWidth; fit() } })
    ro.observe(t)
    return () => ro.disconnect()
  }, [editable])
  if (!editable) return <h1 id={sheet ? "sheet-title" : undefined} className={TITLE}>{name}</h1>
  const commit = () => {
    const write = enter.current
    enter.current = false
    rename(path, v, settle, !focus, mode && { mode, write }).then((ok) => { if (!ok) { setV(name); if (write) onEnter?.() } })
  }
  return (
    <h1 className={TITLE}><textarea ref={ref} id={sheet ? "sheet-title" : undefined} value={v} rows={1} spellCheck={false} aria-label="File name"
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); const { why } = renaming(path, v); if (why) return refuseName(why, e.currentTarget); enter.current = true; e.currentTarget.blur() }
        if (e.key === "Escape") { setV(name); (e.target as HTMLTextAreaElement).blur() }
      }}
      className="block w-full resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground" /></h1>
  )
})

function renaming(path: string, typed: string) {
  const ext = path.split("/").pop()!.slice(stem(path).length)
  const to = joinPath(folderOf(path), cleanName(typed) + ext)
  return { to, why: nameProblem(typed, path, to) }
}

async function rename(path: string, typed: string, settle: () => Promise<void>, undo = true, after?: { mode: Mode; write: boolean }) {
  const { to, why } = renaming(path, typed)
  if (why) { refuseName(why); return false }
  if (!cleanName(typed) || to === path) return false
  try {
    await settle()
    if (after) renamed = { path: to, ...after }
    const had = seen.get(path)
    if (had) remember(to, { ...had, path: to })
    const r = await moveFile(path, to, { undo })
    if (after && r.path !== to) renamed = { path: r.path, ...after }
    return true
  }
  catch (e) { notifyError(e, "Couldn't rename"); return false }
}

const PathBar = memo(function PathBar({ path, mode, setMode, edit, views, settle, locked, head, className }: { path: string; settle: () => Promise<void>
  head?: FileHead
  className?: string
  mode?: Mode; setMode?: (m: Mode) => void; edit?: Mode; views?: typeof VIEWS
  locked: boolean }) {
  const outside = isOutside(path)
  const folders = folderOf(path) && !outside ? folderOf(path).split("/") : []
  const name = stem(path)
  const [editing, setEditing] = useState(false)
  const [v, setV] = useDraft(name)
  useEffect(() => {
    const check = () => { if (takeRename(path)) setEditing(true) }
    check()
    addEventListener("vaultite:rename", check)
    return () => removeEventListener("vaultite:rename", check)
  }, [path])
  const crumb = "h-6 min-w-0 cursor-pointer truncate rounded-[4px] px-1 leading-6 hover:bg-foreground/[0.06]"
  const view = mode && setMode && edit && views && <ViewToggle mode={mode} setMode={setMode} edit={edit} views={views} />
  return (
    <ViewBar right={<>
      {head && <FileBar head={head} place="bar" />}{view}
      {outside && (
        <button type="button" onClick={() => copyToVault(path)} aria-label="Copy to vault" data-tip="Copy to vault" className={barButton}>
          <FolderInput className="size-4" strokeWidth={2} />
        </button>
      )}
    </>} className={className}>
      <nav aria-label="File path" className="flex min-w-0 items-center">
        {outside && (
          <>
            <span data-tip={folderOf(path)} className="h-6 min-w-0 shrink truncate px-1 leading-6 text-muted-foreground">Outside the vault</span>
            <span aria-hidden className="shrink-0 px-px text-tertiary">/</span>
          </>
        )}
        {folders.map((f, i) => {
          const at = folders.slice(0, i + 1).join("/")
          return (
            <Fragment key={at}>
              <button type="button" onClick={() => openFolder(at)} onContextMenu={menuFor(() => folderMenu(at))}
                data-tip="Open folder" data-tip-cut={`${f}\nOpen folder`} className={cn(crumb, "shrink-[1000] text-muted-foreground hover:text-foreground",
                  f.length > 2 && "min-w-[2.5em]")}>{f}</button>
              <span aria-hidden className="shrink-0 px-px text-tertiary">/</span>
            </Fragment>
          )
        })}
        {editing ? (
          <span className="inline-grid min-w-0 shrink-0 font-medium">
            <span aria-hidden className="invisible col-start-1 row-start-1 h-6 px-1 leading-6 whitespace-pre">{v || " "}</span>
            <HeldFocus />
            <input autoFocus value={v} aria-label="File name" spellCheck={false}
              onFocus={(e) => e.target.select()} onChange={(e) => setV(e.target.value)}
              onBlur={async () => { setEditing(false); if (!(await rename(path, v, settle))) setV(name) }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur()
                if (e.key === "Escape") { setV(name); setEditing(false) }
              }}
              className="col-start-1 row-start-1 h-6 w-full min-w-10 rounded-[4px] bg-card px-1 outline-none ring-1 ring-primary/60" />
          </span>
        ) : locked ? (
          <span className="h-6 min-w-0 truncate px-1 leading-6 font-medium">{name}</span>
        ) : (
          <button type="button" onClick={() => setEditing(true)} data-tip="Rename" className={cn(crumb, "font-medium")}>{name}</button>
        )}
      </nav>
    </ViewBar>
  )
})

function NoteTop({ head, place }: { head: FileHead; place: "page" | "sheet" }) {
  const { disabled, enabled } = usePrefs()
  const plugins = usePluginsVersion()
  const items = useMemo(() => noteTopItems(disabled), [disabled, enabled, plugins])
  const ctx = useMemo(() => ({ ...head, place }), [head, place])
  return <>{items.map(({ key, item }) => <Guard key={key} what="This part" reset={head.path}><Drawn draw={() => item.render(ctx)} /></Guard>)}</>
}

const folderLine = (path: string) => (folderOf(path) ? folderOf(path).split("/").join(" / ") : share?.folder ?? "Vault")

function TitleLine({ icon: Icon, tint = "var(--muted-foreground)", text, head, pane, toggle }: {
  icon: LucideIcon; tint?: string; text: ReactNode; head: FileHead; pane: boolean; toggle?: ReactNode }) {
  return (
    <div className={cn("mb-1 flex min-h-8 flex-wrap items-center gap-x-2", !pane && (toggle ? "pr-[75px]" : "pr-[31px]"))}>
      <span className="flex min-w-16 flex-[1_1_0] items-center gap-1.5 text-[15px] font-semibold" style={{ color: tint && ink(tint) }}>
        <Icon className="size-[18px] shrink-0" strokeWidth={2.25} />
        <span className="truncate">{text}</span>
      </span>
      <FileBar head={head} place="line" />
      {toggle}
    </div>
  )
}

const ViewToggle = memo(function ViewToggle({ mode, setMode, edit, views, phone }: { mode: Mode; setMode: (m: Mode) => void; edit: Mode; views: typeof VIEWS; phone?: "sheet" | "header" }) {
  const { hidden } = usePane()
  const host = usePortalHost(phone && !hidden ? (phone === "sheet" ? "sheet-actions" : "phone-actions") : null)
  const toggleKeys = useCommandKeys("view:toggle", true)
  const reading = mode === "read"
  const Icon = MODES[reading ? "live" : "read"].icon
  const label = reading ? "Edit" : "Read"
  const menu = menuOnCard(() => viewItems(views, mode, setMode))
  if (!phone) {
    return (
      <button type="button" onClick={() => setMode(reading ? edit : "read")} onContextMenu={menu} aria-label={label}
        data-tip={`Current view: ${MODES[mode].label}\n${reading ? "Click to edit" : "Click to read"}${toggleKeys}\nRight-click for all views`} className={barButton}>
        <Icon className="size-4" strokeWidth={2} />
      </button>
    )
  }
  const button = (
    <button type="button" data-view-toggle={mode} onClick={() => { haptic(); setMode(reading ? edit : "read") }} onContextMenu={menu} aria-label={label} aria-pressed={!reading}
      className="grid size-11 shrink-0 cursor-pointer place-items-center text-primary active:opacity-50 md:text-muted-foreground md:transition-colors md:hover:text-foreground">
      <Icon className="size-[21px] md:size-[18px]" strokeWidth={2} />
    </button>
  )
  return host ? createPortal(button, host) : null
})

export function FileView({ store, path, pane }: { store: Store; path: string; pane: boolean }) {
  const kind = kindOf(path)
  if (isMedia(kind)) return <MediaFile key={path} store={store} path={path} pane={pane} kind={kind} />
  return <TextFile key={path} store={store} path={path} pane={pane} />
}

function TextFile({ store, path, pane }: { store: Store; path: string; pane: boolean }) {
  const [file, setFile] = useState<FileText | null | "missing" | "binary" | "big">(() => seen.get(path) ?? null)
  const [tries, setTries] = useState(0)
  useEffect(() => {
    let on = true
    readFile(path).then((f) => { if (on) { remember(path, f); setFile(f) } })
      .catch((e) => on && setFile((cur) => (NOT_TEXT.test(String(e)) ? (/too big/.test(String(e)) ? "big" : "binary")
        : cur && typeof cur === "object" && !gone(e) ? cur : "missing")))
    return () => { on = false }
  }, [path, tries])
  useVaultChange(() => { if (typeof file === "string") setTries((n) => n + 1) }, [path])
  const { disabled } = usePrefs()
  const padded = (node: ReactNode) => (pane && fillsPane(path, disabled) ? <PaneScroll>{node}</PaneScroll> : node)
  if (file === "missing") return padded(<Missing path={path} pane={pane} />)
  if (file === "binary" || file === "big") return padded(<MediaFile store={store} path={path} pane={pane} kind="binary" note={file === "big" ? "Too big to open here." : undefined} />)
  if (!file) return <div className="min-h-[50vh]" aria-busy />
  return <Loaded key={path} store={store} initial={file} pane={pane} onGone={() => setFile("missing")} />
}

const moveCommand = (path: string) => (isReadOnly(path) || isOutside(path) ? [] : [{ id: "file:move", name: "Move current file to another folder", run: () => askMove(path), icon: FolderInput }])

function MediaFile({ store, path, pane, kind, note }: { store: Store; path: string; pane: boolean; kind: FileKind; note?: string }) {
  const [info, v, missing] = useFileInfo(path)
  const { disabled } = usePrefs()
  const format = kind === "binary" && !isHidden(path) && !note ? formatFor(path, disabled)?.format ?? null : null
  const drawn = format?.binary ? format : null
  const [extra, setExtra] = useState<string | null>(null)
  const { focused } = usePane()
  const live = pane && focused
  const facts = useMemo(() => [extra, info?.pages ? plural(info.pages, "page") : null, info ? formatSize(info.size) : null]
    .filter((x): x is string => !!x), [extra, info])
  const noop = useCallback(() => {}, [])
  const head = useMemo<FileHead>(() => ({ path, fm: {}, type: null }), [path])
  usePublish(pane, () => ({ path, mode: "read", setMode: noop, body: "", views: [], info: facts, head }), [path, facts, noop, head])
  useCommands(() => (live ? moveCommand(path) : []), [live, path])
  if (missing) return <Missing path={path} pane={pane} />
  const settle = async () => {}
  const duration = (secs: number) => {
    if (!Number.isFinite(secs)) return
    const t = Math.round(secs), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0")
    setExtra(h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`)
  }
  const onMenu = (e: MouseEvent) => {
    if (e.defaultPrevented || (e.target as Element).closest("input, textarea, [contenteditable]")) return
    menuFor(() => mediaItems(path, isOutside(path)))(e)
  }
  return (
    <article className={cn("file-view", pane && "mx-auto max-w-[1040px] pb-24")} data-path={path} data-kind={kind} onContextMenu={onMenu}>
      {pane && isDesktop() && <PathBar path={path} settle={settle} locked={isReadOnly(path) || isProtected(path) || isOutside(path)} head={head} />}
      {(!pane || !isDesktop()) && (
        <>
          <TitleLine icon={Folder} text={folderLine(path)} head={head} pane={pane} />
          <Title path={path} editable={false} sheet focus={false} settle={settle} />
        </>
      )}
      {inTrash(path) && <InTrash path={path} />}
      <div className={cn(!pane && "mt-4")}>
        {kind === "image" ? <ImageView path={path} info={info} v={v} page={pane} onSize={(w, h) => setExtra(`${w} × ${h}`)} />
          : kind === "pdf" ? <PdfView path={path} info={info} v={v} page={pane} />
          : kind === "audio" || kind === "video" ? <PlayerView path={path} info={info} v={v} video={kind === "video"} onDuration={duration} />
          : drawn ? <BinaryFormat store={store} format={drawn} path={path} v={v} pane={pane} />
          : <FileCard path={path} info={info} note={note} />}
      </div>
    </article>
  )
}

function BinaryFormat({ store, format, path, v, pane }: { store: Store; format: FileFormat; path: string; v: number; pane: boolean }) {
  const ctx = { store, path, text: "", url: rawUrl(path, { v }), editable: false, place: pane ? "page" as const : "sheet" as const, onChange: () => {} }
  return framed(format.layout, pane, format.render(ctx))
}
const framed = (layout: FileFormat["layout"], pane: boolean, node: ReactNode) =>
  !layout || layout === "box" || layout === "pane" ? <FormatBox place={pane ? "page" : "sheet"}>{node}</FormatBox> : <FormatGuard>{node}</FormatGuard>

function Missing({ path, pane }: { path: string; pane: boolean }) {
  const bar = pane && isDesktop()
  return (
    <article className={cn("file-view", pane && "mx-auto max-w-(--line-width) pb-24", !bar && "py-10")} data-path={path}>
      {bar && <PathBar path={path} settle={async () => {}} locked />}
      <h1 className={TITLE}>{stem(path)}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">This file isn't in the vault any more. It may have been renamed or deleted.</p>
    </article>
  )
}

function Loaded({ store, initial, pane, onGone }: { store: Store; initial: FileText; pane: boolean; onGone: () => void }) {
  const path = initial.path
  const [saved, setSaved, tabId, tabEdit] = useMode()
  const wideSheet = useWideSheet()
  const [fresh] = useState(() => takeNew(path))
  const [kept] = useState(() => takeRenamed(path))
  const [override, setOverride] = useState<Mode | null>(fresh && saved === "read" ? tabEdit : kept?.mode ?? null)
  const first = splitFm(initial.text)
  const [fm, setFm] = useState(first.fm)
  const { disabled: off, enabled } = usePrefs()
  const disabled = useMemo(() => [...off], [off, enabled])
  const { props } = useMemo(() => readProps(fm), [fm])
  const files = store.files.files
  const row = useMemo(() => files.find((f) => f.path === path), [files, path])
  const type = effectiveType(row?.kind ? row.type : null, props)
  const pv = isHidden(path) || !isMd(path) ? null : fileViewFor({ path, type }, disabled)
  const view = pv?.view
  const pageView = view?.page ?? null
  const dash = !!pageView
  const kind = kindOf(path)
  const outside = isOutside(path)
  usePluginsVersion()
  const taken = isHidden(path) || !isMd(path) || outside ? null : fileFormatFor(path, disabled)
  const drawer = isHidden(path) ? null : taken ?? formatFor(path, disabled)?.format ?? null
  const format = drawer && !(outside && drawer.vaultOnly) ? drawer : null
  const notebook = kind === "notebook"
  const readOnlyDrawn = format?.edit === "source" || notebook
  const code = !format && (kind === "code" || kind === "other" || (kind === "json" && !isJson(path)))
  const drawn = dash || readOnlyDrawn
  const [opensRead] = useState(opensReading)
  const mode = override ?? (drawn ? "read" : format ? (opensRead ? "read" : "live") : saved)
  const pick = useCallback((m: Mode) => { if (drawn || code || format) { setOverride(m); return } setOverride(null); setSaved(m) }, [setSaved, drawn, code, format])
  const json = isJson(path), hidden = isHidden(path), ro = isReadOnly(path)
  const shown: Mode = code ? "source" : readOnlyDrawn && mode === "live" ? "source" : mode
  const views = code ? CODE_VIEWS : readOnlyDrawn ? SOURCE_VIEWS : VIEWS
  const edit: Mode = code || readOnlyDrawn ? "source" : format ? "live" : tabEdit
  const strict = json || notebook || !!format?.json
  const [tick, redraw] = useReducer((n: number) => n + 1, 0)
  const [status, setStatus] = useState<SaveStatus>({ kind: "ok" })
  const [problems, setProblems] = useState(initial.problems)
  const cur = useRef({ fm: first.fm, body: first.body })
  const onTyped = useRef(() => {})
  const full = () => joinFm(cur.current.fm, cur.current.body)
  const editor = useRef<{ api: EditorApi; source: boolean } | null>(null)
  const toText = () => {
    const v = editor.current?.api.view
    if (!v || v.state.readOnly) return
    v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true })
    v.focus()
  }
  const article = useRef<HTMLElement>(null)
  const spot = useRef<Spot | null>(null)
  const shownNow = useRef(shown)
  shownNow.current = shown
  const { focused, hidden: behind } = usePane()
  const noteSpot = () => { spot.current = spotOf(article.current, editor.current?.api ?? null, fmLines(cur.current)) }
  const keepAt = () => {
    const v = editor.current?.api.view
    if (!v?.dom.isConnected || v.contentDOM.contentEditable !== "true") return
    const above = fmLines(cur.current)
    const head = v.state.selection.main.head, line = v.state.doc.lineAt(head)
    keepCursor(path, line.number - 1 - above, head - line.from)
  }
  const intoText = useRef(false)
  const setMode = useCallback((m: Mode) => {
    if (m !== shownNow.current) {
      noteSpot()
      if (editor.current?.api.view.hasFocus) keepAt()
      trace("editor", { ev: "view", path, from: shownNow.current, to: m, at: cursorOf(path) })
      intoText.current = m !== "read"
      const at = document.activeElement
      if (m === "read" && (at instanceof HTMLElement || at instanceof SVGElement) && article.current?.contains(at)) at.blur()
    }
    pick(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- noteSpot and keepAt read refs; path is fixed per mount
  }, [pick])
  const placing = useRef<{ s: Spot; stop: (() => void) | null; landed?: () => void } | null>(null)
  const placeAt = (s: Spot, ed: { api: EditorApi; source: boolean } | null, landed?: () => void) => {
    const art = article.current
    if (art) art.style.visibility = "hidden"
    let once = false
    const show = () => { clearTimeout(late); if (art) art.style.visibility = ""; if (!once) { once = true; landed?.() } }
    const late = setTimeout(show, 400)
    return keepPlace(s, ed?.api ?? null, fmLines(cur.current), art, show, show)
  }
  const follows = override === null && !drawn && !code && !format
  const followsNow = useRef(follows)
  followsNow.current = follows
  useEffect(() => {
    const before = (m: Mode, tab: string) => { if (tab === tabId && followsNow.current && m !== shownNow.current && !spot.current) noteSpot() }
    beforeMode.add(before)
    return () => { beforeMode.delete(before) }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- noteSpot reads refs
  }, [tabId])
  const canFocus = !ro && !hidden && isDesktop() && !(format && shown !== "source")
  const focusText = useTextFocus(editor, article, shownNow, cur)
  const revealing = useRef(false)
  const putBack = useRef<(() => void) | null>(null)
  const tookLine = useRef(false)
  const toLine = useCallback((line: number, find?: string, from?: DrawnLine, col = 0) => {
    if (ro || hidden) return
    tookLine.current = true
    putBack.current?.(); putBack.current = null
    cancelRestores()
    // opacity, not visibility: a visibility:hidden editor can't take the cursor.
    let there: (() => void) | undefined
    const art = article.current
    if (shownNow.current === "read") {
      revealing.current = true
      pick(edit)
      if (art) {
        art.style.opacity = "0"
        there = () => { clearTimeout(late); art.style.opacity = "" }
        const late = setTimeout(there, 600)
      }
    }
    const fm = fmLines(cur.current)
    focusText([Math.max(0, line - fm), col, find], { hold: from && { line: Math.max(0, from.line - fm), y: from.y }, there })
  }, [ro, hidden, pick, edit, focusText])
  const articleEl = useCallback(() => article.current, [])
  useEditAt(path, articleEl, toLine)
  const { propertiesInDocument: propsIn, readableLineLength: readable, showInlineTitle } = useEditorSettings(store)
  useEffect(() => {
    const on = (e: Event) => {
      if (!(e instanceof CustomEvent) || e.detail !== path || ro || hidden) return
      const to = propsIn === "hidden" ? "source" : edit
      if (shownNow.current !== to && (shownNow.current === "read" || propsIn === "hidden")) pick(to)
    }
    addEventListener("vau:properties", on)
    return () => removeEventListener("vau:properties", on)
  }, [path, ro, hidden, pick, edit, propsIn])
  useLayoutEffect(() => {
    if (revealing.current) { revealing.current = false; spot.current = null }
    const s = spot.current
    spot.current = null
    const into = intoText.current && canFocus && shown !== "read"
    intoText.current = false
    let stopFocus: (() => void) | undefined
    const landed = into ? () => { trace("editor", { ev: "land", path, at: cursorOf(path) }); stopFocus = focusText(cursorOf(path)) } : undefined
    if (!s) { landed?.(); return () => stopFocus?.() }
    const ed = editor.current?.api.view.dom.isConnected ? editor.current : null
    const coming = !ed && !board && !drawing && !(notebook && !source) && !(json && !source)
    if (!coming) {
      const stopPlace = placeAt(s, ed, landed)
      return () => { stopPlace(); stopFocus?.() }
    }
    const p: { s: Spot; stop: (() => void) | null; landed?: () => void } = { s, stop: null, landed }
    placing.current = p
    const art = article.current
    if (art) art.style.visibility = "hidden"
    const shownLate = setTimeout(() => { if (art) art.style.visibility = "" }, 800)
    const late = setTimeout(() => { if (placing.current === p) { placing.current = null; p.stop = placeAt(s, null, landed) } }, 5000)
    return () => {
      clearTimeout(shownLate)
      clearTimeout(late)
      if (placing.current === p) placing.current = null
      p.stop?.()
      stopFocus?.()
      if (art) art.style.visibility = ""
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs on a change of view only
  }, [shown])
  const ready = (api: EditorApi, source: boolean) => {
    const p = placing.current
    if (p) { placing.current = null; p.stop = placeAt(p.s, { api, source }, p.landed); return }
    resume(api)
  }
  useEffect(() => {
    if (!pane || behind || !article.current) return
    const box = article.current.closest<HTMLElement>("[data-pane], [data-kept], [data-stacked]")
    if (!box && isDesktop()) return
    return readPlace(box, () => {
      const ed = editor.current
      const top = box ? box.getBoundingClientRect().top : 0
      if (ed?.api.view.dom.isConnected) return lineAtTop(ed.api.view, top, fmLines(cur.current))
      return article.current ? partLineAt(article.current, top) : null
    })
  }, [pane, path, behind])
  const grid = dash && shown === "read"
  useLayoutEffect(() => {
    const art = article.current
    if (!pane || !grid || !art?.querySelector("[data-line]")) return
    return offerPlace(`file:${path}`, () => resume(null))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- resume is new each render
  }, [pane, grid, path])
  useLayoutEffect(() => { if (pane) hideUntilPlaced(`file:${path}`, article.current) }, [pane, path])
  const resume = (api: EditorApi | null) => {
    const r = pane ? takeRestore(`file:${path}`) : null
    if (!r) return
    let drop = () => {}
    const stop = keepPlace({ box: r.box, y: 0, ratio: 0, line: r.line, into: r.into, text: !!api }, api, api ? fmLines(cur.current) : 0, article.current,
      () => { drop(); r.show() }, r.show)
    drop = addRestore(stop)
  }
  useEffect(() => {
    if (!pane || !focused || fresh || kept || shown === "read" || !canFocus) return
    let stop: (() => void) | undefined
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const a = document.activeElement
        if (a && a !== document.body && typingIn(a) && !article.current?.contains(a)) return
        let stopFocus: (() => void) | undefined
        if (tookLine.current) return
        const press = () => stop?.()
        addEventListener("pointerdown", press, true)
        const unwait = afterPlaced(`file:${path}`, () => { removeEventListener("pointerdown", press, true); if (!tookLine.current) stopFocus = focusText(cursorOf(path)) })
        stop = putBack.current = () => { removeEventListener("pointerdown", press, true); unwait(); stopFocus?.() }
      })
    })
    return () => { cancelAnimationFrame(frame); stop?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, as the file opens
  }, [])
  useEffect(() => {
    const el = article.current
    if (!el) return
    let touched = false
    const keep = () => { if (touched) keepAt() }
    const into = (e: FocusEvent) => { if ((e.target as HTMLElement).closest?.(".cm-content")) touched = true }
    el.addEventListener("focusin", into)
    el.addEventListener("focusout", keep)
    return () => { el.removeEventListener("focusin", into); el.removeEventListener("focusout", keep); keep() }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keepAt reads refs
  }, [path])
  const apply = useCallback((text: string) => {
    const { fm: f, body: b } = splitFm(text)
    if (b !== cur.current.body) setVersion((v) => v + 1)
    cur.current = { fm: f, body: b }
    setFm(f)
    editor.current?.api.replace(text)
    redraw()
  }, [])

  const saver = useAutosave(path, initial.text, {
    text: full, apply, onStatus: setStatus, readOnly: ro,
    conflict: (text, clashes, who, left, note) => {
      const ed = editor.current
      return !!ed?.api.view.dom.isConnected && !ed.api.view.state.readOnly && ed.api.conflict(text, clashes, who, left, note) && (apply(text), true)
    },
    onDisk: (f) => { remember(path, f); setProblems(f.problems ?? []) },
    onGone: () => { seen.delete(path); onGone() },
  })
  const changed = saver.changed, save = saver.save, settle = saver.settle

  // eslint-disable-next-line react-hooks/exhaustive-deps -- changed is the saver's, made once a mount
  const editAround = useCallback((text: string) => {
    const ed = editor.current
    if (!ed?.api.view.dom.isConnected) { apply(text); changed(); return }
    ed.api.change(text)
  }, [apply])
  const typed = useCallback((text: string, start: number | null, remote = false) => {
    const s = start === null ? splitFm(text) : { fm: text.slice(0, start), body: text.slice(start) }
    cur.current = s
    setFm(s.fm)
    onTyped.current()
    if (!remote) changed()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- changed is the saver's, made once a mount
  }, [])
  const setProps = useCallback((b: string) => editAround(joinFm(b, cur.current.body)), [editAround])
  const setProperty = useCallback((key: string, value: unknown) => {
    const { fm: f, body: b } = cur.current
    const block = setProp(f || (b.trim() ? "---\n---\n\n" : "---\n---\n"), key, value)
    if (block !== f) editAround(joinFm(block, b))
  }, [editAround])

  useEffect(() => onSettle(path, saver.calm, () => saver.disk), [path, saver])
  useEffect(() => (ro ? undefined : onMergeIn(path, saver.mergeIn)), [path, saver, ro])

  const [badJson, setBadJson] = useState<string | null>(null)
  const jsonCheck = useRef(0)
  const checkJson = () => {
    clearTimeout(jsonCheck.current)
    if (!strict) return
    jsonCheck.current = window.setTimeout(() => {
      const text = full()
      try { if (text.trim()) JSON.parse(text); setBadJson(null) } catch (e) { setBadJson(String((e as Error).message ?? e)) }
    }, 600)
  }
  useEffect(() => { checkJson(); return () => clearTimeout(jsonCheck.current) },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkJson is new each render; these are what it reads
    [strict, fm, tick])
  const [leftover, setLeftover] = useState<Draft | null>(null)
  useEffect(() => {
    let live = true
    if (!ro && full() === saver.disk) void draftOf(path, initial.text).then((d) => { if (live && full() === saver.disk) setLeftover(d) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- full reads refs
  }, [path, initial, ro, saver])
  const restoreUnsaved = (u: Draft) => {
    setLeftover(null)
    editAround((u.base ? merge3(u.base, u.text, full()) : null) ?? u.text)
  }
  const discardUnsaved = (u: Draft) => {
    setLeftover(null)
    dropDraft(path)
    notify("Discarded the unsaved edits", { action: { label: "Undo", run: () => { keepDraft(path, u.text, u.base); setLeftover(u) } } })
  }

  useEffect(() => {
    if (!outside) return
    const t = setInterval(() => document.visibilityState === "visible" && saver.check(), 5000)
    return () => clearInterval(t)
  }, [outside, saver])
  useEffect(() => { if (initial.text !== saver.disk) void saver.check(initial) }, [initial, saver])

  const changeable = !ro && (!!share || !isProtected(path)) && !inTrash(path) && !outside && isMd(path)
  const ctx: FileCtx = { store, path, fm: props, get body() { return cur.current.body }, setProperty: changeable ? setProperty : undefined }
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  const editingRef = useRef(shown === "live")
  editingRef.current = shown === "live"
  const { resolve, attach, ...wiring } = useVaultEditing(store, path, full)

  const [version, setVersion] = useState(0)
  const plugins = usePluginsVersion()
  useEffect(() => setVersion((v) => v + 1), [store, fm, disabled, shown, plugins])
  const sections = useKindSections(store, path)
  const editGrid = dash && shown === "live" ? pageView?.editGrid ?? null : null
  const pageRef = useRef<PageCtx | null>(null)
  const readBlock = useReadBlock(disabled)
  const config = useMemo<PreviewConfig>(() => ({
    live: shown !== "source",
    writable: !ro,
    resolves: (t) => linkKind(resolve, t),
    asset: (name) => assetUrl(store, name, path),
    ...imageActions(store),
    sections,
    renderSection: (name, text, el) => island((t) => <TimelineSection text={t} title={capitalize(name)} kinds={timelineKinds(disabled)} path={ro || !isMd(path) ? undefined : path} />, text, el),
    renderBlock: (name, text, el, edit) => island((t) => <BlockView name={name} text={t} ctx={ctxRef.current} disabled={disabled} editing={editingRef.current} edit={edit} />, text, el),
    blockMenu: (name, text, at, edit) => openBlockMenu(at, { name, text, path, edit, showing: true }),
    blockNotes: (name, text) => {
      if (name.startsWith("```")) return { notes: [] }
      const { options, error } = parseOptions(text), { decl } = blockFor(name, disabled, options)
      return { notes: optionNotes(decl, options, error), about: decl?.description }
    },
    renderEmbed: (target, height, el, edit) => drawEmbed(store, target, height, el, path, edit),
    renderMarkdown: (md) => renderMarkdown(md, { resolves: resolve, asset: (name) => assetUrl(store, name, path) }),
    follow: (link, newTab) => followLink(store, link, newTab, path),
    linkMenu: (link, at, text) => openLinkMenu(link, at, { from: path, text }),
    version,
    place: path,
    renderGrid: editGrid ? (cards, el, edit) => island((c) => editGrid(c, edit, pageRef.current!), cards, el) : undefined,
    readBlock,
  }), [shown, ro, resolve, store, disabled, version, path, sections, editGrid, readBlock])


  const live = pane && focused
  useCommands(() => (live ? [
    ...(views.length > 1 ? [{ id: "view:toggle", name: "Switch to reading view", keys: ["Mod+E"], run: () => setMode(shown === "read" ? edit : "read"), icon: BookOpen,
      nameWhenOn: `Switch to ${(views.find((v) => v.value === edit)?.label ?? "editing view").toLowerCase()}`, on: () => shown === "read" }] : []),
    ...views.filter((v) => v.value !== shown).map((v) => ({ id: `view:${v.value}`, name: `Switch to ${v.label.toLowerCase()}`, run: () => setMode(v.value), icon: MODES[v.value].icon })),
    ...moveCommand(path),
    ...(isReadOnly(path) || isOutside(path) || !isMd(path) ? [] : [{ id: "file:icon", name: "Change icon of current file", run: () => changeIcon(path, (n) => setProperty("icon", n)), icon: Smile }]),
  ] : []), [live, shown, setMode, path, edit, views, setProperty])

  const insertText = (text: string) => {
    const ed = editor.current
    if (ed && !ed.api.view.state.readOnly) {
      const v = ed.api.view, r = v.state.selection.main
      v.dispatch({ changes: { from: r.from, to: r.to, insert: text }, selection: { anchor: r.from + text.length }, scrollIntoView: true, userEvent: "input" })
      v.focus()
      return
    }
    const b = cur.current.body
    apply(joinFm(cur.current.fm, b + (b && !b.endsWith("\n") ? "\n" : "") + text))
    changed()
  }
  const writable = live && isMd(path) && !ro && !hidden && !outside && !format
  useEffect(() => {
    if (!writable) return
    const f: ActiveFile = {
      path,
      text: full,
      setText: editAround,
      insert: insertText,
      settle,
    }
    setActiveFile(f)
    return () => dropActiveFile(f)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- insertText and full read refs
  }, [writable, path, apply, editAround, settle])

  const says = format?.status
  const fileHead = useMemo<FileHead>(() => ({ path, fm: props, type, setProperty: changeable ? setProperty : undefined }), [path, props, type, changeable, setProperty])
  const republish = usePublish(pane, () => ({ path, mode: shown, setMode, body: cur.current.body, fm, head: fileHead, views, says }), [path, shown, setMode, tick, fm, fileHead, views, says])
  onTyped.current = () => { republish(); checkJson() }

  const source = shown === "source"
  const fmText = propsIn === "source" && shown === "live"
  const showProps = !source && !json && !notebook && !format && !(dash && shown === "read") && (shown === "read" ? propsIn !== "hidden" : propsIn === "visible")

  const phoneTab = pane && !isDesktop()
  const board = dash && shown === "read"
  const layout = format?.layout ?? "box"
  const page = layout === "full" && shown === "read" && pane
  const titled = showInlineTitle || !pane
  const pageCtx: PageCtx = { store, path, fm: props, get body() { return cur.current.body }, setProperty: ctx.setProperty, title: stem(path), place: pane ? "page" : "sheet", disabled }
  pageRef.current = pageCtx
  const wide = (board || !!editGrid) && !pageView?.narrow?.(pageCtx)
  const column = pane || wideSheet
  const fills = pane && layout === "pane"
  const pathBar = (className?: string) => pane && isDesktop() && <PathBar path={path} mode={views.length > 1 ? shown : undefined} setMode={setMode} edit={edit} views={views}
    settle={settle} locked={isReadOnly(path) || isProtected(path) || outside} head={fileHead} className={className} />
  const phoneToggle = phoneTab && !ro && views.length > 1 && <ViewToggle mode={shown} setMode={setMode} edit={edit} views={views} phone="header" />
  const note = pane && isMd(path) && !dash && !format && !json && !notebook && !code
  const size = useTextSize("note")
  useTextSizeWheel(article, note ? "note" : null)
  const zoom = note && size !== 100 ? size / 100 : 0
  const drawing = format && !source ? format.render({ store, path, text: full(), editable: shown === "live" && !ro && !share, place: pane ? "page" : "sheet",
    onChange: (text) => { if (text === full()) return; const s = splitFm(text); cur.current = s; setFm(s.fm); redraw(); changed() } }) : null
  const clashes = useMemo(() => {
    const own = path.replace(/\.md$/i, "")
    return aliasesOf(props).flatMap((alias) => {
      const hit = resolve(alias), to = hit ? (hit.file ?? hit.id).replace(/\.md$/i, "") : own
      return to === own ? [] : [{ alias, other: hit!.file ?? `${to}.md` }]
    })
  }, [props, resolve, path])
  const notices = <>
    {inTrash(path) && <InTrash path={path} note=" Restore it to edit it." />}
    {path.startsWith(".vaultite/generated/") && <Banner tone="info">The app's copy of what it last wrote, kept to merge its updates into your edits. Read-only.</Banner>}
    {status.kind === "conflict" && status.inline !== undefined && <Banner tone="warn" actions={status.inline ? [["Show", () => editor.current?.api.revealConflict()]]
      : [["Keep yours", () => saver.keep("mine")], [`Keep ${theirName(status.who).replace(/^the other$/, "theirs")}`, () => saver.keep("theirs")]]}>
      {conflictText(status, editor.current && !editor.current.source ? fmLines(cur.current) : 0)}{" "}
      {status.inline ? "Your edits save once you choose what to keep." : "Both versions are kept in the note's history."}</Banner>}
    {clashes.map(({ alias, other }) => (
      <Banner key={alias} tone="warn" actions={[["Open it", () => openFile(other)],
        changeable && ["Remove the alias", () => { const rest = aliasesOf(props).filter((a) => a !== alias); setProperty("aliases", rest.length ? rest : undefined) }]]}>
        [[{alias}]] goes to {stem(other)}, which also goes by {alias}, not to this file.
      </Banner>
    ))}
    {leftover && <Banner tone="warn" actions={[["Restore them", () => restoreUnsaved(leftover)], ["Discard", () => discardUnsaved(leftover)]]}>
      Edits from {fmtAgo(leftover.t)} weren't saved before the app closed.</Banner>}
    {strict && badJson && <Banner tone="warn">Invalid JSON (saved as it is): {badJson}</Banner>}
    {status.kind === "error" && <Banner tone="warn" actions={[["Try again", () => save(true)]]}>Couldn't save{status.message ? `: ${status.message}` : ""}</Banner>}
    {!!problems.length && <Banner tone="info"><Markdown inline text={problems.length === 1 ? sentence(problems[0])
      : `${problems.length} things in this file couldn't be read: ${problems.slice(0, 3).join("; ")}`} /></Banner>}
  </>
  const droppable = isMd(path) && !ro && !outside && !format && !board && !isProtected(path) && !inTrash(path)
  const drops = useRef({ attach, insertText })
  drops.current = { attach, insertText }
  useEffect(() => {
    const el = article.current
    if (!droppable || !el) return
    const host = () => editor.current?.api.view.dom.parentElement
    return addDropSink({
      el,
      owns: (o) => o === host(),
      over: (x, y) => editor.current?.api.dropMark({ x, y }),
      leave: () => editor.current?.api.dropMark(null),
      drop: (d, x, y) => {
        const { attach, insertText } = drops.current
        editor.current?.api.dropMark(null)
        if (editor.current?.api.drop(d, { x, y })) return
        void attach(d).then((text) => { if (text) insertText(text) })
      },
    })
  }, [droppable])
  const outsideMenu = outside ? (e: MouseEvent) => {
    if (!(e.target as Element).closest(".cm-content, input, textarea")) menuFor(() => [copyToVaultItem(path), ...revealItem(path, true)])(e)
  } : undefined
  if (fills && drawing) return <PaneFile path={path} kind={kind} bar={pathBar("mb-0")} toggle={phoneToggle} notices={notices} onContextMenu={outsideMenu}>{drawing}</PaneFile>

  const fileArticle = (
    <article ref={article} className={cn("file-view", pane && "pb-24", column && "mx-auto", column && (wide || code || notebook || format ? "max-w-[1040px]" : readable && "max-w-(--line-width)"))} data-path={path} data-kind={kind}
      data-grid={editGrid ? "" : undefined}
      onContextMenu={outsideMenu}
      style={zoom && readable ? { maxWidth: `calc(var(--line-width) * ${zoom})` } : undefined}>
      {pathBar()}
      {phoneToggle}
      <div style={zoom ? { zoom } : undefined} data-text-size={zoom ? "note" : undefined}>
        {!page && (!pane || phoneTab) && (
          <TitleLine icon={view?.icon ?? Folder} tint={view?.tint} text={folderLine(path)} head={fileHead} pane={pane}
            toggle={!pane && !ro && views.length > 1 && <ViewToggle mode={shown} setMode={setMode} edit={edit} views={views} phone="sheet" />} />
        )}
        {!page && !(code && pane && !phoneTab) && (titled ? (
          <TitleRow icon={props.icon} tint={props.tint} phone={phoneTab}
            onIcon={changeable && iconChangeable(path) ? () => changeIcon(path, (n) => setProperty("icon", n)) : undefined}>
            <Title path={path} editable={shown !== "read" && !ro && !isProtected(path) && !outside} sheet={!pane} focus={fresh} settle={settle}
              mode={shown} onEnter={toText} />
          </TitleRow>
        ) : <h1 className="sr-only">{stem(path)}</h1>)}
        {notices}
        <div className={cn(!page && "mt-4")}>
          {showProps && <Properties path={path} block={fm} readOnly={ro || shown === "read"} onChange={setProps} types={store.propertyTypes} stamps={kindStamps(store, path)} />}
          {isMd(path) && !source && !drawing && <NoteTop head={fileHead} place={pane ? "page" : "sheet"} />}
          {board && pageView ? pageView.render(pageCtx) : <Suspense fallback={<div className="min-h-40" />}>
            {drawing ? framed(layout, pane, drawing) : notebook && !source ? (
              <Notebook text={cur.current.body} />
            ) : json && !source ? (
              <JsonView text={cur.current.body} editable={shown === "live" && !ro}
                onChange={(text) => { cur.current = { fm: "", body: text }; redraw(); changed() }} />
            ) : (
              <Editor key={source ? `${path}:source` : `${path}:text${fmText ? ":fm" : ""}`} doc={full()} keep={path} config={config} {...wiring} label={stem(path)}
                docPath={isMd(path) ? path : undefined} onAttach={outside ? undefined : attach}
                {...(source ? { editable: !ro, source: true, numbered: true, code: strict ? "json" : format?.code, language: code ? path : format?.source ? `source.${format.source}` : undefined }
                  : { frontmatter: !fmText, title: titled && !page ? stem(path) : undefined, editable: shown === "live" && !ro, placeholderText: shown === "read" ? "" : "Start writing", numbered: shown !== "read",
                    onUndoFrontmatter: () => revealProps(article.current) })}
                onReady={(api) => {
                  const me = { api, source }
                  editor.current = me
                  ready(api, source); saver.reshow(); if (kept?.write) toText()
                  return () => { if (editor.current === me) editor.current = null }
                }}
                onChange={(text, start, remote) => typed(text, source || fmText ? null : start, remote)} />
            )}
          </Suspense>}
        </div>
      </div>
    </article>
  )
  return fills ? <PaneScroll>{fileArticle}</PaneScroll> : fileArticle
}

function PaneFile({ path, kind, bar, toggle, notices, children, onContextMenu }: { path: string; kind: FileKind; bar: ReactNode; toggle: ReactNode; notices: ReactNode; children: ReactNode
  onContextMenu?: (e: MouseEvent) => void }) {
  return (
    <article className={cn("file-view flex flex-col", isDesktop() ? "h-full" : "phone-fill -mx-4")} data-path={path} data-kind={kind} data-layout="pane" onContextMenu={onContextMenu}>
      {bar && <div className="shrink-0 px-8">{bar}</div>}
      {toggle}
      <div className="shrink-0 px-4 empty:hidden md:px-8">{notices}</div>
      <div className={cn("relative min-h-0 flex-1", bar && "border-t-[0.5px] border-border")} data-format-pane>
        <FormatGuard>{children}</FormatGuard>
      </div>
    </article>
  )
}

function PaneScroll({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
      <div data-page className="mx-auto max-w-none px-8 pb-6">{children}</div>
    </div>
  )
}

function InTrash({ path, note = "" }: { path: string; note?: string }) {
  return (
    <Banner tone="info" icon={Trash2} actions={[["Restore", () => restoreFile(path).catch((e) => notifyError(e, "Couldn't restore"))]]}>
      In the trash.{note}
    </Banner>
  )
}

const sentence = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

const NOT_TEXT = /isn't text'?$|too big to open as text$/
