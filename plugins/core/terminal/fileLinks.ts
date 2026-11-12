import { getStore, linkClick, openFile } from "@vaultite"
import type { Link, Term } from "./vt/term"

let byTail: { tree: unknown; map: Map<string, string[]> } | null = null
function vaultFiles() {
  const tree = getStore()?.files
  if (!tree) return null
  if (byTail?.tree === tree) return byTail.map
  const map = new Map<string, string[]>()
  for (const { path } of [...tree.files, ...tree.others]) if (path.length >= 4) {
    const tail = path.slice(-4), list = map.get(tail)
    if (list) list.push(path); else map.set(tail, [path])
  }
  for (const list of map.values()) list.sort((a, b) => b.length - a.length)
  byTail = { tree, map }
  return map
}
const BOUND = /[\s"'`([<{=,]/

export function fileLinks(t: Term, y: number): Link[] | undefined {
  const row = t.s.line(y - 1)
  if (!row) return
  const { text, at } = row
  const files = vaultFiles(), vault = getStore()?.vault.path
  if (!files || !vault || !text.includes(".")) return
  const root = `${vault.replace(/\/+$/, "")}/`, links: Link[] = []
  for (const m of text.matchAll(/\.[\w-]{1,10}(?=$|[\s"'`)\]>}:;,!?.])/g)) {
    const end = m.index + m[0].length
    for (const path of files.get(text.slice(end - 4, end)) ?? []) {
      let start = end - path.length
      if (start < 0 || text.slice(start, end) !== path) continue
      if (text.slice(0, start).endsWith(root)) start -= root.length
      else if (text.slice(0, start).endsWith("./")) start -= 2
      if (start > 0 && !BOUND.test(text[start - 1])) continue
      if (links.length && at[start] <= links[links.length - 1].range.end.x - 1) break
      links.push({ text: path, range: { start: { x: at[start] + 1, y }, end: { x: at[end - 1] + 1, y } }, activate: (e) => openFile(path, { newTab: linkClick(e).newTab }) })
      break
    }
  }
  return links.length ? links : undefined
}
