import { copyText, currentEditor, editorAt, notify, openFile, openView, type DictationTarget, type DictationWhere } from "@vaultite"

type Place = { el: WeakRef<HTMLElement>; to?: string }
let places: Place[] = []

const placeOf = (el: HTMLElement): Place | null => {
  if (el.closest("[data-dictations], dialog, [role=dialog], [role=menu]") || el.getAttribute("role") === "combobox") return null
  const cm = el.closest<HTMLElement>(".cm-editor"), term = el.closest<HTMLElement>("[data-terminal]")
  if (cm) { const path = editorAt(cm)?.path; return { el: new WeakRef(cm), ...(path ? { to: `file:${path}` } : {}) } }
  if (term && el.matches("[data-term-input]")) return { el: new WeakRef(el), to: `view:terminal/${term.dataset.terminal}` }
  if (el.matches("input:not([type=checkbox]):not([type=radio]):not([type=search]), textarea, [contenteditable=true]")) return { el: new WeakRef(el) }
  return null
}
export function followPlaces() {
  const seen = (e: FocusEvent) => {
    const p = e.target instanceof HTMLElement ? placeOf(e.target) : null
    if (p) places = [...places.filter((x) => x.el.deref() !== p.el.deref()), p].slice(-6)
  }
  addEventListener("focusin", seen, true)
  return () => removeEventListener("focusin", seen, true)
}

const visible = (el: HTMLElement | undefined): el is HTMLElement => !!el?.isConnected && el.getClientRects().length > 0
const frame = () => new Promise((r) => requestAnimationFrame(r))

export async function insertAgain(text: string, target: () => Promise<DictationTarget | null> = targetAt) {
  const last = places.findLast((p) => visible(p.el.deref()) || !!p.to?.startsWith("file:") || !!p.el.deref()?.isConnected && !!p.to)
  let el = last?.el.deref()
  if (!visible(el) && last?.to) {
    const to = last.to, file = to.startsWith("file:") ? to.slice(5) : ""
    const now = () => { const e = last.el.deref(); if (visible(e)) return e; const ed = file ? currentEditor() : null; return ed?.path === file ? ed.view.dom : undefined }
    if (file) openFile(file); else openView(to.slice(5))
    for (let i = 0; i < 30 && !visible(el = now()); i++) await frame()
  }
  if (visible(el)) {
    const focusable = el.matches(".cm-editor") ? el.querySelector<HTMLElement>(".cm-content") : el
    focusable?.focus({ preventScroll: true })
    const t = await target()
    if (t) { t.final(text); t.end(); return true }
  }
  await copyText(text).then(() => notify("Copied: click where it goes, then paste"), () => notify("Click where it goes, then Insert again"))
  return false
}

let targetAt: () => Promise<DictationTarget | null> = async () => null
export const setTargetAt = (fn: typeof targetAt) => { targetAt = fn }

export function whereOf(t: DictationTarget): DictationWhere {
  if (t.path) return { kind: "note", path: t.path }
  const el = document.activeElement
  if (el?.closest("[data-terminal]")) return { kind: "terminal", name: "Terminal" }
  const named = el instanceof HTMLElement ? el.closest<HTMLElement>("[aria-label]")?.getAttribute("aria-label") || (el as HTMLInputElement).placeholder : ""
  return { kind: "field", ...(named ? { name: named.slice(0, 80) } : {}) }
}
