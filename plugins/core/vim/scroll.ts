import type { EditorView } from "@codemirror/view"
import { currentFile, editorAt, glide, runCommandById, sightOf } from "@vaultite"
import { setPeek } from "./state"

const LINE = 60

// (The sizes first: they're cheap, the styles aren't.)
const scrollsY = (el: Element) => el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)
const scrollsX = (el: Element) => el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)
const shown = (el: Element) => !(el instanceof HTMLElement) || el.offsetParent !== null || getComputedStyle(el).position === "fixed"

export const openSheet = () => [...document.querySelectorAll<HTMLElement>("dialog[open]")].find(shown) ?? null

export const focusedRoot = (): HTMLElement | null => openSheet() ?? document.getElementById("main-scroll")

function biggest(root: HTMLElement, test: (el: Element) => boolean) {
  if (test(root)) return root
  let best: HTMLElement | null = null, area = 0
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    if (!test(el) || !shown(el)) continue
    const a = el.clientWidth * el.clientHeight
    if (a > area) { area = a; best = el }
  }
  return best
}

export function scroller() {
  const root = focusedRoot()
  return root ? biggest(root, scrollsY) : null
}

export function scroll(by: "line" | "half" | "page", dir: 1 | -1) {
  const el = scroller()
  if (!el) return
  const step = by === "line" ? LINE : by === "half" ? el.clientHeight / 2 : el.clientHeight - LINE
  el.scrollBy({ top: dir * step, behavior: by === "line" ? "auto" : glide() })
}

export function scrollSide(dir: 1 | -1) {
  const root = focusedRoot()
  const el = root && biggest(root, scrollsX)
  el?.scrollBy({ left: dir * LINE, behavior: "auto" })
}

export function scrollEdge(top: boolean) {
  const el = scroller()
  el?.scrollTo({ top: top ? 0 : el.scrollHeight, behavior: "auto" })
}

export function mainEditor(root = document.getElementById("main-scroll")): EditorView | null {
  if (!root) return null
  for (const el of root.querySelectorAll<HTMLElement>(".cm-editor")) {
    if (el.parentElement?.closest(".cm-editor")) continue
    const v = editorAt(el)?.view
    if (v) return v
  }
  return null
}

function headingTops(el: HTMLElement) {
  const box = el.getBoundingClientRect()
  const tops: number[] = []
  const view = mainEditor(el)
  if (view) {
    const doc = view.state.doc
    let fence: string | null = null
    for (let i = 1; i <= doc.lines; i++) {
      const line = doc.line(i)
      const f = /^\s*(`{3,}|~{3,})/.exec(line.text)
      if (f) { if (!fence) fence = f[1][0]; else if (f[1][0] === fence) fence = null; continue }
      if (fence || !/^#{1,6}\s/.test(line.text)) continue
      tops.push(view.lineBlockAt(line.from).top + view.documentTop - box.top + el.scrollTop)
    }
  }
  if (!view) for (const h of el.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")) {
    if (h.closest(".cm-content") || !shown(h)) continue
    tops.push(h.getBoundingClientRect().top - box.top + el.scrollTop)
  }
  return tops.sort((a, b) => a - b)
}

export function heading(dir: 1 | -1) {
  const el = scroller()
  if (!el) return
  const below = Math.max(0, sightOf(el.firstElementChild ?? el).top - el.getBoundingClientRect().top) + 12
  const at = el.scrollTop + below
  const tops = headingTops(el)
  const to = dir > 0 ? tops.find((t) => t > at + 2) : [...tops].reverse().find((t) => t < at - 2)
  if (to !== undefined) el.scrollTo({ top: Math.max(0, to - below), behavior: "auto" })
}

function lineInSight(view: EditorView, el: HTMLElement) {
  const top = el.getBoundingClientRect().top
  const height = Math.max(0, top - view.documentTop)
  let block = view.lineBlockAtHeight(height)
  if (block.top + view.documentTop < top - 2 && block.to < view.state.doc.length) block = view.lineBlockAt(block.to + 1)
  return block.from
}

export function editHere() {
  const path = currentFile()
  const view = mainEditor()
  if (view?.contentDOM.contentEditable === "true") {
    const el = scroller() ?? document.getElementById("main-scroll")
    const head = view.state.selection.main.head, box = el?.getBoundingClientRect()
    const y = view.coordsAtPos(head)?.top
    const seen = !box || (y !== undefined && y >= box.top && y < box.bottom)
    if (!seen && el) view.dispatch({ selection: { anchor: lineInSight(view, el) } })
    view.contentDOM.focus({ preventScroll: true })
    return
  }
  runCommandById("view:toggle")
  if (view && path) setPeek(path)
}
