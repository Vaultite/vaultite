// A file, opened: title (rename), properties and the live-preview editor; saves as you type and
// merges changes made on disk meanwhile. Pages, plugin formats, media and outside-the-vault files each have their view.
import { Fragment, lazy, memo, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent, type ReactNode } from "react"
import { createPortal } from "react-dom"
import { AlertTriangle, BookOpen, Folder, FolderInput, Smile, Trash2, type LucideIcon } from "lucide-react"
import { menuFor } from "@/components/ContextMenu"
import { copyToVault, copyToVaultItem, revealItem } from "@/components/FileActions"
import { mediaItems } from "@/components/EmbedMenu"
import { typingIn, useCommandKeys, useCommands } from "@/core/commands"
import { dropActiveFile, setActiveFile, type ActiveFile } from "@/core/active"
import { askMove, revealInTree } from "@/components/FileTree"
import { type Store } from "@/core/data"
import { isOutside } from "@/core/desktop"
import { useVaultChange } from "@/core/live"
import { followLink } from "@/core/links"
import { drawEmbed, island, linkKind, useVaultEditing } from "@/components/editing"
import { cleanName, folderOf, gone, inPagesDir, inTrash, isHidden, isJson, isMd, isProtected, isReadOnly, joinFm, joinPath, moveFile, onSettle, openFile, readFile, restoreFile, splitFm, stem, takeNew, type FileText } from "@/core/files"
import { isDesktop, takeRename } from "@/core/workspace"
import { formatSize, isMedia, kindOf, type FileKind } from "@/core/filekinds"
import { FileCard, ImageView, PdfView, PlayerView, rawUrl, useFileInfo } from "@/components/FileViewers"
import { assetUrl, imageActions } from "@/components/editing"
import { readProps, setProp } from "@/core/frontmatter"
import { changeIcon } from "@/components/FileActions"
import { renderMarkdown } from "@/core/markdown"
import { notifyError } from "@/core/notify"
import { blockFor, fileBarItems, fileFormatFor, noteTopItems, fileViewFor, fillsPane, formatFor, timelineKinds, usePluginsVersion, type FileCtx, type PageCtx } from "@/core/plugins"
import type { FileFormat, FileHead } from "@/core/define"
import { headOf } from "@/core/pages"
import { FormatBox, FormatGuard } from "@/components/FormatView"
import { Catch, Drawn, Guard } from "@/components/Guard"
import { TimelineSection } from "@/components/Timeline"
import { usePane } from "@/core/pane"
import { usePrefs } from "@/core/prefs"
import { useTextSize, useTextSizeWheel } from "@/core/textsize"
import { BlockView, kindStamps, useKindBlocks, useKindSections } from "@/components/Blocks"
import { openBlockMenu } from "@/components/BlockSource"
import { optionNotes, parseOptions } from "../../../core/blocks.ts"
import { Properties } from "@/components/Properties"
import { PageTabs } from "@/components/PageTabs"
import { effectiveType } from "../../../core/fileprops.ts"
import { JsonView } from "@/components/JsonView"
import { barButton, ViewBar } from "@/components/ViewBar"
import { usePortalHost } from "@/components/kit"
import { useHeldFocus } from "@/core/focus"
import { useEditAt } from "@/core/anchors"
import { useAutosave, type SaveStatus } from "@/core/autosave"
import { trace } from "@/core/trace"
import { addRestore, afterPlaced, cursorOf, hideUntilPlaced, keepCursor, offerPlace, readPlace, takeRestore } from "@/core/viewstate"
import { cn } from "@/lib/utils"
import { haptic } from "@/core/haptics"
import type { EditorApi } from "@/editor/Editor"
import { Editor } from "@/editor/lazy"
import type { PreviewConfig } from "@/editor/livePreview"

import { beforeMode, CODE_VIEWS, editMode, MODES, SOURCE_VIEWS, useMode, usePublish, VIEWS, type Mode } from "@/components/fileState"
import { fmLines, keepPlace, lineAtTop, partLineAt, revealProps, spotOf, useTextFocus, type Spot } from "@/components/filePlace"

// The editor is its own chunk (editor/lazy.ts: one chunk for FileView and the editors in a canvas's cards).
const Notebook = lazy(() => import("@/editor/Notebook"))

/** A file's `aliases`, as a list. */
const aliasesOf = (fm: Record<string, unknown>) => (Array.isArray(fm.aliases) ? fm.aliases : fm.aliases ? [fm.aliases] : []).map(String).filter((a) => a.trim())

/** While it's drawn (a rename field), the keyboard is held: renamed or not, it goes back where it was (core/focus.ts). */
function HeldFocus() { useHeldFocus(); return null }

/** Last text seen per file, so reopening one shows it at once (then refreshes). */
const seen = new Map<string, FileText>()

/** A file renamed from its title while editing, so its view at the new path (a new mount) keeps editing and takes the
 *  cursor: New note, type its name, Enter, write. */
let renamed: { path: string; mode: Mode; write: boolean } | null = null
const takeRenamed = (path: string) => { const r = renamed?.path === path ? renamed : null; if (r) renamed = null; return r }

const Title = memo(function Title({ path, editable, sheet, focus, settle, mode, onEnter }: { path: string; editable: boolean; sheet: boolean; focus: boolean
  /** Save what's typed before the file moves. */
  settle: () => Promise<void>
  /** The view it's in (a rename keeps it). */
  mode?: Mode
  /** Enter: on to the text (when the name didn't change; a rename does it in the file's new view). */
  onEnter?: () => void }) {
  const name = stem(path)
  const [v, setV] = useState(name)
  const ref = useRef<HTMLTextAreaElement>(null)
  const enter = useRef(false)
  useEffect(() => { if (focus && editable) { ref.current?.focus(); ref.current?.select() } }, [focus, editable])
  useEffect(() => setV(name), [name])
  const fit = () => { const t = ref.current; if (t) { t.style.height = "0"; t.style.height = `${t.scrollHeight}px` } }
  useEffect(fit, [v, editable])
  // Its pane can get narrower or wider without the window changing (a split, a divider dragged).
  useEffect(() => {
    const t = ref.current
    if (!t) return
    let w = t.offsetWidth
    const ro = new ResizeObserver(() => { if (t.offsetWidth !== w) { w = t.offsetWidth; fit() } })
    ro.observe(t)
    return () => ro.disconnect()
  }, [editable])
  // A phone's title is a size down: the header names the file too.
  const cls = "block w-full text-[24px] leading-[30px] font-bold text-balance break-words md:text-[28px] md:leading-[34px]"
  if (!editable) return <h1 id={sheet ? "sheet-title" : undefined} className={cls}>{name}</h1>
  // Naming a note just made (its title selected) isn't a rename to undo: no toast.
  const commit = () => {
    const write = enter.current
    enter.current = false
    rename(path, v, settle, !focus, mode && { mode, write }).then((ok) => { if (!ok) { setV(name); if (write) onEnter?.() } })
  }
  return (
    <textarea ref={ref} id={sheet ? "sheet-title" : undefined} value={v} rows={1} spellCheck={false} aria-label="File name"
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); enter.current = true; (e.target as HTMLTextAreaElement).blur() }
        if (e.key === "Escape") { setV(name); (e.target as HTMLTextAreaElement).blur() }
      }}
      className={cn(cls, "resize-none overflow-hidden bg-transparent outline-none placeholder:text-muted-foreground")} />
  )
})

/** Rename a file to what was typed (cleaned of characters names can't have). False if it stayed as it was. */
async function rename(path: string, typed: string, settle: () => Promise<void>, undo = true, after?: { mode: Mode; write: boolean }) {
  const next = cleanName(typed)
  if (!next || next === stem(path)) return false
  const ext = path.split("/").pop()!.slice(stem(path).length)  // (.md, a page's .html or .csv; other files show theirs in the name)
  const to = joinPath(folderOf(path), next + ext)
  try {
    await settle()
    if (after) renamed = { path: to, ...after }  // before the move: its tab follows it (a new mount) while it finishes
    const had = seen.get(path)
    if (had) seen.set(to, { ...had, path: to })  // which shows the text at once, not a blank while it loads
    const r = await moveFile(path, to, { undo })
    if (after && r.path !== to) renamed = { path: r.path, ...after }
    return true
  }
  catch (e) { notifyError(e, "Couldn't rename"); return false }
}

/** Desktop: the bar on top of a file. Where it is (each folder finds itself in the tree; the name renames the file
 *  when clicked), and one button showing the view, which switches between reading and editing. */
const PathBar = memo(function PathBar({ path, mode, setMode, edit, settle, locked, head, className }: { path: string; settle: () => Promise<void>
  /** The file as plugins' items in the bar get it (FileBarItem); none: they draw nothing. */
  head?: FileHead
  /** The bar's own classes (a pane-filling file: no room under it, its drawing starts right there). */
  className?: string
  /** The view, and the editing view it switches to; none (an image, code): no view button. */
  mode?: Mode; setMode?: (m: Mode) => void; edit?: Mode
  /** Can't be renamed (read-only). */
  locked: boolean }) {
  const outside = isOutside(path)
  // (a page in the app's pages folder shows as a page of its own: that folder isn't the user's)
  const folders = folderOf(path) && !outside && !inPagesDir(path) ? folderOf(path).split("/") : []
  const name = stem(path)
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(name)
  useEffect(() => setV(name), [name])
  // Rename from the tab menu.
  useEffect(() => {
    const check = () => { if (takeRename(path)) setEditing(true) }
    check()
    addEventListener("vaultite:rename", check)
    return () => removeEventListener("vaultite:rename", check)
  }, [path])
  const crumb = "h-6 min-w-0 cursor-pointer truncate rounded-[4px] px-1 leading-6 hover:bg-foreground/[0.06]"
  const view = mode && setMode && edit && <ViewToggle mode={mode} setMode={setMode} edit={edit} />
  return (
    <ViewBar right={<>
      {head && <FileBar head={head} place="bar" />}{view}
      {outside && (
        <button type="button" onClick={() => copyToVault(path)} aria-label="Copy to vault" data-tip="Copy to vault" className={barButton}>
          <FolderInput className="size-4" strokeWidth={2} />
        </button>
      )}
    </>} className={className}>
      <nav aria-label="File path" className="flex min-w-0 flex-1 items-center">
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
              <button type="button" onClick={() => revealInTree(at, { open: true, scroll: true, flash: true })}
                data-tip="Show in the file tree" className={cn(crumb, "shrink-[1000] text-muted-foreground hover:text-foreground")}>{f}</button>
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

/** What plugins draw in a file's header (FileBarItem): in the desktop path bar (`bar`), or at the end of the line above
 *  the title in a sheet or on a phone (`line`). */
function FileBar({ head, place }: { head: FileHead; place: "bar" | "line" }) {
  const { disabled, order, enabled } = usePrefs()
  const plugins = usePluginsVersion() // (a vault plugin's code arriving)
  const items = useMemo(() => fileBarItems(disabled, order), [disabled, order, enabled, plugins])
  const ctx = useMemo(() => ({ ...head, place }), [head, place])
  // (one that throws is left out, its error in Errors: it's in every file's header)
  return <>{items.map(({ key, item }) => <Catch key={key} reset={head.path} fallback={() => null}><Drawn draw={() => item.render(ctx)} /></Catch>)}</>
}

/** What plugins draw at the top of a note (NoteTopItem), under its properties. */
function NoteTop({ head }: { head: FileHead }) {
  const { disabled, order, enabled } = usePrefs()
  const plugins = usePluginsVersion()
  const items = useMemo(() => noteTopItems(disabled, order), [disabled, order, enabled, plugins])
  return <>{items.map(({ key, item }) => <Guard key={key} what="This part" reset={head.path}><Drawn draw={() => item.render(head)} /></Guard>)}</>
}

/** The view button (⌘E): reading <-> editing, showing what a tap does. Small in the desktop path bar, 44pt on phones
 *  in the sheet's or the phone's header. */
const ViewToggle = memo(function ViewToggle({ mode, setMode, edit, phone }: { mode: Mode; setMode: (m: Mode) => void; edit: Mode; phone?: "sheet" | "header" }) {
  const host = usePortalHost(phone ? (phone === "sheet" ? "sheet-actions" : "phone-actions") : null)
  const toggleKeys = useCommandKeys("view:toggle", true)
  const reading = mode === "read"
  // It shows what a click does: a pencil while reading, a book while editing.
  const Icon = MODES[reading ? "live" : "read"].icon
  const label = reading ? "Edit" : "Read"
  if (!phone) {
    return (
      <button type="button" onClick={() => setMode(reading ? edit : "read")} aria-label={label}
        data-tip={`Current view: ${MODES[mode].label}\n${reading ? "Click to edit" : "Click to read"}${toggleKeys}`} className={barButton}>
        <Icon className="size-4" strokeWidth={2} />
      </button>
    )
  }
  const button = (
    <button type="button" data-view-toggle={mode} onClick={() => { haptic(); setMode(reading ? edit : "read") }} aria-label={label} aria-pressed={!reading}
      className="grid size-11 shrink-0 cursor-pointer place-items-center text-primary active:opacity-50">
      <Icon className="size-[21px]" strokeWidth={2} />
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
    readFile(path).then((f) => { if (on) { seen.set(path, f); setFile(f) } })
      .catch((e) => on && setFile((cur) => (NOT_TEXT.test(String(e)) ? (/too big/.test(String(e)) ? "big" : "binary")
        : cur && typeof cur === "object" && !gone(e) ? cur : "missing")))
    return () => { on = false }
  }, [path, tries])
  // Not there: open it as soon as it's made (or moved back) on disk. An open file follows its own changes (Loaded).
  useVaultChange(() => { if (typeof file === "string") setTries((n) => n + 1) }, [path])
  // (a file that fills its pane, not read as its drawing: padded like any file)
  const { disabled } = usePrefs()
  const padded = (node: ReactNode) => (pane && fillsPane(path, disabled) ? <PaneScroll>{node}</PaneScroll> : node)
  if (file === "missing") return padded(<Missing path={path} pane={pane} />)
  // Not text after all (a binary file with a name like text), or too big to read as text: a card.
  if (file === "binary" || file === "big") return padded(<MediaFile store={store} path={path} pane={pane} kind="binary" note={file === "big" ? "Too big to open here." : undefined} />)
  if (!file) return <div className="min-h-[50vh]" aria-busy />
  return <Loaded key={path} store={store} initial={file} pane={pane} onGone={() => setFile("missing")} />
}

/** A file that isn't text: a viewer, a plugin's `binary` format, else a card; with the bar and status bar on desktop,
 *  its name in the sheet. */
function MediaFile({ store, path, pane, kind, note }: { store: Store; path: string; pane: boolean; kind: FileKind; note?: string }) {
  const [info, v, missing] = useFileInfo(path)
  const { disabled } = usePrefs()
  const format = kind === "binary" && !isHidden(path) && !note ? formatFor(path, disabled)?.format ?? null : null
  const drawn = format?.binary ? format : null
  const [extra, setExtra] = useState<string | null>(null)
  const { focused } = usePane()
  const live = pane && focused
  const facts = useMemo(() => [extra, info?.pages ? `${info.pages} page${info.pages === 1 ? "" : "s"}` : null, info ? formatSize(info.size) : null]
    .filter((x): x is string => !!x), [extra, info])
  const noop = useCallback(() => {}, [])
  // What plugins' items in its header and the status bar get: no frontmatter to change (Provenance keeps its own).
  const head = useMemo<FileHead>(() => ({ path, fm: {}, type: null }), [path])
  usePublish(live, () => ({ path, mode: "read", setMode: noop, body: "", views: [], info: facts, head }), [path, facts, noop, head])
  useCommands(() => (live && !isReadOnly(path) && !isOutside(path) ? [{ id: "file:move", name: "Move current file to another folder", run: () => askMove(path), icon: FolderInput }] : []), [live, path])
  if (missing) return <Missing path={path} pane={pane} />
  const folder = folderOf(path)
  const settle = async () => {}
  const duration = (secs: number) => {
    if (!Number.isFinite(secs)) return
    const t = Math.round(secs), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = String(t % 60).padStart(2, "0")
    setExtra(h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`)
  }
  // Right-click it (the image, around it): its menu, unless what's drawn answered first (a plugin's own menu).
  const onMenu = (e: MouseEvent) => {
    if (e.defaultPrevented || (e.target as Element).closest("input, textarea, [contenteditable]")) return
    menuFor(() => mediaItems(path, isOutside(path), isReadOnly(path) || isProtected(path) || inTrash(path)))(e)
  }
  return (
    <article className={cn("file-view", pane && "mx-auto max-w-[1040px] pb-24")} data-path={path} data-kind={kind} onContextMenu={onMenu}>
      {pane && isDesktop() && <PathBar path={path} settle={settle} locked={isReadOnly(path) || isProtected(path) || isOutside(path)} head={head} />}
      {(!pane || !isDesktop()) && (
        <>
          <div className={cn("mb-1 flex min-h-8 items-center gap-2", !pane && "pr-[31px]")}>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-semibold text-muted-foreground">
              <Folder className="size-[18px] shrink-0" strokeWidth={2.25} />
              <span className="truncate">{folder ? folder.split("/").join(" / ") : "Vault"}</span>
            </span>
            <FileBar head={head} place="line" />
          </div>
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

/** A file a plugin draws from its bytes (a `binary` format): in a box as tall as what's left of the pane, or inline
 *  (its `layout`), redrawn from a new address when the file changes (`v`). */
function BinaryFormat({ store, format, path, v, pane }: { store: Store; format: FileFormat; path: string; v: number; pane: boolean }) {
  const ctx = { store, path, text: "", url: rawUrl(path, { v }), editable: false, place: pane ? "page" as const : "sheet" as const, onChange: () => {} }
  const layout = format.layout ?? "box"
  if (layout === "box" || layout === "pane") return <FormatBox place={pane ? "page" : "sheet"}>{format.render(ctx)}</FormatBox>
  return <FormatGuard>{format.render(ctx)}</FormatGuard>
}

/** A file that's gone (deleted or moved while open, or a stale link): laid out like the file was, so the tab doesn't
 *  jump; on desktop under the path bar (back and forward still work there), not renameable. */
function Missing({ path, pane }: { path: string; pane: boolean }) {
  const bar = pane && isDesktop()
  return (
    <article className={cn("file-view", pane && "mx-auto max-w-(--line-width) pb-24", !bar && "py-10")} data-path={path}>
      {bar && <PathBar path={path} settle={async () => {}} locked />}
      <h1 className="text-[24px] leading-[30px] font-bold break-words md:text-[28px] md:leading-[34px]">{stem(path)}</h1>
      <p className="mt-2 text-[15px] text-muted-foreground">This file isn't in the vault any more. It may have been renamed or deleted.</p>
    </article>
  )
}

function Loaded({ store, initial, pane, onGone }: { store: Store; initial: FileText; pane: boolean; onGone: () => void }) {
  const path = initial.path
  const [saved, setSaved] = useMode()
  // A note just made with New note opens in editing, with its name selected.
  const [fresh] = useState(() => takeNew(path))
  // Just renamed from its title: still editing (and on to the text if Enter did it).
  const [kept] = useState(() => takeRenamed(path))
  const [override, setOverride] = useState<Mode | null>(fresh ? "live" : kept?.mode ?? null)
  const first = splitFm(initial.text)
  const [fm, setFm] = useState(first.fm)
  const { disabled } = usePrefs()
  const { props } = useMemo(() => readProps(fm), [fm])
  // Its type, the core's one rule (core/fileprops.ts): its kind's when a kind owns it (the server's row says), else the
  // frontmatter being edited (typing `type: dashboard` shows it at once).
  const files = store.files.files
  const row = useMemo(() => files.find((f) => f.path === path), [files, path])
  const type = effectiveType(row?.kind ? row.type : null, props)
  const pv = isHidden(path) || !isMd(path) ? null : fileViewFor({ path, type }, disabled)
  const view = pv?.view
  // A file a plugin draws as a page (a dashboard: FileView.page) opens in reading; editing one doesn't change how
  // other files open.
  const pageView = view?.page ?? null
  const dash = !!pageView
  // A plugin's drawing opens editing on desktop; formats whose editing is their source (a table, an HTML page) and
  // notebooks open drawn. Code and other text is only its source.
  const kind = kindOf(path)
  const outside = isOutside(path)
  usePluginsVersion() // (a plugin taking this file as it comes)
  const taken = isHidden(path) || !isMd(path) || outside ? null : fileFormatFor(path, disabled)
  const drawer = isHidden(path) ? null : taken ?? formatFor(path, disabled)?.format ?? null
  // (one that runs from the vault, opened from outside it, is its text)
  const format = drawer && !(outside && drawer.vaultOnly) ? drawer : null
  const notebook = kind === "notebook"
  // Drawn for reading, edited as source.
  const readOnlyDrawn = format?.edit === "source" || notebook
  // (a drawing whose plugin is off is JSON text: code)
  const code = !format && (kind === "code" || kind === "other" || (kind === "json" && !isJson(path)))
  const drawn = dash || readOnlyDrawn
  const mode = override ?? (drawn ? "read" : format ? (isDesktop() ? "live" : "read") : saved)
  const pick = useCallback((m: Mode) => { if (drawn || code || format) { setOverride(m); return } setOverride(null); setSaved(m) }, [setSaved, drawn, code, format])
  // Hidden files are nobody's notes, so no plugin draws them; the trash and the app's generated copies can be read, not
  // changed.
  const json = isJson(path), hidden = isHidden(path), ro = isReadOnly(path)
  // Their editing is their source: no live preview to pick (it would only glitch into source).
  const shown: Mode = code ? "source" : readOnlyDrawn && mode === "live" ? "source" : mode
  const views = code ? CODE_VIEWS : readOnlyDrawn ? SOURCE_VIEWS : VIEWS
  const edit: Mode = code || readOnlyDrawn ? "source" : format ? "live" : editMode()
  // Plugins read their settings from JSON files, and a notebook must stay one: saved only while it parses.
  const strict = json || notebook || !!format?.json
  const [body, setBody] = useState(first.body)
  const [status, setStatus] = useState<SaveStatus>({ kind: "ok" })
  const [problems, setProblems] = useState(initial.problems)
  const cur = useRef({ fm: first.fm, body: first.body })
  const full = () => joinFm(cur.current.fm, cur.current.body)
  const editor = useRef<{ api: EditorApi; source: boolean } | null>(null)
  /** The cursor at the end of the text (Enter in the title). */
  const toText = () => {
    const v = editor.current?.api.view
    if (!v || v.state.readOnly) return
    v.dispatch({ selection: { anchor: v.state.doc.length }, scrollIntoView: true })
    v.focus()
  }
  // A change of view (⌘E, the status bar) keeps the reader where they were (keepPlace).
  const article = useRef<HTMLElement>(null)
  const spot = useRef<Spot | null>(null)
  const shownNow = useRef(shown)
  shownNow.current = shown
  const { focused } = usePane()
  const noteSpot = () => { spot.current = spotOf(article.current, editor.current?.api ?? null, fmLines(cur.current)) }
  const keepAt = () => {
    const v = editor.current?.api.view
    if (!v?.dom.isConnected || v.contentDOM.contentEditable !== "true") return
    const above = fmLines(cur.current)
    const head = v.state.selection.main.head, line = v.state.doc.lineAt(head)
    keepCursor(path, line.number - 1 - above, head - line.from)
  }
  // Switched to editing from here (⌘E, the view button, the status bar): the cursor goes back where it was if that's in
  // sight, else where you're reading.
  const intoText = useRef(false)
  const setMode = useCallback((m: Mode) => {
    if (m !== shownNow.current) {
      noteSpot()
      // (the cursor kept now: a dashboard's editor goes away while its grid is read, and comes back to it)
      if (editor.current?.api.view.hasFocus) keepAt()
      trace("editor", { ev: "view", path, from: shownNow.current, to: m, at: cursorOf(path) })
      intoText.current = m !== "read"
      // Back to reading: the keys are the app's again (j and k scroll, with Vim).
      if (m === "read" && article.current?.contains(document.activeElement)) (document.activeElement as HTMLElement).blur()
    }
    pick(m)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pick])
  // The new view is hidden until it's at the place (a few frames; 400 ms at most), so it isn't seen getting there;
  // `landed` once it's there (the cursor goes into the text then, where the reader is).
  const placing = useRef<{ s: Spot; stop: (() => void) | null; landed?: () => void } | null>(null)
  const placeAt = (s: Spot, ed: { api: EditorApi; source: boolean } | null, landed?: () => void) => {
    const art = article.current
    if (art) art.style.visibility = "hidden"
    let once = false
    const show = () => { clearTimeout(late); if (art) art.style.visibility = ""; if (!once) { once = true; landed?.() } }
    const late = setTimeout(show, 400)
    return keepPlace(s, ed?.api ?? null, fmLines(cur.current), art, show, show)
  }
  // Switched from another pane (one mode for every file): this one keeps its place too.
  const follows = override === null && !drawn && !code && !format
  const followsNow = useRef(follows)
  followsNow.current = follows
  useEffect(() => {
    const before = (m: Mode) => { if (followsNow.current && m !== shownNow.current && !spot.current) noteSpot() }
    beforeMode.add(before)
    return () => { beforeMode.delete(before) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const canFocus = !ro && !hidden && isDesktop() && !(format && shown !== "source")
  const focusText = useTextFocus(editor, article, shownNow, cur)
  // A block's "Edit source" (editAt in core/anchors.ts): into editing, the cursor on that line of the file, scrolled to.
  const revealing = useRef(false)
  const toLine = useCallback((line: number) => {
    if (ro || hidden) return
    if (shownNow.current === "read") { revealing.current = true; pick(edit) }
    focusText([Math.max(0, line - fmLines(cur.current)), 0], true)
  }, [ro, hidden, pick, edit, focusText])
  const articleEl = useCallback(() => article.current, [])
  useEditAt(path, articleEl, toLine)
  // A block's "This file's properties" while reading: into editing, where they are.
  useEffect(() => {
    const on = (e: Event) => { if ((e as CustomEvent).detail === path && !ro && !hidden && shownNow.current === "read") pick(edit) }
    addEventListener("vau:properties", on)
    return () => removeEventListener("vau:properties", on)
  }, [path, ro, hidden, pick, edit])
  useLayoutEffect(() => {
    // (going to a line: the place being read isn't kept)
    if (revealing.current) { revealing.current = false; spot.current = null }
    const s = spot.current
    spot.current = null
    const into = intoText.current && canFocus && shown !== "read"
    intoText.current = false
    let stopFocus: (() => void) | undefined
    const landed = into ? () => { trace("editor", { ev: "land", path, at: cursorOf(path) }); stopFocus = focusText(cursorOf(path)) } : undefined
    if (!s) { landed?.(); return () => stopFocus?.() }
    const ed = editor.current?.api.view.dom.isConnected ? editor.current : null
    // The new view is an editor not made yet: it finds the place
    // once ready (onReady), hidden until then (800 ms at most), or by how far down if none comes after a few seconds.
    const coming = !ed && !board && !drawing && !(notebook && !source) && !(json && !source)
    if (!coming) {
      const stopPlace = placeAt(s, ed, landed)
      return () => { stopPlace(); stopFocus?.() }
    }
    const p: { s: Spot; stop: (() => void) | null; landed?: () => void } = { s, stop: null, landed }
    placing.current = p
    const art = article.current
    if (art) art.style.visibility = "hidden"
    // (shown after a moment even so; by how far down it was if no editor has come after a few seconds)
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown])
  /** An editor came: the place a change of view is waiting for (above), or where its tab was left (core/viewstate.ts). */
  const ready = (api: EditorApi, source: boolean) => {
    const p = placing.current
    if (p) { placing.current = null; p.stop = placeAt(p.s, { api, source }, p.landed); return }
    resume(api)
  }
  // Where a tab's file was left is its line too (core/viewstate.ts): said with each scroll of its tab, and found again
  // when it's drawn anew (opened again in its tab, the app reloaded), once its editor is ready to say where lines are.
  useEffect(() => {
    if (!pane || !article.current) return
    const box = article.current.closest<HTMLElement>("[data-pane], [data-kept], [data-stacked]")
    if (!box && isDesktop()) return
    return readPlace(box, () => {
      const ed = editor.current
      const top = box ? box.getBoundingClientRect().top : 0
      if (ed?.api.view.dom.isConnected) return lineAtTop(ed.api.view, top, fmLines(cur.current))
      // (a drawn page whose parts say their lines: a dashboard's cards)
      return article.current ? partLineAt(article.current, top) : null
    })
  }, [pane, path])
  // A dashboard's grid drawn while its place is being found: its card found again, as an editor finds its line.
  const grid = dash && shown === "read"
  useLayoutEffect(() => {
    const art = article.current
    if (!pane || !grid || !art?.querySelector("[data-line]")) return
    return offerPlace(`file:${path}`, () => {
      const r = takeRestore(`file:${path}`)
      if (!r) return
      let drop = () => {}
      const stop = keepPlace({ box: r.box, y: 0, ratio: 0, line: r.line, into: r.into }, null, 0, art, () => { drop(); r.show() }, r.show)
      drop = addRestore(stop)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pane, grid, path])
  // (a file drawn while its place is being found, the app reloaded on a phone: not seen before it's there)
  useLayoutEffect(() => { if (pane) hideUntilPlaced(`file:${path}`, article.current) }, [pane, path])
  const resume = (api: EditorApi) => {
    const r = pane ? takeRestore(`file:${path}`) : null
    if (!r) return
    let drop = () => {}
    const stop = keepPlace({ box: r.box, y: 0, ratio: 0, line: r.line, into: r.into, text: true }, api, fmLines(cur.current), article.current,
      () => { drop(); r.show() }, r.show)
    drop = addRestore(stop)
  }
  // Opened in editing in the focused pane: the cursor goes where it was left once
  // the place is found, unless the keys are being typed elsewhere (`vau open` from a terminal mustn't take its keys).
  useEffect(() => {
    if (!pane || !focused || fresh || kept || shown === "read" || !canFocus) return
    let stop: (() => void) | undefined
    let frame = requestAnimationFrame(() => {
      frame = requestAnimationFrame(() => {
        const a = document.activeElement
        if (a && a !== document.body && typingIn(a) && !article.current?.contains(a)) return
        let stopFocus: (() => void) | undefined
        const unwait = afterPlaced(`file:${path}`, () => { stopFocus = focusText(cursorOf(path)) })
        stop = () => { unwait(); stopFocus?.() }
      })
    })
    return () => { cancelAnimationFrame(frame); stop?.() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Where the cursor was left, for the next time the file opens and back from reading.
  useEffect(() => {
    const el = article.current
    if (!el) return
    let touched = false
    const keep = () => { if (touched) keepAt() }
    const into = (e: FocusEvent) => { if ((e.target as HTMLElement).closest?.(".cm-content")) touched = true }
    el.addEventListener("focusin", into)
    el.addEventListener("focusout", keep)
    return () => { el.removeEventListener("focusin", into); el.removeEventListener("focusout", keep); keep() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path])
  /** Show text that came from the server (merged or filled in), keeping the cursor. */
  const apply = useCallback((text: string) => {
    const { fm: f, body: b } = splitFm(text)
    // (blocks read the body when drawn: one whose own text didn't change, a review list's count, draws again)
    if (b !== cur.current.body) setVersion((v) => v + 1)
    cur.current = { fm: f, body: b }
    setFm(f)
    editor.current?.api.replace(text)
    setBody(b)
  }, [])

  const saver = useAutosave(path, initial.text, {
    text: full, apply, onStatus: setStatus, json: strict, readOnly: ro,
    onDisk: (f) => { seen.set(path, f); setProblems(f.problems ?? []) },
    onGone: () => { seen.delete(path); onGone() },
  })
  const changed = saver.changed, save = saver.save, settle = saver.settle

  /** A change the user made around the text (Properties, a header's chip, a command): through the editor, so ⌘Z
   *  undoes it like typing (without one, saved as is). */
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const editAround = useCallback((text: string) => {
    const ed = editor.current
    if (!ed?.api.view.dom.isConnected) { apply(text); changed(); return }
    ed.api.change(text)
  }, [apply])
  /** What the editor has now: its frontmatter (to `start`; source mode reads it from the text) and body. */
  const typed = useCallback((text: string, start: number | null) => {
    const s = start === null ? splitFm(text) : { fm: text.slice(0, start), body: text.slice(start) }
    cur.current = s
    setFm(s.fm)
    setBody(s.body)
    changed()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // Stable so what's drawn around the text isn't redrawn per keystroke (`editAround` only reads refs and `save`).
  const setProps = useCallback((b: string) => editAround(joinFm(b, cur.current.body)), [editAround])
  // One frontmatter key for plugins (FileHead), through the editors and autosave like typing it.
  const setProperty = useCallback((key: string, value: unknown) => {
    const { fm: f, body: b } = cur.current
    const block = setProp(f || (b.trim() ? "---\n---\n\n" : "---\n---\n"), key, value)
    if (block !== f) editAround(joinFm(block, b))
  }, [editAround])

  useEffect(() => onSettle(path, settle), [path, settle])

  // A file from outside the vault isn't watched: check it now and then.
  useEffect(() => {
    if (!outside) return
    const t = setInterval(() => document.visibilityState === "visible" && saver.check(), 5000)
    return () => clearInterval(t)
  }, [outside, saver])
  // Opened from the last text seen: the fresh read (FileView's) arrives as `initial`.
  useEffect(() => { if (initial.text !== saver.disk) void saver.check(initial) }, [initial, saver])

  const changeable = !ro && !isProtected(path) && !inTrash(path) && !outside && isMd(path)
  const ctx: FileCtx = { store, path, fm: props, body, setProperty: changeable ? setProperty : undefined }
  const ctxRef = useRef(ctx)
  ctxRef.current = ctx
  // (read when a block is drawn again: a block keeps the function that first drew it)
  const editingRef = useRef(shown === "live")
  editingRef.current = shown === "live"
  const { resolve, paste, ...wiring } = useVaultEditing(store, path, full)

  // What the editor draws itself (each with React, into the editor): blocks, its kind's sections (a person's
  // `## Timeline`), tables, [[links]].
  const [version, setVersion] = useState(0)
  const plugins = usePluginsVersion() // (a plugin's fences arriving)
  // (and when the view changes: a block's option notes show while editing only)
  useEffect(() => setVersion((v) => v + 1), [store, fm, disabled, shown, plugins])
  const kindBlocks = useKindBlocks(store, path)
  const sections = useKindSections(store, path)
  const config = useMemo<PreviewConfig>(() => ({
    live: shown !== "source",
    writable: !ro,
    kindBlocks,
    resolves: (t) => linkKind(resolve, t),
    asset: (name) => assetUrl(store, name),
    ...imageActions(store),
    sections,
    renderSection: (name, text, el) => island((t) => <TimelineSection text={t} title={name[0].toUpperCase() + name.slice(1)} kinds={timelineKinds(disabled)} path={ro || !isMd(path) ? undefined : path} />, text, el),
    renderBlock: (name, text, el, edit) => island((t) => <BlockView name={name} text={t} ctx={ctxRef.current} disabled={disabled} editing={editingRef.current} edit={edit} />, text, el),
    blockMenu: (name, text, at, edit) => openBlockMenu(at, { name, text, path, edit, showing: true }),
    blockNotes: (name, text) => {
      // (a fence a plugin draws, ```dataview, has its own language inside, not options)
      if (name.startsWith("```")) return { notes: [] }
      const { decl } = blockFor(name, disabled), { options, error } = parseOptions(text)
      return { notes: optionNotes(decl, options, error), about: decl?.description }
    },
    renderEmbed: (target, height, el, edit) => drawEmbed(store, target, height, el, path, edit),
    renderMarkdown: (md) => renderMarkdown(md, resolve),
    follow: (link, newTab) => followLink(store, link, newTab, path),
    version,
    place: path,
  }), [shown, ro, resolve, store, disabled, version, path, kindBlocks, sections])


  // ⌘E switches between reading and editing; the palette also offers each view.
  // Only the focused pane's file (splits: the other side's file is just shown).
  const live = pane && focused
  useCommands(() => (live ? [
    ...(views.length > 1 ? [{ id: "view:toggle", name: "Toggle reading view", keys: ["Mod+E"], run: () => setMode(shown === "read" ? edit : "read"), icon: BookOpen }] : []),
    ...views.filter((v) => v.value !== shown).map((v) => ({ id: `view:${v.value}`, name: `Switch to ${v.label.toLowerCase()}`, run: () => setMode(v.value), icon: MODES[v.value].icon })),
    ...(isReadOnly(path) || isOutside(path) ? [] : [{ id: "file:move", name: "Move current file to another folder", run: () => askMove(path), icon: FolderInput }]),
    ...(isReadOnly(path) || isOutside(path) || !isMd(path) ? [] : [{ id: "file:icon", name: "Change icon of current file", run: () => changeIcon(path, (n) => setProperty("icon", n)), icon: Smile }]),
  ] : []), [live, shown, setMode, path, edit, views, setProperty])

  // Text put in at the cursor while editing, else at the end (Insert template, a file dropped beside the text).
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
  // Commands that write into the file being edited (Insert template) find it here.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [writable, path, apply, editAround, settle])

  // The status bar follows the file in the active tab.
  const says = format?.status
  // What plugins' items in the header and the status bar get: a change to the frontmatter redraws them, typing doesn't.
  const fileHead = useMemo<FileHead>(() => ({ path, fm: props, type, setProperty: changeable ? setProperty : undefined }), [path, props, type, changeable, setProperty])
  usePublish(live, () => ({ path, mode: shown, setMode, body, fm, head: fileHead, views, says }), [path, shown, setMode, body, fm, fileHead, views, says])

  const folder = folderOf(path)
  const Icon = view?.icon ?? Folder
  // Source mode is the file as it is: no kicker, no Properties (the frontmatter is in the text), blocks as their text.
  const source = shown === "source"
  const kicker = source ? null : view?.kicker?.(ctx)
  const aside = kicker == null ? null : view?.aside?.(ctx)
  // Properties are for editing: reading shows the file as it reads (a person's or a project's block already shows its
  // fields), editing has them folded at the top. The same for every kind of file, in a tab, a sheet or on a phone.
  const showProps = shown !== "read" && !source && !json && !notebook && !format
  // Drawn JSON isn't an editor: merges from disk only update the text it's drawn from.
  useEffect(() => { if ((json || notebook || format) && !source) editor.current = null }, [json, notebook, format, source])

  // On desktop the bar shows where the file is, so the line above the title is only for a plugin's kicker.
  // Phones have no path bar, so a file in a tab says where it is too, like in the sheet.
  const phoneTab = pane && !isDesktop()
  const line = pane && !phoneTab ? kicker : kicker ?? (folder ? folder.split("/").join(" / ") : "Vault")
  // A file a plugin draws as a page, being read: the plugin's header in place of the title (in a sheet, under it), then
  // the page (a dashboard's grid).
  const board = dash && shown === "read"
  // A drawn file that's the whole page (an artifact) being read, in a tab: the page is all it draws (its own title
  // included), under the path bar.
  const layout = format?.layout ?? "box"
  const app = layout === "full" && shown === "read"
  const page = (board || app) && pane
  // A page's other tabs (People map) carry the page's name (People).
  const head = headOf(store.files.files, path)
  const pageCtx: PageCtx = { ...ctx, title: stem(head?.path ?? path), place: pane ? "page" : "sheet", disabled }
  // A drawn file that takes its whole pane in a tab (`layout: "pane"`: a canvas): the bar, then the drawing edge to edge.
  const fills = pane && layout === "pane"
  const pathBar = (className?: string) => pane && isDesktop() && (views.length > 1
    ? <PathBar path={path} mode={shown} setMode={setMode} edit={edit} settle={settle} locked={isReadOnly(path) || isProtected(path) || outside} head={fileHead} className={className} />
    : <PathBar path={path} settle={settle} locked={isReadOnly(path) || isProtected(path) || outside} head={fileHead} className={className} />)
  const phoneToggle = phoneTab && !ro && views.length > 1 && <ViewToggle mode={shown} setMode={setMode} edit={edit} phone="header" />
  // A note in a tab has its own text size (core/textsize.ts: ⌘+scroll over it, the commands, Settings > Appearance):
  // everything under the path bar is zoomed, and its column widens with it, so the lines keep their length.
  const note = pane && isMd(path) && !dash && !format && !json && !notebook && !code
  const size = useTextSize("note")
  useTextSizeWheel(article, note ? "note" : null)
  const zoom = note && size !== 100 ? size / 100 : 0
  const drawing = format && !source ? format.render({ store, path, text: joinFm(fm, body), editable: shown === "live" && !ro, place: pane ? "page" : "sheet",
    onChange: (text) => { if (text === full()) return; const s = splitFm(text); cur.current = s; setFm(s.fm); setBody(s.body); changed() } }) : null
  // Aliases another file has too: [[Alias]] goes to one of them only.
  const clashes = useMemo(() => {
    const own = path.replace(/\.md$/i, "")
    return aliasesOf(props).flatMap((alias) => {
      const hit = resolve(alias), to = hit ? (hit.file ?? hit.id).replace(/\.md$/i, "") : own
      return to === own ? [] : [{ alias, other: hit!.file ?? `${to}.md` }]
    })
  }, [props, resolve, path])
  const notices = <>
    {inTrash(path) && <InTrash path={path} note=" Restore it to edit it." />}
    {isReadOnly(path) && !inTrash(path) && <Banner tone="info"><span className="flex-1">The app's copy of what it last wrote, kept to merge its updates into your edits. Read-only.</span></Banner>}
    {status.kind === "conflict" && (
      <Banner tone="warn">
        <span className="flex-1">This file changed somewhere else, in the same lines you edited.</span>
        <button type="button" className="cursor-pointer font-semibold text-primary"
          onClick={saver.takeTheirs}>Use theirs</button>
        <button type="button" className="cursor-pointer font-semibold text-primary"
          onClick={saver.keepMine}>Keep mine</button>
      </Banner>
    )}
    {clashes.map(({ alias, other }) => (
      <Banner key={alias} tone="warn">
        <span className="flex-1">[[{alias}]] goes to {stem(other)}, which also goes by {alias}, not to this file.</span>
        <button type="button" className="cursor-pointer font-semibold text-primary" onClick={() => openFile(other)}>Open it</button>
        {changeable && <button type="button" className="cursor-pointer font-semibold text-primary"
          onClick={() => { const rest = aliasesOf(props).filter((a) => a !== alias); setProperty("aliases", rest.length ? rest : undefined) }}>Remove the alias</button>}
      </Banner>
    ))}
    {status.kind === "invalid" && <Banner tone="warn"><span className="flex-1">Not valid JSON, so not saved yet: {status.message}</span></Banner>}
    {status.kind === "error" && <Banner tone="warn"><span className="flex-1">Couldn't save: {status.message}</span>
      <button type="button" className="cursor-pointer font-semibold text-primary" onClick={() => save(true)}>Try again</button></Banner>}
    {!!problems.length && (
      <Banner tone="info">
        <span className="flex-1">{problems.length === 1 ? problems[0] : `${problems.length} things in this file couldn't be read: ${problems.slice(0, 3).join("; ")}`}</span>
      </Banner>
    )}
  </>
  // A file from outside the vault: right-click it (around its text, on an image) to copy it in.
  const outsideMenu = outside ? (e: MouseEvent) => {
    if (!(e.target as Element).closest(".cm-content, input, textarea")) menuFor(() => [copyToVaultItem(path), ...revealItem(path, true)])(e)
  } : undefined
  if (fills && drawing) return <PaneFile path={path} kind={kind} bar={pathBar("mb-0")} toggle={phoneToggle} notices={notices} onContextMenu={outsideMenu}>{drawing}</PaneFile>
  // Files dropped on the note where the editor doesn't take them (around the text, the reading view): attachments
  // too, not a tab outside the vault (core/desktop.ts opens what lands elsewhere).
  const droppable = isMd(path) && !ro && !outside && !format && !board && !isProtected(path) && !inTrash(path)
  const onDrop = (e: DragEvent) => {
    const files = [...e.dataTransfer.files]
    if (!files.length || (e.target as Element).closest("[data-file-drop]") !== e.currentTarget) return
    e.preventDefault()
    paste(files).then((text) => { if (text) insertText(text) })
  }

  const fileArticle = (
    <article ref={article} className={cn("file-view", pane && "mx-auto pb-24", pane && (board || code || notebook || format ? "max-w-[1040px]" : "max-w-(--line-width)"))} data-path={path} data-kind={kind}
      onContextMenu={outsideMenu} data-file-drop={droppable ? "" : undefined} onDragOver={droppable ? (e) => { if (e.dataTransfer.types.includes("Files")) e.preventDefault() } : undefined} onDrop={droppable ? onDrop : undefined}
      style={zoom ? { maxWidth: `calc(var(--line-width) * ${zoom})` } : undefined}>
      {pathBar()}
      {phoneToggle}
      <div style={zoom ? { zoom } : undefined} data-text-size={zoom ? "note" : undefined}>
        {page && board && pageView?.header?.(pageCtx)}
        {!page && (line || !pane) && !(code && pane && !phoneTab) && (
          // In a sheet its header floats over this line (DetailSheet: Close, and the view toggle left of it): the line
          // stops short of them, so what plugins put at its end (Provenance's label) is never under a button.
          <div className={cn("mb-1 flex min-h-8 items-center gap-2", !pane && (!ro && views.length > 1 ? "pr-[75px]" : "pr-[31px]"))}>
            <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[15px] font-semibold" style={{ color: view?.tint ?? "var(--muted-foreground)" }}>
              <Icon className="size-[18px] shrink-0" strokeWidth={2.25} />
              <span className="truncate">{line}</span>
            </span>
            {aside != null && <span className="shrink-0 text-[13px] text-muted-foreground">{aside}</span>}
            {(!pane || phoneTab) && <FileBar head={fileHead} place="line" />}
            {!pane && !ro && views.length > 1 && <ViewToggle mode={shown} setMode={setMode} edit={edit} phone="sheet" />}
          </div>
        )}
        {!page && !(code && pane && !phoneTab) && <Title path={path} editable={shown !== "read" && !ro && !isProtected(path) && !outside} sheet={!pane} focus={fresh} settle={settle}
          mode={shown} onEnter={toText} />}
        {board && !pane && pageView?.header?.(pageCtx)}
        {!source && <PageTabs store={store} path={path} pane={pane} className={page ? "-mt-1 mb-5" : "mt-3"} />}
        {notices}
        <div className={cn(!page && "mt-4")}>
          {showProps && <Properties path={path} block={fm} readOnly={ro} onChange={setProps} types={store.propertyTypes} stamps={kindStamps(store, path)} />}
          {isMd(path) && !source && !board && !drawing && <NoteTop head={fileHead} />}
          {board && pageView ? pageView.render(pageCtx) : <Suspense fallback={<div className="min-h-40" />}>
            {drawing ? (
              layout === "box" || layout === "pane" ? <FormatBox place={pane ? "page" : "sheet"}>{drawing}</FormatBox> : <FormatGuard>{drawing}</FormatGuard>
            ) : notebook && !source ? (
              <Notebook text={body} />
            ) : json && !source ? (
              <JsonView text={body} editable={shown === "live" && !ro}
                onChange={(text) => { cur.current = { fm: "", body: text }; setBody(text); changed() }} />
            ) : source ? (
              <Editor key={`${path}:source`} doc={full()} editable={!ro} source numbered code={strict ? "json" : format?.code}
                language={code ? path : format?.source ? `source.${format.source}` : undefined} config={config} {...wiring} label={stem(path)}
                docPath={isMd(path) ? path : undefined} onPasteFiles={outside ? undefined : paste}
                onReady={(api) => { editor.current = { api, source: true }; ready(api, true); if (kept?.write) toText() }}
                onChange={(text) => typed(text, null)} />
            ) : (
              <Editor key={`${path}:text`} doc={full()} frontmatter editable={shown === "live" && !ro} config={config} {...wiring} label={stem(path)}
                docPath={isMd(path) ? path : undefined} onPasteFiles={outside ? undefined : paste}
                placeholderText={shown === "read" ? "" : "Start writing"} numbered={shown !== "read"}
                onReady={(api) => { editor.current = { api, source: false }; ready(api, false); if (kept?.write) toText() }}
                onChange={typed} onUndoFrontmatter={() => revealProps(article.current)} />
            )}
          </Suspense>}
        </div>
      </div>
    </article>
  )
  return fills ? <PaneScroll>{fileArticle}</PaneScroll> : fileArticle
}

/** A file that takes its whole pane (`layout: "pane"`), edge to
 *  edge: path bar, notices, then the drawing; on a phone, the screen between header and bar. */
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

/** A pane-filling file shown as text (its source, or not there): padded and scrolled the way Workspace does any file's
 *  tab (its `padded` and scroller). */
function PaneScroll({ children }: { children: ReactNode }) {
  return (
    <div className="h-full min-h-0 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]">
      <main className="mx-auto max-w-none px-8 pb-6">{children}</main>
    </div>
  )
}

function InTrash({ path, note = "" }: { path: string; note?: string }) {
  return (
    <Banner tone="info" icon={Trash2}>
      <span className="flex-1">In the trash.{note}</span>
      <button type="button" className="cursor-pointer font-semibold text-primary"
        onClick={async () => { try { await restoreFile(path) } catch (e) { notifyError(e, "Couldn't restore") } }}>Restore</button>
    </Banner>
  )
}

function Banner({ tone, icon: Icon = AlertTriangle, children }: { tone: "warn" | "info"; icon?: LucideIcon; children: ReactNode }) {
  return (
    <div role={tone === "warn" ? "alert" : "status"} className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[10px] px-3 py-2.5 text-[15px]"
      style={{ background: `color-mix(in srgb, ${tone === "warn" ? "var(--orange)" : "var(--muted-foreground)"} 14%, transparent)` }}>
      <Icon className="size-4 shrink-0" strokeWidth={2.25} style={{ color: tone === "warn" ? "var(--orange)" : "var(--muted-foreground)" }} />
      {children}
    </div>
  )
}

/** A read that failed because the file isn't text (415) or is too big to read as text (413). */
const NOT_TEXT = /isn't text'?$|too big to open as text$/
