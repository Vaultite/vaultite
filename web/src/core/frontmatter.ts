import { blocks, patchFrontmatter, renameKey } from "../../../core/textedit.ts"
import { dates, dump, load } from "../../../core/yaml.ts"
import { blocksIn, scan } from "../../../core/sections.ts"
import { activeFile } from "@/core/active"
import { put } from "@/core/http"
import { readFile, splitFm, type FileText } from "@/core/files"

export type Props = Record<string, unknown>

export const innerOf = (block: string) => block.replace(/^---\n/, "").replace(/\n?---[ \t]*\n*$/, "")
const blockOf = (inner: string, like = "") =>
  (inner.trim() ? `---\n${inner.replace(/\n+$/, "")}\n---\n${/---[ \t]*\n\n$/.test(like) ? "\n" : ""}` : "")

export function readProps(block: string): { props: Props; error: string | null } {
  if (!block) return { props: {}, error: null }
  try {
    const v = load(innerOf(block))
    if (v === null || v === undefined) return { props: {}, error: null }
    if (typeof v !== "object" || Array.isArray(v)) return { props: {}, error: "The properties aren't a list of key: value lines." }
    return { props: v as Props, error: null }
  } catch (e) {
    return { props: {}, error: String((e as Error).message ?? e).split("\n")[0] }
  }
}

export function noteParts(text: string): { fm: Props; body: string } {
  const { fm, body } = splitFm(text)
  return { fm: readProps(fm).props, body }
}

export const dumpKey = (key: string, value: unknown) => dump({ [key]: dates(value) })

const loadProps = (text: string) => (load(text) ?? {}) as Props

export function setProp(block: string, key: string, value: unknown): string {
  const { props } = readProps(block)
  const inner = patchFrontmatter(innerOf(block), props, value === undefined ? {} : { [key]: dates(value) },
    value === undefined ? [key] : [], [], (k, v) => dump({ [k]: v }), loadProps)
  if (inner !== null) return blockOf(inner, block)
  const want = { ...props }
  if (value === undefined) delete want[key]; else want[key] = value
  return blockOf(Object.keys(want).length ? dump(dates(want) as Props) : "", block)
}

export function renameProp(block: string, from: string, to: string): string {
  const { props } = readProps(block)
  if (!(from in props) || to in props || !to.trim()) return block
  const inner = renameKey(innerOf(block), from, to, loadProps)
  if (inner !== null) return blockOf(inner, block)
  const bs = blocks(innerOf(block))
  const at = bs.findIndex((b) => b.key === from)
  if (at < 0) return block
  bs[at] = { key: to, lines: dumpKey(to, props[from]).split("\n") }
  return blockOf(bs.flatMap((b) => b.lines).join("\n"), block)
}

export type PropKind = "text" | "number" | "checkbox" | "list" | "date" | "complex"
export function propKind(v: unknown): PropKind {
  if (typeof v === "boolean") return "checkbox"
  if (typeof v === "number") return "number"
  if (Array.isArray(v)) return v.every((x) => x === null || typeof x !== "object") ? "list" : "complex"
  if (v !== null && typeof v === "object") return "complex"
  if (typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v)) return "date"
  return "text"
}

/** Set one property of a file on disk (undefined removes it) as a small edit with its `base`, for blocks that edit a
 *  value in place (a database cell). The file being edited changes in its editor instead, so ⌘Z undoes it there. */
export async function setProperty(path: string, key: string, value: unknown) {
  const open = activeFile()
  const f = open?.path === path ? { text: open.text() } : await readFile(path)
  const { fm, body } = splitFm(f.text)
  const block = setProp(fm || "---\n---\n", key, value)
  const text = fm ? block + body : `${block}${block && body && !body.startsWith("\n") ? "\n" : ""}${body}`
  if (text === f.text) return
  if (open?.path === path) { open.setText(text); await open.settle() }
  else await put<FileText>("file", { path, text, base: f.text })
}

export async function setBlockText(path: string, name: string, nth: number, inner: string) {
  const open = activeFile()
  const f = open?.path === path ? { text: open.text() } : await readFile(path)
  const b = name.startsWith("```")
    ? scan(f.text).fences.filter((x) => x.close !== null && x.info.split(/\s/)[0].toLowerCase() === name.slice(3)).map((x) => ({ open: x.open, close: x.close! }))[nth]
    : blocksIn(f.text).filter((x) => x.name === name)[nth]
  if (!b) throw new Error(`its block isn't in ${path} any more`)
  const lines = f.text.split("\n")
  lines.splice(b.open + 1, b.close - b.open - 1, ...(inner ? inner.split("\n") : []))
  const text = lines.join("\n")
  if (text === f.text) return
  if (open?.path === path) { open.setText(text); await open.settle() }
  else await put<FileText>("file", { path, text, base: f.text })
}

export function typedNumber(s: string): number | string | null {
  const t = s.trim()
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) && String(n) === t ? n : s
}

const DATETIME = /^(\d{4}-\d\d-\d\d)(?:([ T])(\d\d:\d\d)(?::(\d\d)(\.\d+)?)?)?(Z|[+-]\d\d:?\d\d)?$/

export function toLocal(v: string) {
  const m = DATETIME.exec(v.trim())
  if (!m) return v.trim().replace(" ", "T").slice(0, 16)
  return `${m[1]}T${m[3] ?? "00:00"}${m[4] !== undefined ? `:${m[4]}` : ""}`
}

export function fromLocal(s: string, was: string) {
  const [, date, , hm, sec] = DATETIME.exec(s) ?? []
  if (!date) return s.replace("T", " ")
  const m = DATETIME.exec(was.trim())
  const seconds = sec ?? (m?.[4] !== undefined ? "00" : undefined)
  const frac = m?.[5] && seconds === m[4] ? m[5] : ""
  return `${date}${m?.[2] ?? " "}${hm ?? "00:00"}${seconds !== undefined ? `:${seconds}${frac}` : ""}${m?.[6] ?? ""}`
}
