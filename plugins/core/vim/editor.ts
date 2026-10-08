// Vim in the editor: @replit/codemirror-vim plus what Obsidian's Vimrc Support adds (Markdown motions, folds, the app's
// leader and window keys, the system clipboard, the vimrc), on while this device takes Vim's keys (state.ts).
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state"
import { EditorView, ViewPlugin, drawSelection } from "@codemirror/view"
import { foldAll, foldCode, toggleFold, unfoldAll, unfoldCode } from "@codemirror/language"
import { beginKeys, followLink, getStore, runCommandById, type EditorCtx } from "@vaultite"
import { EX } from "./ex"
import { applyVimrc, editorOpen } from "./vimrc"
import { deviceOn, getSettings, leaderOn, onState, peekPath, setEditorMode, setPeek } from "./state"

type VimModule = typeof import("@replit/codemirror-vim")
export type Vim = VimModule["Vim"]
/** The CodeMirror 5-like editor the package drives (its `cm`), as much of it as this plugin uses. */
export type CM = {
  state: { vim?: { insertMode: boolean; visualMode: boolean; mode?: string; status?: string; inputState?: { keyBuffer: string[]; operator?: string | null } } }
  cm6: EditorView
  on: (event: string, fn: (e: { mode: string; subMode?: string }) => void) => void
  indexFromPos: (p: { line: number; ch: number }) => number
  posFromIndex: (i: number) => { line: number; ch: number }
}

let loading: Promise<VimModule> | null = null
/** The package, loaded once (and set up with this plugin's keys). */
export const loadVim = () => loading ??= import("@replit/codemirror-vim").then((m) => { setUp(m.Vim); return m })

/** The view a `cm` drives. */
const viewOf = (cm: CM) => cm.cm6
/** The file an editor shows (its EditorCtx path), by view. */
const paths = new WeakMap<EditorView, string | undefined>()

// ---------- links and headings ----------
/** Links in a line: [[wiki]], ![[embed]], [text](url), <url>, a bare URL, a #tag: their spans and what they go to. */
type Link = { from: number; to: number; wiki?: string; url?: string; tag?: string }
const LINK = /!?\[\[([^\]\n]+?)\]\]|!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<(https?:\/\/[^>\s]+)>|(https?:\/\/[^\s)>\]]+)|(?<=^|\s)#([\p{L}\p{N}_/-]*[\p{L}_/-][\p{L}\p{N}_/-]*)/gu
function linksIn(text: string, offset: number): Link[] {
  const out: Link[] = []
  for (const m of text.matchAll(LINK)) {
    const from = offset + m.index!, to = from + m[0].length
    if (m[1] !== undefined) out.push({ from, to, wiki: m[1].split("|")[0] })
    else if (m[2] !== undefined) { let url = m[2]; try { url = decodeURI(url) } catch { /* as written */ } out.push({ from, to, url }) }
    else if (m[3] ?? m[4]) out.push({ from, to, url: m[3] ?? m[4] })
    else if (m[5]) out.push({ from, to, tag: m[5] })
  }
  return out
}
/** The link under the cursor, else the first one after it on its line. */
function linkAtCursor(view: EditorView) {
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  const links = linksIn(line.text, line.from)
  return links.find((l) => pos >= l.from && pos < l.to) ?? links.find((l) => l.from >= pos) ?? null
}
function follow(cm: CM, how: "here" | "tab" | "split" | "browser") {
  const view = viewOf(cm)
  const l = linkAtCursor(view)
  if (!l) return
  if (how === "browser") {
    if (l.url && /^(https?:|mailto:)/i.test(l.url)) window.open(l.url, "_blank", "noopener,noreferrer")
    return
  }
  const link = l.tag ? { tag: l.tag } : l.wiki !== undefined ? { wiki: l.wiki } : { url: l.url }
  const from = paths.get(view)
  const store = getStore()
  if (!store) return
  if (how === "split") {
    runCommandById("split:right")
    // (The new pane has the focus: the link opens there.)
    setTimeout(() => void followLink(store, link, false, from), 0)
    return
  }
  void followLink(store, link, how === "tab", from)
}

/** Which lines are inside code fences (no headings there), by line number. */
function fenced(view: EditorView) {
  const doc = view.state.doc, out: boolean[] = []
  let inside = false
  for (let i = 1; i <= doc.lines; i++) {
    if (/^\s*(```|~~~)/.test(doc.line(i).text)) { out[i] = true; inside = !inside } else out[i] = inside
  }
  return out
}
/** Where the `count`th heading after (or before) `pos` starts, or null. */
function headingFrom(view: EditorView, pos: number, forward: boolean, count: number) {
  const doc = view.state.doc, code = fenced(view)
  let n = doc.lineAt(pos).number, found: number | null = null
  for (let left = count; left > 0;) {
    n += forward ? 1 : -1
    if (n < 1 || n > doc.lines) break
    if (!code[n] && /^#{1,6}\s/.test(doc.line(n).text)) { found = doc.line(n).from; left-- }
  }
  return found
}
/** Where the `count`th link after (or before) `pos` starts, or null. */
function linkFrom(view: EditorView, pos: number, forward: boolean, count: number) {
  const doc = view.state.doc
  let at = pos, found: number | null = null
  for (let left = count; left > 0; left--) {
    let hit: number | null = null
    if (forward) {
      for (let n = doc.lineAt(at).number; n <= doc.lines && hit === null; n++) {
        const line = doc.line(n)
        hit = linksIn(line.text, line.from).find((l) => l.from > at)?.from ?? null
      }
    } else {
      for (let n = doc.lineAt(at).number; n >= 1 && hit === null; n--) {
        const line = doc.line(n)
        hit = linksIn(line.text, line.from).filter((l) => l.from < at).pop()?.from ?? null
      }
    }
    if (hit === null) break
    found = at = hit
  }
  return found
}

// ---------- Vim's keys ----------
let setUpDone = false
function setUp(Vim: Vim) {
  if (setUpDone) return
  setUpDone = true
  installKeys(Vim)
  installClipboard(Vim)
}

/** The keys this plugin adds to Vim's (again after a vimrc's mapclear: vimrc.ts calls this). */
export function installKeys(Vim: Vim) {
  type MotionFn = Parameters<Vim["defineMotion"]>[1]
  const motion = (fn: (view: EditorView, pos: number, forward: boolean, count: number) => number | null) =>
    ((cm: CM, head: { line: number; ch: number }, args: { forward?: boolean; repeat?: number }) => {
      const to = fn(viewOf(cm), cm.indexFromPos(head), !!args.forward, args.repeat ?? 1)
      return to === null ? head : cm.posFromIndex(to)
    }) as unknown as MotionFn
  Vim.defineMotion("vauHeading", motion(headingFrom))
  Vim.defineMotion("vauLink", motion(linkFrom))
  Vim.mapCommand("]]", "motion", "vauHeading", { forward: true, toJumplist: true }, {})
  Vim.mapCommand("[[", "motion", "vauHeading", { forward: false, toJumplist: true }, {})
  Vim.mapCommand("gl", "motion", "vauLink", { forward: true }, {})
  Vim.mapCommand("gL", "motion", "vauLink", { forward: false }, {})

  type ActionFn = Parameters<Vim["defineAction"]>[1]
  const action = (fn: (cm: CM) => void) => ((cm: CM) => fn(cm)) as unknown as ActionFn
  const normal = { context: "normal" }
  Vim.defineAction("vauFollow", action((cm) => follow(cm, "here")))
  Vim.defineAction("vauFollowTab", action((cm) => follow(cm, "tab")))
  Vim.defineAction("vauBrowse", action((cm) => follow(cm, "browser")))
  Vim.defineAction("vauPeek", action((cm) => follow(cm, "split")))
  Vim.mapCommand("gf", "action", "vauFollow", {}, normal)
  Vim.mapCommand("gd", "action", "vauFollow", {}, normal)
  Vim.mapCommand("gF", "action", "vauFollowTab", {}, normal)
  Vim.mapCommand("gx", "action", "vauBrowse", {}, normal)
  Vim.mapCommand("K", "action", "vauPeek", {}, normal)

  const fold = (fn: (view: EditorView) => boolean) => action((cm) => { fn(viewOf(cm)) })
  Vim.defineAction("vauFoldToggle", fold(toggleFold))
  Vim.defineAction("vauFoldClose", fold(foldCode))
  Vim.defineAction("vauFoldOpen", fold(unfoldCode))
  Vim.defineAction("vauFoldAll", fold(foldAll))
  Vim.defineAction("vauUnfoldAll", fold(unfoldAll))
  Vim.mapCommand("za", "action", "vauFoldToggle", {}, normal)
  Vim.mapCommand("zc", "action", "vauFoldClose", {}, normal)
  Vim.mapCommand("zo", "action", "vauFoldOpen", {}, normal)
  Vim.mapCommand("zM", "action", "vauFoldAll", {}, normal)
  Vim.mapCommand("zR", "action", "vauUnfoldAll", {}, normal)

  // The app's keys: Space (the leader) and Ctrl+W hand the next keys to the app's sequences (core/commands.ts).
  Vim.defineAction("vauLeader", action((cm) => {
    if (leaderOn() && beginKeys("Space")) return
    // (No leader: Space moves right, as in Vim.)
    Vim.handleKey(cm as never, "l", "mapping")
  }))
  Vim.defineAction("vauWindow", action(() => { beginKeys("Ctrl+W") }))
  Vim.defineAction("vauTabNext", action(() => runCommandById("tab:next")))
  Vim.defineAction("vauTabPrevious", action(() => runCommandById("tab:previous")))
  Vim.mapCommand("<Space>", "action", "vauLeader", {}, normal)
  Vim.mapCommand("<C-w>", "action", "vauWindow", {}, normal)
  Vim.mapCommand("gt", "action", "vauTabNext", {}, normal)
  Vim.mapCommand("gT", "action", "vauTabPrevious", {}, normal)

  // : commands that drive the app.
  for (const ex of EX) {
    try {
      Vim.defineEx(ex.name, ex.short, (_cm, params) => {
        const raw = params.argString ?? ""
        ex.run(raw.replace(/^!/, "").trim(), raw.startsWith("!"))
      })
    } catch (e) { console.error("vim:", e) }
  }
}

// ---------- the system clipboard ----------
/** What this page last put on the clipboard, or took from it: what p would paste anyway. */
let wrote = ""
function installClipboard(Vim: Vim) {
  const rc = Vim.getRegisterController() as unknown as {
    pushText: (name: string | null | undefined, op: string, text: string, linewise?: boolean, blockwise?: boolean) => void
    unnamedRegister: { setText: (t: string, linewise?: boolean) => void; toString: () => string }
  }
  const push = rc.pushText.bind(rc)
  rc.pushText = (name, op, text, linewise, blockwise) => {
    push(name, op, text, linewise, blockwise)
    // Like clipboard=unnamed: what goes to the unnamed register goes to the system's too (not "_ or a named one).
    if (getSettings().clipboard === false || (name && name !== '"')) return
    const t = linewise && !text.endsWith("\n") ? `${text}\n` : text
    wrote = t
    navigator.clipboard?.writeText(t).catch(() => {})
  }
  // Copied elsewhere: p pastes it, where the page may read the clipboard without asking.
  const take = (text: string) => {
    if (!text || text === wrote || text === rc.unnamedRegister.toString()) return
    wrote = text
    rc.unnamedRegister.setText(text, text.endsWith("\n"))
  }
  const pull = async () => {
    if (getSettings().clipboard === false || !navigator.clipboard?.readText) return
    try {
      // Without asking: the desktop app reads freely; a browser only once the page was allowed.
      if (!("vaultite" in window)) {
        const p = await navigator.permissions?.query({ name: "clipboard-read" as PermissionName })
        if (p?.state !== "granted") return
      }
      take(await navigator.clipboard.readText())
    } catch { /* not allowed now */ }
  }
  addEventListener("focus", () => void pull())
  document.addEventListener("focusin", (e) => { if ((e.target as Element | null)?.closest?.(".cm-editor")) void pull() })
  // Copied in the app outside an editor (⌘C on a page): what p pastes, even where the clipboard can't be read.
  const copied = () => setTimeout(() => {
    const sel = document.getSelection()?.toString()
    if (sel && !document.activeElement?.closest(".cm-editor")) take(sel)
  }, 0)
  document.addEventListener("copy", copied)
  document.addEventListener("cut", copied)
}

// ---------- the extension ----------
const theme = EditorView.theme({
  "&.cm-editor .cm-panels.cm-panels-bottom": { background: "var(--background)", color: "var(--foreground)", borderTop: "1px solid var(--border)" },
  "&.cm-editor .cm-fat-cursor": { background: "var(--primary)", color: "var(--primary-foreground) !important" },
  "&.cm-editor:not(.cm-focused) .cm-fat-cursor": { background: "none", outline: "solid 1px var(--primary)", color: "transparent !important" },
  "& .cm-vim-panel": { fontFamily: "var(--font-mono, monospace)", fontSize: "12px", padding: "3px 10px", color: "var(--muted-foreground)" },
  "& .cm-vim-panel input": { color: "var(--foreground)", fontFamily: "inherit", fontSize: "inherit" },
  "& .cm-foldPlaceholder": { background: "var(--muted)", border: "none", color: "var(--muted-foreground)", padding: "0 4px", borderRadius: "4px" },
})

/** The editor that has the keyboard tells the status bar its mode and the keys typed so far. */
function tracker(cm: CM) {
  const view = viewOf(cm)
  const tell = () => {
    if (!view.hasFocus) return
    const v = cm.state.vim
    setEditorMode(v ? (v.mode ?? (v.insertMode ? "insert" : v.visualMode ? "visual" : "normal")) : null, v?.status ?? "")
  }
  cm.on("vim-mode-change", (e) => {
    if (cm.state.vim) cm.state.vim.mode = e.mode + (e.subMode ? (e.subMode === "linewise" ? " line" : " block") : "")
    tell()
  })
  cm.on("vim-keypress", tell)
  cm.on("vim-command-done", tell)
  return tell
}

/** Escape in normal mode, with nothing typed: back to reading, for a file switched to editing with i. */
function peekBack(view: EditorView, e: KeyboardEvent) {
  if (e.key !== "Escape" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false
  const path = paths.get(view)
  if (!path || peekPath() !== path) return false
  const v = (view as unknown as { cm?: CM }).cm?.state.vim
  if (!v || v.insertMode || v.visualMode || v.inputState?.keyBuffer.length || v.inputState?.operator) return false
  setPeek(null)
  runCommandById("view:toggle")
  return true
}

let parts: Extension | null = null
async function vimParts(): Promise<Extension> {
  if (parts) return parts
  const { vim, getCM } = await loadVim()
  parts = [
    // Ahead of Vim's own keys: Escape back to reading.
    Prec.highest(EditorView.domEventHandlers({ keydown: (e, view) => { if (!peekBack(view, e)) return false; e.preventDefault(); return true } })),
    vim({ status: false }),
    // Visual block (Ctrl+V, then I or A) edits every line through a cursor on each.
    EditorState.allowMultipleSelections.of(true),
    drawSelection(),
    theme,
    ViewPlugin.define((view) => {
      const cm = getCM(view) as unknown as CM | null
      const tell = cm ? tracker(cm) : () => {}
      if (cm) { editorOpen(cm, true); void applyVimrc(cm) }
      const blur = () => setTimeout(() => { if (!document.activeElement?.closest(".cm-editor")) setEditorMode(null) }, 0)
      view.contentDOM.addEventListener("focus", tell)
      view.contentDOM.addEventListener("blur", blur)
      return {
        destroy() {
          view.contentDOM.removeEventListener("focus", tell)
          view.contentDOM.removeEventListener("blur", blur)
          if (cm) editorOpen(cm, false)
          if (view.hasFocus) setEditorMode(null)
        },
      }
    }),
  ]
  return parts
}

// Every editor's compartment holds Vim while this device takes its keys and the editor is editable; a read-only one
// leaves its keys to the app's Vim layer (app.tsx), which it would otherwise swallow.
type Slot = { c: Compartment; on: boolean }
const slots = new Map<EditorView, Slot>()
const wanted = (view: EditorView) => deviceOn() && view.state.facet(EditorView.editable)
function refresh(view: EditorView) {
  const slot = slots.get(view)
  if (!slot) return
  const want = wanted(view)
  if (want === slot.on) return
  slot.on = want
  void (want ? vimParts() : Promise.resolve([])).then((ext) => {
    if (slots.get(view) === slot && slot.on === want) view.dispatch({ effects: slot.c.reconfigure(ext) })
  })
}
onState(() => { for (const v of slots.keys()) refresh(v) })

/** The extension for one editor: a compartment holding Vim while this device takes its keys and it's editable. */
export async function vimExtension(ctx: EditorCtx): Promise<Extension> {
  const c = new Compartment()
  // (Loaded now when this device takes Vim's keys, so an editor that opens editable has them from its first key.)
  const inner = deviceOn() ? await vimParts() : []
  return [
    c.of([]),
    ViewPlugin.define((view) => {
      const slot: Slot = { c, on: false }
      slots.set(view, slot)
      paths.set(view, ctx.path)
      // Vim in at once when the editor starts editable (not in a later transaction: the first key would miss it).
      if (wanted(view)) { slot.on = true; queueMicrotask(() => { if (slots.get(view) === slot && slot.on) view.dispatch({ effects: c.reconfigure(inner) }) }) }
      return {
        update(u) { if (u.startState.facet(EditorView.editable) !== u.state.facet(EditorView.editable)) queueMicrotask(() => refresh(view)) },
        destroy() { if (slots.get(view) === slot) slots.delete(view) },
      }
    }),
  ]
}
