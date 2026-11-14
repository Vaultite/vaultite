import { get } from "@vaultite"
import { citationsInLine } from "./cite.ts"
import { formatCites } from "./client.ts"
import { safeHtml } from "./safe.ts"
import type { NoteAnswer } from "./wire.ts"
import "./citations.css"

const SKIP = "code, pre, a, .cm-line, .vau-citation, [contenteditable]"
type Found = { node: Text; from: number; to: number; source: string }

function found(root: HTMLElement): Found[] {
  const out: Found[] = []
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  })
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!(n instanceof Text) || !n.data.includes("@")) continue
    for (const c of citationsInLine(n.data)) out.push({ node: n, from: c.from, to: c.to, source: c.source })
  }
  return out
}

const notes = new Map<string, { at: number; answer: Promise<NoteAnswer> }>()
function noteOf(path: string) {
  const had = notes.get(path)
  if (had && Date.now() - had.at < 5000) return had.answer
  const answer = get<NoteAnswer>(`references/note?path=${encodeURIComponent(path)}`)
  notes.set(path, { at: Date.now(), answer })
  return answer
}

async function htmlFor(path: string, sources: string[]): Promise<string[]> {
  const queue = new Map<string, string[]>()
  if (path) {
    const note = await noteOf(path).catch(() => null)
    for (const c of note?.citations ?? []) queue.set(c.source, [...queue.get(c.source) ?? [], c.html])
  }
  const out = sources.map((s) => queue.get(s)?.shift() ?? null)
  const rest = sources.filter((_, i) => out[i] === null)
  if (!rest.length) return out.map((h) => h ?? "")
  const more = await formatCites(path, rest).catch(() => null)
  let n = 0
  return out.map((h) => h ?? more?.sources[n++] ?? "")
}

function place(f: Found[], html: string[]) {
  for (let i = f.length - 1; i >= 0; i--) {
    const { node, from, to } = f[i]
    if (!html[i] || !node.isConnected) continue
    const after = node.splitText(from)
    after.splitText(to - from)
    const span = document.createElement("span")
    span.className = html[i].includes("csl-missing") ? "vau-citation vau-citation-missing" : "vau-citation"
    span.dataset.citation = f[i].source
    span.innerHTML = safeHtml(html[i])
    after.replaceWith(span)
  }
}

export async function drawCitations(root: HTMLElement) {
  if (!(root.textContent ?? "").includes("@")) return
  const f = found(root)
  if (!f.length) return
  const path = root.closest("[data-note-body]")?.getAttribute("data-note-body") ?? root.closest("[data-markdown-from]")?.getAttribute("data-markdown-from") ?? ""
  place(f, await htmlFor(path, f.map((x) => x.source)))
}
