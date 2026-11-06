// Dictation (⌘J, fn through the menu-bar helper): what's said goes where the cursor is (web/src/core/dictation.ts has the
// session, electron/dictation.ts the recognizer). A tap starts and the next stops; held, it listens until let go.
import { useEffect } from "react"
import { Mic } from "lucide-react"
import { definePlugin, dictation, dictationSource, fnDictation, hintDictation, listening, notify, notifyError, openPermissions, pluginSettings, pressDictation,
  startDictation, typingIn, type DictationEngine, type DictationEngines, type DictationTarget } from "@vaultite"
import { fieldTarget } from "./field"
import { terminalTarget, type TerminalInput } from "./terminal"

/** Where the words go: the editor, terminal or field with the keyboard; with none, nowhere (talking to the companion
 *  is its Talk keys'). */
async function targetHere(): Promise<DictationTarget | null> {
  const el = document.activeElement
  const cm = el instanceof HTMLElement ? el.closest(".cm-editor") : null
  // (CodeMirror comes with the editor, not with the app)
  const view = cm instanceof HTMLElement ? (await import("./editor")).viewOf(cm) : null
  if (view) return view.target ?? fieldTarget(view.dom)
  const term = el?.closest<HTMLElement & { terminalInput?: TerminalInput }>("[data-terminal]")
  if (term?.terminalInput && el?.matches("[data-term-input]")) return terminalTarget(term, term.terminalInput)
  if (el instanceof HTMLElement && typingIn(el) && !el.closest("[data-keeps-keys], [data-term]")) return fieldTarget(el)
  return null
}

let known: { language: string; at: number; engines: Promise<DictationEngines> } | null = null
const enginesFor = (language: string) => {
  if (!known || known.language !== language || Date.now() - known.at > 60_000) {
    known = { language, at: Date.now(), engines: dictationSource!.engines(language).catch(() => ({ apple: true, parakeet: false })) }
  }
  return known.engines
}

/** The recognizer: the one set, else Parakeet for English when its model is here, else Apple's. */
async function engineFor(engine: unknown, language: string): Promise<DictationEngine> {
  if (engine === "apple" || engine === "parakeet") return engine
  if (language && !/^en\b/i.test(language)) return "apple"
  const e = await enginesFor(language)
  return e.parakeet && (language || !e.locale || /^en\b/i.test(e.locale)) ? "parakeet" : "apple"
}

function failed(code: string, message?: string) {
  if (code === "permission") return notify("Vaultite isn't allowed to use the microphone", { kind: "error", action: openPermissions ? { label: "Open settings", run: openPermissions } : undefined })
  if (code === "fallback") return notify(message ?? "Dictating on this Mac")
  if (code === "model") return notify("Parakeet's model isn't on this Mac: Handy or Hex downloads it, or pick Apple's recognizer", { kind: "error" })
  notifyError(new Error(message || "the recognizer stopped"), "Couldn't dictate")
}

async function begin(hold: boolean) {
  const target = await targetHere()
  if (!target) { hintDictation("Click where the words should go, then dictate"); return false }
  const s = pluginSettings("dictation").get()
  const language = typeof s.language === "string" ? s.language.trim() : ""
  const silence = typeof s.silence === "number" ? s.silence : 0
  // (left out of its settings: the manifest's default)
  const replacements = Array.isArray(s.replacements) ? s.replacements.filter((x): x is string => typeof x === "string") : ["at Claude: @claude"]
  await startDictation(target, { engine: await engineFor(s.engine, language), language, silence, hold, replacements, keep: s.keep_audio === true }, failed)
  return !!dictation()
}

/** fn while this window has the keyboard: its ⌘J (the helper dictates in other apps itself). */
function FnKey() {
  useEffect(() => fnDictation(begin), [])
  return null
}

export default definePlugin({
  background: () => <FnKey />,
  commands: [
    { id: "dictation:start", name: "Dictate", nameWhenOn: "Stop dictating", keys: ["Mod+J"], on: listening, when: () => !!dictationSource,
      run: () => void pressDictation(begin), icon: Mic, label: "Dictate", words: "voice speech microphone talk" },
  ],
  editor: (ctx) => import("./editor").then((m) => m.dictationEditor(ctx.path)),
})
