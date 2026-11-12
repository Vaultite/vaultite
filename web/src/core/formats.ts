export type Drawn = { ext: string; page: boolean }
let lookup: (path: string) => Drawn | null = () => null
export const setFormatLookup = (fn: (path: string) => Drawn | null) => { lookup = fn }
const drawn = (path: string) => !!lookup(path)

export const pageExt = (path: string) => { const d = lookup(path); return d?.page ? d.ext : null }

let fences: (lang: string) => boolean = () => false
export const setFenceLookup = (fn: (lang: string) => boolean) => { fences = fn }
export function fenceBlock(info: string): string | null {
  const lang = info.trim().split(/\s/)[0].toLowerCase()
  return lang && !lang.startsWith("block-") && fences(lang) ? `\`\`\`${lang}` : null
}

export function embedParts(target: string): { name: string; sub?: string } {
  const i = target.indexOf("#")
  return i < 0 ? { name: target } : { name: target.slice(0, i), sub: target.slice(i + 1).trim() || undefined }
}

const CORE = /^(pdf|mp3|m4a|m4b|aac|wav|ogg|oga|opus|flac|mp4|m4v|mov|webm|ogv)$/i
const LINE = /^!\[\[([^\]|#\n]+?\.([A-Za-z0-9]+))(#[^\]|\n]*)?(?:\|(\d+))?\]\][ \t]*$/

const extOf = (path: string) => /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? ""
export const isEmbeddable = (path: string) => CORE.test(extOf(path)) || drawn(path)

const NOTE = /^!\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\][ \t]*$/
const FILE_EXT = /\.(?!md$)[A-Za-z][A-Za-z0-9]{0,9}$/i

export function embedOf(line: string): { target: string; height?: number; note?: boolean } | null {
  const m = LINE.exec(line)
  if (m && ((CORE.test(m[2]) && !m[3]) || drawn(m[1]) || drawn(`${m[1]}.md`))) return { target: (m[1] + (m[3] ?? "")).trim(), height: m[4] ? Number(m[4]) : undefined }
  const n = NOTE.exec(line)
  const name = n ? n[1].split("#")[0].trim() : ""
  if (!n || FILE_EXT.test(name) || (!name && !n[1].includes("#"))) return null
  return { target: n[1].trim(), note: true }
}
