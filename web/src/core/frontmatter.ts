// A file's properties edited one key at a time with the server's YAML and small edit (core/yaml.ts, core/textedit.ts),
// so a file reads and writes the same whoever changes it (tools/test_web.ts checks).
import { blocks, patchFrontmatter, renameKey } from "../../../core/textedit.ts"
import { dates, dump, load } from "../../../core/yaml.ts"
import { blocksIn } from "../../../core/sections.ts"
import { activeFile } from "@/core/active"
import { put } from "@/core/http"
import { readFile, splitFm, type FileText } from "@/core/files"

export type Props = Record<string, unknown>

/** The YAML between the --- lines of a frontmatter block ("---\n...\n---\n"). */
export const innerOf = (block: string) => block.replace(/^---\n/, "").replace(/\n?---[ \t]*\n*$/, "")
/** A block around `inner`, keeping the blank line that followed the old block (`like`), if it had one. */
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

/** A note's properties and body, as a block or a page draws it (`FileCtx`'s `fm` and `body`). */
export function noteParts(text: string): { fm: Props; body: string } {
  const { fm, body } = splitFm(text)
  return { fm: readProps(fm).props, body }
}

/** One key as YAML, the way the server writes it: lists of plain values inline ([a, b]), dates plain, strings quoted
 *  only when they must be. */
export const dumpKey = (key: string, value: unknown) => dump({ [key]: dates(value) })

const loadProps = (text: string) => (load(text) ?? {}) as Props

/** The frontmatter block with `key` set to `value` (undefined removes it). New keys go at the end. */
export function setProp(block: string, key: string, value: unknown): string {
  const { props } = readProps(block)
  const inner = patchFrontmatter(innerOf(block), props, value === undefined ? {} : { [key]: dates(value) },
    value === undefined ? [key] : [], [], (k, v) => dump({ [k]: v }), loadProps)
  if (inner !== null) return blockOf(inner, block)
  // It doesn't patch line by line (unusual YAML): write the whole header.
  const want = { ...props }
  if (value === undefined) delete want[key]; else want[key] = value
  return blockOf(Object.keys(want).length ? dump(dates(want) as Props) : "", block)
}

/** Rename a key, keeping its place and value. */
export function renameProp(block: string, from: string, to: string): string {
  const { props } = readProps(block)
  if (!(from in props) || to in props || !to.trim()) return block
  // Only the key's text, when it can (its value's lines stay as they were written).
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

/** Replace the text inside a file's `nth` block named `name` (a block's options written from a drawn page), the same
 *  small edit as setProperty. */
export async function setBlockText(path: string, name: string, nth: number, inner: string) {
  const open = activeFile()
  const f = open?.path === path ? { text: open.text() } : await readFile(path)
  const b = blocksIn(f.text).filter((x) => x.name === name)[nth]
  if (!b) throw new Error(`its block isn't in ${path} any more`)
  const lines = f.text.split("\n")
  lines.splice(b.open + 1, b.close - b.open - 1, ...(inner ? inner.split("\n") : []))
  const text = lines.join("\n")
  if (text === f.text) return
  if (open?.path === path) { open.setText(text); await open.settle() }
  else await put<FileText>("file", { path, text, base: f.text })
}

/** Typed text as a number only when it's written the way the number is ("12", "-3.5"); "007", "1.50", "1e3" or "0x1F"
 *  stay the text they are. */
export function typedNumber(s: string): number | string | null {
  const t = s.trim()
  if (t === "") return null
  const n = Number(t)
  return Number.isFinite(n) && String(n) === t ? n : s
}

const DATETIME = /^(\d{4}-\d\d-\d\d)(?:([ T])(\d\d:\d\d)(?::(\d\d)(\.\d+)?)?)?(Z|[+-]\d\d:?\d\d)?$/

/** A date and time as a datetime-local input takes it ("2026-09-27T18:00", with its seconds when it has them). */
export function toLocal(v: string) {
  const m = DATETIME.exec(v.trim())
  if (!m) return v.trim().replace(" ", "T").slice(0, 16)
  return `${m[1]}T${m[3] ?? "00:00"}${m[4] !== undefined ? `:${m[4]}` : ""}`
}

/** The input's value written the way `was` is: its separator, its seconds (and their fraction while they're the same)
 *  and its offset kept, so editing the time changes only the time. */
export function fromLocal(s: string, was: string) {
  const [, date, , hm, sec] = DATETIME.exec(s) ?? []
  if (!date) return s.replace("T", " ")
  const m = DATETIME.exec(was.trim())
  const seconds = sec ?? (m?.[4] !== undefined ? "00" : undefined)
  const frac = m?.[5] && seconds === m[4] ? m[5] : ""
  return `${date}${m?.[2] ?? " "}${hm ?? "00:00"}${seconds !== undefined ? `:${seconds}${frac}` : ""}${m?.[6] ?? ""}`
}
