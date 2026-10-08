// JSON with where each value sits in the text: keys keep their order (a JS object would reorder numeric keys) and an
// edit replaces only the value's characters, the same small-edit rule as Markdown.

export type JScalar = { kind: "string"; value: string } | { kind: "number"; value: number } | { kind: "boolean"; value: boolean } | { kind: "null"; value: null }
export type JNode = (
  | JScalar
  | { kind: "object"; entries: { key: string; value: JNode }[] }
  | { kind: "array"; items: JNode[] }
) & { start: number; end: number }

/** The tree of `text`, or the parse error. */
export function parseJson(text: string): { node: JNode } | { error: string } {
  try { JSON.parse(text) } catch (e) { return { error: String((e as Error).message ?? e) } }
  let i = 0
  const ws = () => { while (i < text.length && " \t\n\r".includes(text[i])) i++ }
  const str = (): [string, number] => {
    const s = i
    i++
    while (text[i] !== '"') i += text[i] === "\\" ? 2 : 1
    i++
    return [JSON.parse(text.slice(s, i)) as string, s]
  }
  const value = (): JNode => {
    ws()
    const s = i, c = text[i]
    if (c === "{") {
      i++
      const entries: { key: string; value: JNode }[] = []
      ws()
      while (text[i] !== "}") {
        const [key] = str()
        ws(); i++ // :
        entries.push({ key, value: value() })
        ws()
        if (text[i] === ",") { i++; ws() }
      }
      i++
      return { kind: "object", entries, start: s, end: i }
    }
    if (c === "[") {
      i++
      const items: JNode[] = []
      ws()
      while (text[i] !== "]") {
        items.push(value())
        ws()
        if (text[i] === ",") { i++; ws() }
      }
      i++
      return { kind: "array", items, start: s, end: i }
    }
    if (c === '"') { const [v] = str(); return { kind: "string", value: v, start: s, end: i } }
    for (const [word, v] of [["true", true], ["false", false], ["null", null]] as const) {
      if (text.startsWith(word, i)) {
        i += word.length
        return v === null ? { kind: "null", value: null, start: s, end: i } : { kind: "boolean", value: v, start: s, end: i }
      }
    }
    const m = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y
    m.lastIndex = i
    const num = m.exec(text)![0]
    i += num.length
    return { kind: "number", value: Number(num), start: s, end: i }
  }
  return { node: value() }
}

/** `text` with one value replaced. Strings are escaped like the rest of the file (a file written with ASCII escapes, é, keeps them). */
export function setJson(text: string, node: JNode, next: string | number | boolean | null): string {
  let raw = JSON.stringify(next)
  if (typeof next === "string" && /\\u[0-9a-fA-F]{4}/.test(text) && !/[^\x00-\x7f]/.test(text))
    raw = raw.replace(/[^\x00-\x7f]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`)
  return text.slice(0, node.start) + raw + text.slice(node.end)
}
