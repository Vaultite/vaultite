import { BLOCK_ID, scan } from "./sections.ts"

export type NoteBlock = { line: number; end: number; text: string; id?: string; kind: "paragraph" | "list" }

const ATX = /^ {0,3}#{1,6}(?:[ \t]|$)/
const LIST = /^([ \t]*)(?:[-*+]|\d+[.)])(?:[ \t]+(?:\[.\][ \t]+)?|$)/
const OTHER = /^\s*(?:>|\||<|\$\$|%%|(?:[-*_][ \t]*){3,}$|\[\^[^\]]+\]:)/
const OWN_ID = /^\s*\^([A-Za-z0-9-]+)\s*$/

const shown = (l: string) => l.replace(/\r$/, "").replace(BLOCK_ID, "").replace(LIST, "").trim()

type Scanned = { lines: string[]; plain: (i: number) => boolean }

function blockFrom({ lines, plain }: Scanned, i: number): NoteBlock | null {
  const li = !!LIST.exec(lines[i]), goes = (j: number) => plain(j) && !LIST.test(lines[j]) && !OWN_ID.test(lines[j]) && (!li || /^[ \t]+/.test(lines[j]))
  let end = i + 1
  while (end < lines.length && goes(end)) end++
  const id = BLOCK_ID.exec(lines[end - 1].replace(/\r$/, ""))?.[1]
  const words = lines.slice(i, end).map(shown).filter(Boolean).join(" ")
  return words || id ? { line: i, end, text: words, kind: li ? "list" : "paragraph", id } : null
}

export function blocksOf(text: string): NoteBlock[] {
  const { lines, prose } = scan(text)
  const s: Scanned = { lines, plain: (i) => prose[i] && !!lines[i].trim() && !ATX.test(lines[i]) && !OTHER.test(lines[i]) }
  const out: NoteBlock[] = []
  for (let i = 0; i < lines.length;) {
    const own = prose[i] ? OWN_ID.exec(lines[i]) : null, last = out[out.length - 1]
    if (own && last?.end === i && !last.id) last.id = own[1]
    const b = own || !s.plain(i) ? null : blockFrom(s, i)
    if (b) out.push(b)
    i = b ? b.end : i + 1
  }
  return out
}

export const blockAt = (text: string, line: number): NoteBlock | null => blocksOf(text).find((b) => b.line <= line && line < b.end) ?? null

export function blockIdAt(text: string, b: NoteBlock): number {
  const lines = text.split("\n"), i = b.end - 1
  return lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0) + lines[i].replace(/\r$/, "").replace(/[ \t]+$/, "").length
}

export function withBlockId(text: string, b: NoteBlock, id: string): string {
  const at = blockIdAt(text, b)
  return `${text.slice(0, at)} ^${id}${text.slice(at)}`
}

export function newBlockId(taken: (id: string) => boolean = () => false): string {
  const abc = "abcdefghijklmnopqrstuvwxyz0123456789"
  for (;;) {
    const id = Array.from(crypto.getRandomValues(new Uint8Array(6)), (n) => abc[n % abc.length]).join("")
    if (!taken(id)) return id
  }
}

export function findBlockByText(blocks: NoteBlock[], words: string, line?: number): NoteBlock | NoteBlock[] | null {
  const w = words.replace(/\s+/g, " ").trim().toLowerCase()
  if (!w) return null
  const exact = blocks.filter((b) => b.text.toLowerCase() === w), hits = exact.length ? exact : blocks.filter((b) => b.text.toLowerCase().includes(w))
  if (hits.length > 1 && line !== undefined) return hits.find((b) => b.line <= line && line < b.end) ?? hits
  return hits.length === 1 ? hits[0] : hits.length ? hits : null
}
