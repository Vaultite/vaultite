// Embeds on a line of their own and the kinds of files plugins draw (`formats`). No imports, so the editor, dashboards
// and core/files.ts can all use it.

/** A file a plugin that's on draws: the extension it's drawn by (maybe a double one: "excalidraw.md"), and whether it's
 *  a page (named and listed like a note: FileFormat.page). */
export type Drawn = { ext: string; page: boolean }
let lookup: (path: string) => Drawn | null = () => null
/** core/plugins.ts: what draws this file, by its extension. */
export const setFormatLookup = (fn: (path: string) => Drawn | null) => { lookup = fn }
const drawn = (path: string) => !!lookup(path)

/** The extension of a file a plugin that's on draws as a page (an artifact's "html", a table's "csv"), or null. */
export const pageExt = (path: string) => { const d = lookup(path); return d?.page ? d.ext : null }

let fences: (lang: string) => boolean = () => false
/** core/plugins.ts: whether a plugin that's on draws ```<lang> fences (`fences` in its definition: ```base). */
export const setFenceLookup = (fn: (lang: string) => boolean) => { fences = fn }
/** The block name a code fence is drawn as ("```base"), from its info line, or null when it's code. A plugin draws it
 *  (`fences`); BlockView and blockFor take the name as it is. */
export function fenceBlock(info: string): string | null {
  const lang = info.trim().split(/\s/)[0].toLowerCase()
  return lang && !lang.startsWith("block-") && fences(lang) ? `\`\`\`${lang}` : null
}

/** An embed's target split: the file, and what follows `#` in it ("Books.base#Reading" -> Books.base, Reading). */
export function embedParts(target: string): { name: string; sub?: string } {
  const i = target.indexOf("#")
  return i < 0 ? { name: target } : { name: target.slice(0, i), sub: target.slice(i + 1).trim() || undefined }
}

/** What the core embeds itself: PDFs, audio and video. */
const CORE = /^(pdf|mp3|m4a|aac|wav|ogg|oga|opus|flac|mp4|m4v|mov|webm|ogv)$/i
const LINE = /^!\[\[([^\]|#\n]+?\.([A-Za-z0-9]+))(#[^\]|\n]*)?(?:\|(\d+))?\]\][ \t]*$/

const extOf = (path: string) => /\.([A-Za-z0-9]+)$/.exec(path)?.[1].toLowerCase() ?? ""
/** A file an embed can show: the core's kinds, or one a plugin draws. */
export const isEmbeddable = (path: string) => CORE.test(extOf(path)) || drawn(path)

const NOTE = /^!\[\[([^\]|\n]+?)(?:\|[^\]\n]*)?\]\][ \t]*$/
/** A name with an extension that isn't .md (a letter first, so "v1.2" and "Dr. Sam" are names): a file, not a note. */
const FILE_EXT = /\.(?!md$)[A-Za-z][A-Za-z0-9]{0,9}$/i

/** `![[Finance/Spending.html|600]]` on its own line: its target and height, or `note: true` for a note or section;
 *  null otherwise (images are inline Markdown). A drawn Markdown file may be named without its .md. */
export function embedOf(line: string): { target: string; height?: number; note?: boolean } | null {
  // (a file a plugin draws may name a part of it: `![[Books.base#Reading]]`, kept in the target)
  const m = LINE.exec(line)
  if (m && ((CORE.test(m[2]) && !m[3]) || drawn(m[1]) || drawn(`${m[1]}.md`))) return { target: (m[1] + (m[3] ?? "")).trim(), height: m[4] ? Number(m[4]) : undefined }
  const n = NOTE.exec(line)
  const name = n ? n[1].split("#")[0].trim() : ""
  if (!n || FILE_EXT.test(name) || (!name && !n[1].includes("#"))) return null
  return { target: n[1].trim(), note: true }
}
