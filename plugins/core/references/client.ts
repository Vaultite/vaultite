import { currentEditor, get, notify, notifyError, onVaultChange, op, openFile, pluginSettings, post } from "@vaultite"
import type { CiteAnswer, EntryAnswer, NoteMade } from "./wire.ts"

const cites = new Map<string, Promise<CiteAnswer>>()
const entries = new Map<string, { at: number; answer: Promise<EntryAnswer> }>()
const KEEP = 60_000
const LIBRARY_FILES = /\.(bib|bibtex|biblatex|ris|json|ya?ml|csl)$/i
export const touchesLibrary = (p: string) => p === ".vaultite/plugins/references/data.json" || (!p.startsWith(".") && LIBRARY_FILES.test(p))

export function formatCites(path: string, sources: string[]): Promise<CiteAnswer> {
  const key = `${path}\u0000${sources.join("\u0001")}`
  const had = cites.get(key)
  if (had) return had
  const asked = post<CiteAnswer>("references/cite", { path, sources })
  cites.set(key, asked)
  asked.catch(() => cites.delete(key))
  setTimeout(() => cites.delete(key), KEEP)
  if (cites.size > 200) cites.delete(cites.keys().next().value ?? "")
  return asked
}

export function entryOf(key: string, path: string): Promise<EntryAnswer> {
  const id = `${path}\u0000${key}`, had = entries.get(id)
  if (had && Date.now() - had.at < KEEP) return had.answer
  const answer = get<EntryAnswer>(`references/entry?key=${encodeURIComponent(key)}&path=${encodeURIComponent(path)}`)
  entries.set(id, { at: Date.now(), answer })
  answer.catch(() => entries.delete(id))
  return answer
}

export const settings = pluginSettings<{ style?: string; inDocument?: boolean }>("references")
const changed = new Set<() => void>()

export function forgetFormatted() {
  cites.clear()
  entries.clear()
  for (const fn of changed) fn()
}

let heard: (() => void) | null = null
export function onLibraryChange(fn: () => void): () => void {
  changed.add(fn)
  if (!heard) {
    const vault = onVaultChange((paths) => { if (!paths || paths.some(touchesLibrary)) forgetFormatted() })
    const focus = () => forgetFormatted()
    const set = settings.onChange(focus)
    addEventListener("focus", focus)
    heard = () => { vault(); set(); removeEventListener("focus", focus) }
  }
  return () => {
    changed.delete(fn)
    if (!changed.size && heard) { heard(); heard = null }
  }
}

export async function openLiterature(key: string) {
  try {
    const made = await op<NoteMade>("references.note", { key })
    openFile(made.path)
    if (made.created) notify(`Made the literature note for @${key}`)
  } catch (e) { notifyError(e, "Couldn't open its literature note") }
}

export function insertCitation(keys: string[]): boolean {
  const ed = currentEditor()
  if (!ed || ed.kind !== "markdown" || !keys.length) return false
  const { state } = ed.view, at = state.selection.main
  const line = state.doc.lineAt(at.from), before = line.text.slice(0, at.from - line.from), after = line.text.slice(at.to - line.from)
  const inBrackets = /\[[^\]]*@[^\]]*$/.test(before) && /^[^[]*\]/.test(after)
  const text = inBrackets ? `; ${keys.map((k) => `@${k}`).join("; ")}` : `[${keys.map((k) => `@${k}`).join("; ")}]`
  const lead = !inBrackets && before && !/[\s([]$/.test(before) ? " " : ""
  ed.view.dispatch({ changes: { from: at.from, to: at.to, insert: lead + text }, selection: { anchor: at.from + lead.length + text.length }, scrollIntoView: true, userEvent: "input" })
  ed.view.focus()
  return true
}

export async function citeFromZotero() {
  try {
    const picked = (await get<{ citation: string }>("references/cayw")).citation
    if (picked && !insertPicked(picked)) notify("Open a note to cite in it")
  } catch (e) { notifyError(e, "Couldn't open Zotero's picker") }
}

function insertPicked(citation: string) {
  const ed = currentEditor()
  if (!ed || ed.kind !== "markdown") return false
  const at = ed.view.state.selection.main
  ed.view.dispatch({ changes: { from: at.from, to: at.to, insert: citation }, selection: { anchor: at.from + citation.length }, userEvent: "input" })
  ed.view.focus()
  return true
}
