import { useEffect, useState } from "react"
import { AudioLines, Mic } from "lucide-react"
import { afterSheets, createFile, definePlugin, op, openView, dictation, dictationSource, fnDictation, Group, hintDictation, landDictation, listening, notify, notifyError, openFile, openPermissions, plural, pluginSettings,
  pressDictation, SettingRow, startDictation, typingIn, useStore, type DictationEngine, type DictationEngines, type DictationTarget } from "@vaultite"
import { fieldTarget } from "./field"
import { terminalTarget, type TerminalInput } from "./terminal"
import { useMicChoices } from "./mics"
import { askClear, DictationsView } from "./Dictations"
import { followPlaces, setTargetAt, whereOf } from "./place"

async function targetHere(): Promise<DictationTarget | null> {
  const el = document.activeElement
  const cm = el instanceof HTMLElement ? el.closest(".cm-editor") : null
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

async function engineFor(engine: unknown, language: string): Promise<DictationEngine> {
  if (engine === "apple" || engine === "parakeet") return engine
  if (language && !/^en\b/i.test(language)) return "apple"
  const e = await enginesFor(language)
  return e.parakeet && (language || !e.locale || /^en\b/i.test(e.locale)) ? "parakeet" : "apple"
}

function failed(code: string, message?: string) {
  if (code === "roaming") return
  if (code === "permission") return notify("Vaultite isn't allowed to use the microphone", { kind: "error", action: openPermissions ? { label: "Open settings", run: openPermissions } : undefined })
  if (code === "fallback") return notify(message ?? "Dictating on this Mac")
  if (code === "model") return notify("Parakeet's model isn't on this Mac: Handy or Hex downloads it, or pick Apple's recognizer", { kind: "error" })
  notifyError(new Error(message || "the recognizer stopped"), "Couldn't dictate")
}

async function begin(hold: boolean) {
  const target = await targetHere()
  if (!target) {
    if (!(await dictationSource?.roam?.({ start: true, held: hold }).catch(() => false))) hintDictation("Click where the words should go, then dictate")
    return false
  }
  const s = pluginSettings("dictation").get()
  const language = typeof s.language === "string" ? s.language.trim() : ""
  const silence = typeof s.silence === "number" ? s.silence : 0
  const microphone = typeof s.microphone === "string" ? s.microphone : undefined
  await startDictation(target, { engine: await engineFor(s.engine, language), language, silence, hold, keep: s.keep_audio === true, microphone, where: whereOf(target) }, failed)
  return !!dictation()
}

declare module "@vaultite" {
  interface PluginState { dictionary?: { note: string | null; size: number } }
}

function useDictationCount() {
  const [n, setN] = useState<number | null>(null)
  useEffect(() => {
    let on = true
    op<{ here: boolean; total: number; items: { kind: string }[] }>("dictation.history", { limit: 1, companion: false }).then((r) => on && setN(r.here ? r.total : null), () => {})
    return () => { on = false }
  }, [])
  return n
}

function DictionarySettings() {
  const kept = useDictationCount()
  const d = useStore().store?.dictionary
  const open = async () => {
    const at = d?.note ?? (await createFile("", "Dictionary", "---\ntype: dictionary\n---\n\n")).path
    if (at) openFile(at)
  }
  return (
    <Group>
      <SettingRow label="Dictionary" sub="Words you fix right after dictating are added" value={d?.size ? plural(d.size, "word") : "Empty"} onClick={() => void open()} data-dictionary />
      <SettingRow label="Dictations" sub="What you said lately, landed or not, on this Mac" value={kept === null ? undefined : kept ? plural(kept, "dictation") : "None yet"}
        onClick={() => afterSheets(() => openView("dictations"))} data-setting="dictations" />
      {!!kept && <SettingRow label={<span className="text-[var(--red)]">Clear dictations…</span>} chevron={null} onClick={() => void askClear()} data-setting="clear-dictations" />}
    </Group>
  )
}

function FnKey() {
  useEffect(() => { const key = fnDictation(begin), landing = landDictation(targetHere), places = followPlaces(); setTargetAt(targetHere); return () => { key(); landing(); places() } }, [])
  return null
}

export default definePlugin({
  background: () => <FnKey />,
  settingsPanel: () => <DictionarySettings />,
  settingsPanelFirst: true,
  settingsSearch: [{ label: "Dictionary", key: "dictionary" }, { label: "Dictations", key: "dictations" }, { label: "Clear dictations", key: "clear-dictations" }],
  settingChoices: { microphone: useMicChoices },
  views: { dictations: { icon: AudioLines, title: () => "Dictations", render: () => <DictationsView /> } },
  commands: [
    { id: "dictation:start", name: "Dictate", nameWhenOn: "Stop dictating", keys: ["Mod+J"], on: listening, when: () => !!dictationSource,
      run: () => void pressDictation(begin), icon: Mic, label: "Dictate", words: "voice speech microphone talk" },
    { id: "dictation:history", name: "Show dictations", icon: AudioLines, words: "dictation history transcripts said voice lost copy paste last", run: () => openView("dictations") },
    { id: "dictation:history-split", desktop: true, name: "Open dictations in right split", icon: AudioLines, run: () => openView("dictations", { split: true }) },
  ],
  editor: (ctx) => import("./editor").then((m) => m.dictationEditor(ctx.path)),
})
