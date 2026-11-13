import { Compartment, Prec, type Extension } from "@codemirror/state"
import { EditorView, ViewPlugin } from "@codemirror/view"
import { foldAll, foldCode, toggleFold, unfoldAll, unfoldCode } from "@codemirror/language"
import { beginKeys, followLink, getStore, isMac, linksIn, logError, runCommandById, runShortcut, type EditorCtx } from "@vaultite"
import { EX } from "./ex"
import { applyVimrc, editorOpen } from "./vimrc"
import { deviceOn, leaderOn, leftEditor, onState, peekPath, setEditorMode, setPeek, settings } from "./state"

import type { ActionFn, CodeMirror, CodeMirrorV, MotionFn } from "@replit/codemirror-vim"

type VimModule = typeof import("@replit/codemirror-vim")
export type Vim = VimModule["Vim"]
export type CM = CodeMirror

let loading: Promise<VimModule> | null = null
export const loadVim = () => loading ??= import("@replit/codemirror-vim").then((m) => { setUp(m.Vim); return m })

const viewOf = (cm: CM | CodeMirrorV): EditorView => cm.cm6
const paths = new WeakMap<EditorView, string | undefined>()

function linkAtCursor(view: EditorView) {
  const pos = view.state.selection.main.head
  const line = view.state.doc.lineAt(pos)
  const links = linksIn(line.text, line.from)
  return links.find((l) => pos >= l.from && pos < l.to) ?? links.find((l) => l.from >= pos) ?? null
}
function follow(cm: CodeMirrorV, how: "here" | "tab" | "split" | "browser") {
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
    setTimeout(() => void followLink(store, link, false, from), 0)
    return
  }
  void followLink(store, link, how === "tab", from)
}

function fenced(view: EditorView) {
  const doc = view.state.doc, out: boolean[] = []
  let inside = false
  for (let i = 1; i <= doc.lines; i++) {
    if (/^\s*(```|~~~)/.test(doc.line(i).text)) { out[i] = true; inside = !inside } else out[i] = inside
  }
  return out
}
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

let setUpDone = false
function setUp(Vim: Vim) {
  if (setUpDone) return
  setUpDone = true
  installKeys(Vim)
  installClipboard(Vim)
}

export function installKeys(Vim: Vim) {
  const motion = (fn: (view: EditorView, pos: number, forward: boolean, count: number) => number | null): MotionFn =>
    (cm, head, args) => {
      const to = fn(viewOf(cm), cm.indexFromPos(head), !!args.forward, args.repeat ?? 1)
      return to === null ? head : cm.posFromIndex(to)
    }
  Vim.defineMotion("vauHeading", motion(headingFrom))
  Vim.defineMotion("vauLink", motion(linkFrom))
  Vim.mapCommand("]]", "motion", "vauHeading", { forward: true, toJumplist: true }, {})
  Vim.mapCommand("[[", "motion", "vauHeading", { forward: false, toJumplist: true }, {})
  Vim.mapCommand("gl", "motion", "vauLink", { forward: true }, {})
  Vim.mapCommand("gL", "motion", "vauLink", { forward: false }, {})

  const action = (fn: (cm: CodeMirrorV) => void): ActionFn => (cm) => fn(cm)
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

  Vim.defineAction("vauLeader", action((cm) => {
    if (leaderOn() && beginKeys("Space")) return
    Vim.handleKey(cm, "l", "mapping")
  }))
  Vim.defineAction("vauWindow", action(() => { beginKeys("Ctrl+W") }))
  Vim.defineAction("vauTabNext", action(() => runCommandById("tab:next")))
  Vim.defineAction("vauTabPrevious", action(() => runCommandById("tab:previous")))
  Vim.mapCommand("<Space>", "action", "vauLeader", {}, normal)
  Vim.mapCommand("<C-w>", "action", "vauWindow", {}, normal)
  Vim.mapCommand("gt", "action", "vauTabNext", {}, normal)
  Vim.mapCommand("gT", "action", "vauTabPrevious", {}, normal)

  for (const ex of EX) {
    try {
      Vim.defineEx(ex.name, ex.short, (_cm, params) => {
        const raw = params.argString ?? ""
        ex.run(raw.replace(/^!/, "").trim(), raw.startsWith("!"))
      })
    } catch (e) { logError("vim", e) }
  }
}

let wrote = ""
function installClipboard(Vim: Vim) {
  const rc = Vim.getRegisterController()
  const push = rc.pushText.bind(rc)
  rc.pushText = (name, op, text, linewise, blockwise) => {
    push(name, op, text, linewise, blockwise)
    if (settings.get().clipboard === false || (name && name !== '"')) return
    const t = linewise && !text.endsWith("\n") ? `${text}\n` : text
    wrote = t
    navigator.clipboard?.writeText(t).catch(() => {})
  }
  const take = (text: string) => {
    if (!text || text === wrote || text === rc.unnamedRegister.toString()) return
    wrote = text
    rc.unnamedRegister.setText(text, text.endsWith("\n"))
  }
  const pull = async () => {
    if (settings.get().clipboard === false || !navigator.clipboard?.readText) return
    try {
      // A browser reads the clipboard without asking only once the page was allowed; the desktop app always may.
      if (!("vaultite" in window)) {
        const p = await navigator.permissions?.query({ name: "clipboard-read" as PermissionName })
        if (p?.state !== "granted") return
      }
      take(await navigator.clipboard.readText())
    } catch {}
  }
  addEventListener("focus", () => void pull())
  document.addEventListener("focusin", (e) => { if (e.target instanceof Element && e.target.closest(".cm-editor")) void pull() })
  const copied = () => setTimeout(() => {
    const sel = document.getSelection()?.toString()
    if (sel && !document.activeElement?.closest(".cm-editor")) take(sel)
  }, 0)
  document.addEventListener("copy", copied)
  document.addEventListener("cut", copied)
}

const theme = EditorView.theme({
  "&.cm-editor .cm-panels.cm-panels-bottom": { background: "var(--background)", color: "var(--foreground)", borderTop: "1px solid var(--border)" },
  "&.cm-editor .cm-fat-cursor": { background: "var(--primary)", color: "var(--primary-foreground) !important" },
  "&.cm-editor:not(.cm-focused) .cm-fat-cursor": { background: "none", outline: "solid 1px var(--primary)", color: "transparent !important" },
  "& .cm-vim-panel": { fontFamily: "var(--font-mono, monospace)", fontSize: "12px", padding: "3px 10px", color: "var(--muted-foreground)" },
  "& .cm-vim-panel input": { color: "var(--foreground)", fontFamily: "inherit", fontSize: "inherit" },
  "& .cm-foldPlaceholder": { background: "var(--muted)", border: "none", color: "var(--muted-foreground)", padding: "0 4px", borderRadius: "4px" },
})

let lastView: EditorView | null = null

function tracker(cm: CM) {
  const view = viewOf(cm)
  const tell = () => {
    if (!view.hasFocus) return
    const v = cm.state.vim
    setEditorMode(v ? (v.mode ?? (v.insertMode ? "insert" : v.visualMode ? "visual" : "normal")) : "normal", v?.status ?? "")
  }
  cm.on("vim-mode-change", (e: { mode: string; subMode?: string }) => {
    if (cm.state.vim) cm.state.vim.mode = e.mode + (e.subMode ? (e.subMode === "linewise" ? " line" : " block") : "")
    tell()
  })
  cm.on("vim-keypress", tell)
  cm.on("vim-command-done", tell)
  return tell
}

function peekBack(view: EditorView, e: KeyboardEvent, getCM: VimModule["getCM"]) {
  if (e.key !== "Escape" || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return false
  const path = paths.get(view)
  if (!path || peekPath() !== path) return false
  const v = getCM(view)?.state.vim
  if (!v || v.insertMode || v.visualMode || v.inputState?.keyBuffer.length || v.inputState?.operator) return false
  setPeek(null)
  runCommandById("view:toggle")
  return true
}

const VIM_CTRL = new Set(["KeyW", "KeyD", "KeyU", "KeyF", "KeyB", "KeyV", "KeyR", "KeyA", "KeyX", "KeyI", "KeyC"])

function appKey(view: EditorView, e: KeyboardEvent, getCM: VimModule["getCM"]) {
  if (isMac || !e.ctrlKey || e.metaKey || e.altKey || !/^Key[A-Z]$/.test(e.code) || VIM_CTRL.has(e.code)) return false
  const v = getCM(view)?.state.vim
  if (!v || v.insertMode || v.visualMode || v.inputState?.keyBuffer.length || v.inputState?.operator) return false
  return runShortcut(e)
}

let parts: Extension | null = null
async function vimParts(): Promise<Extension> {
  if (parts) return parts
  const { vim, getCM } = await loadVim()
  parts = [
    Prec.highest(EditorView.domEventHandlers({ keydown: (e, view) => {
      if (appKey(view, e, getCM)) return true
      if (!peekBack(view, e, getCM)) return false
      e.preventDefault(); return true
    } })),
    vim({ status: false }),
    theme,
    ViewPlugin.define((view) => {
      const cm = getCM(view)
      const track = cm ? tracker(cm) : () => {}
      const tell = () => { lastView = view; track() }
      if (cm) { editorOpen(cm, true); void applyVimrc(cm) }
      const blur = () => setTimeout(() => { if (!document.activeElement?.closest(".cm-editor")) leftEditor() }, 0)
      view.contentDOM.addEventListener("focus", tell)
      view.contentDOM.addEventListener("blur", blur)
      return {
        destroy() {
          view.contentDOM.removeEventListener("focus", tell)
          view.contentDOM.removeEventListener("blur", blur)
          if (cm) editorOpen(cm, false)
          if (view.hasFocus || lastView === view) { lastView = null; leftEditor(true) }
        },
      }
    }),
  ]
  return parts
}

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

export async function vimExtension(ctx: EditorCtx): Promise<Extension> {
  const c = new Compartment()
  const inner = deviceOn() ? await vimParts() : []
  return [
    c.of([]),
    ViewPlugin.define((view) => {
      const slot: Slot = { c, on: false }
      slots.set(view, slot)
      paths.set(view, ctx.path)
      if (wanted(view)) { slot.on = true; queueMicrotask(() => { if (slots.get(view) === slot && slot.on) view.dispatch({ effects: c.reconfigure(inner) }) }) }
      return {
        update(u) { if (u.startState.facet(EditorView.editable) !== u.state.facet(EditorView.editable)) queueMicrotask(() => refresh(view)) },
        destroy() { if (slots.get(view) === slot) slots.delete(view) },
      }
    }),
  ]
}
