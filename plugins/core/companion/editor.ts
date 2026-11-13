import { EditorState, type Extension, Prec } from "@codemirror/state"
import { EditorView, keymap } from "@codemirror/view"
import { type EditorCtx } from "@vaultite"
import { cotype } from "./cotype"
import { accept, answer, setFolder, setStreamer, setTyper, setUndoer, views } from "./live"
import { decide, proposals } from "./proposed"
import { lastEdit, span, stopThinking, stopTyping, streamAt, streamMsg, type, typed, undoLast } from "./typing"
import { chips, foldNear, sentAt, suggestionAt } from "./decorate"
import { watcher } from "./watcher"
import { chooser, chooserKey, mentions } from "./chooser"

setTyper(type)
setStreamer(streamMsg)
setUndoer({ undo: undoLast, can: (agent) => [...views.keys()].some((v) => { const e = v.dom.isConnected && v.state.field(lastEdit, false); return !!e && (!agent || e.agent === agent) }) })
setFolder(foldNear)

const theme = EditorView.baseTheme({
  ".cm-companion-mention": { color: "var(--c)", backgroundColor: "color-mix(in srgb, var(--c) 13%, transparent)", borderRadius: "4px", padding: "1px 3px",
    fontWeight: "550", transition: "background-color .3s" },
  ".cm-companion-asked": { backgroundColor: "color-mix(in srgb, var(--c) 26%, transparent)", animation: "cm-companion-pulse 1.1s ease-in-out infinite" },
  "@keyframes cm-companion-pulse": { "0%, 100%": { boxShadow: "0 0 0 0 transparent" }, "50%": { boxShadow: "0 0 0 3px color-mix(in srgb, var(--c) 28%, transparent)" } },
  "@media (prefers-reduced-motion: reduce)": { ".cm-companion-asked": { animation: "none" } },
  ".cm-companion-hl": { backgroundColor: "color-mix(in srgb, var(--c) 32%, transparent)", borderRadius: "3px", animation: "cm-companion-in .4s ease-out" },
  ".cm-companion-hl-line": { backgroundColor: "color-mix(in srgb, var(--c) 14%, transparent)" },
  ".cm-companion-anchor": { backgroundColor: "color-mix(in srgb, var(--c) 18%, transparent)", borderRadius: "2px", transition: "background-color .2s, box-shadow .2s" },
  ".cm-companion-line": { boxShadow: "inset 2px 0 0 color-mix(in srgb, var(--c) 70%, transparent)" },
  ".cm-companion-picked": { backgroundColor: "color-mix(in srgb, var(--c) 13%, transparent)", transition: "background-color .3s" },
  ".cm-companion-del": { textDecoration: "line-through", textDecorationColor: "var(--c)", textDecorationThickness: "2px", opacity: ".6" },
  ".cm-companion-ins": { color: "var(--c)", backgroundColor: "color-mix(in srgb, var(--c) 12%, transparent)", borderRadius: "3px", padding: "0 2px", marginLeft: "2px",
    animation: "cm-companion-in .3s ease-out" },
  ".cm-companion-veiled, .cm-companion-veiled *": { color: "transparent !important" },
  ".cm-tooltip.cm-companion-start": { background: "var(--card)", border: "0.5px solid var(--border)", borderRadius: "10px", padding: "4px", boxShadow: "0 10px 30px rgb(0 0 0 / 0.18)",
    fontFamily: "var(--font-sans)", fontSize: "13px", color: "var(--foreground)", minWidth: "260px", maxWidth: "min(420px, calc(100vw - 24px))" },
  ".cm-companion-start-row": { display: "flex", alignItems: "baseline", gap: "4px", padding: "3px 6px", borderRadius: "6px" },
  ".cm-companion-start-on": { background: "color-mix(in srgb, var(--primary) 9%, transparent)" },
  ".cm-companion-start-row > span": { flex: "none", width: "48px", fontSize: "12px", color: "var(--muted-foreground)" },
  ".cm-companion-start-row > div": { display: "flex", flexWrap: "wrap", gap: "4px", minWidth: "0" },
  ".cm-companion-start-row button": { padding: "1px 8px", borderRadius: "999px", border: "0.5px solid var(--border)", cursor: "pointer", lineHeight: "20px", whiteSpace: "nowrap" },
  ".cm-companion-start-row button[aria-pressed]": { background: "color-mix(in srgb, var(--primary) 18%, transparent)", borderColor: "color-mix(in srgb, var(--primary) 45%, transparent)", fontWeight: "600" },
  ".cm-companion-start-go": { display: "flex", width: "100%", alignItems: "center", gap: "6px", marginTop: "2px", padding: "4px 6px", borderRadius: "6px", cursor: "pointer", fontWeight: "550" },
  ".cm-companion-start-go:hover": { background: "color-mix(in srgb, var(--foreground) 6%, transparent)" },
  ".cm-companion-start-go > kbd": { marginLeft: "auto", fontFamily: "inherit", fontSize: "12px", color: "var(--muted-foreground)" },
  ".cm-companion-chip": { flex: "none", alignSelf: "center", marginLeft: "8px", padding: "0 8px", borderRadius: "999px", border: "0.5px solid var(--border)",
    fontSize: "12px", lineHeight: "20px", color: "var(--muted-foreground)", whiteSpace: "nowrap", cursor: "pointer" },
  ".cm-companion-chip:hover": { color: "var(--foreground)", background: "color-mix(in srgb, var(--foreground) 6%, transparent)" },
  "@media (max-width: 767px)": {
    "li:has(.cm-companion-chip) .cm-completionDetail": { display: "none" },
    ".cm-companion-chip": { marginLeft: "auto", padding: "0 12px", fontSize: "14px", lineHeight: "32px" },
    ".cm-tooltip.cm-companion-start": { fontSize: "15px", borderRadius: "12px" },
    ".cm-companion-start-row": { padding: "6px 8px" },
    ".cm-companion-start-row button": { padding: "0 12px", lineHeight: "32px" },
    ".cm-companion-start-go": { minHeight: "44px", padding: "0 8px" },
    ".cm-companion-start-go > kbd": { display: "none" },
  },
  ".cm-companion-typed": { backgroundColor: "color-mix(in srgb, var(--c) 24%, transparent)", borderRadius: "2px", animation: "cm-companion-fade 4s ease-in forwards" },
  "@keyframes cm-companion-in": { from: { backgroundColor: "transparent" } },
  "@keyframes cm-companion-fade": { "0%, 40%": {}, "100%": { backgroundColor: "transparent" } },
})

export { doItEditor, taskHere } from "./doitline"
export { foldItems } from "./decorate"

export function companionExtension(ctx: EditorCtx): Extension {
  if (ctx.kind !== "markdown" || !ctx.path) return []
  const path = ctx.path
  const keys = Prec.highest(keymap.of([
    ...["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", "Shift-Tab"].map((key) => ({ key, run: chooserKey(key) })),
    { key: "Tab", run: (v) => { if (chooserKey("Tab")(v)) return true; const n = suggestionAt(v, path); if (!n) return decide(v, path, "accept"); void accept(n); return true } },
    { key: "Escape", run: (v) => {
      if (chooserKey("Escape")(v) || stopTyping(v)) return true
      const n = suggestionAt(v, path)
      if (n) { answer(n.id, "reject"); return true }
      return decide(v, path, "reject") || stopThinking(path)
    } },
  ]))
  return [typed, span, streamAt, lastEdit, sentAt, chooser, watcher(path), chips(path), proposals(path), keys, theme, EditorState.languageData.of(() => [{ suggest: mentions(path) }]), cotype(path)]
}
