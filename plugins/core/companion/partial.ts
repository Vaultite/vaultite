export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }
const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f" }

export function partialArgs(json: string): { whole: { [key: string]: Json }; keys: string[]; open?: { key: string; text: string } } {
  const whole: { [key: string]: Json } = {}, keys: string[] = []
  let i = 0
  const ws = () => { while (i < json.length && /\s/.test(json[i])) i++ }
  const str = (): { text: string; closed: boolean } => {
    let out = ""
    i++
    while (i < json.length) {
      const c = json[i]
      if (c === '"') { i++; return { text: out, closed: true } }
      if (c !== "\\") { out += c; i++; continue }
      const e = json[i + 1]
      if (e === undefined) break
      if (e === "u") {
        const hex = json.slice(i + 2, i + 6)
        if (hex.length < 4) break
        out += String.fromCharCode(parseInt(hex, 16))
        i += 6
      } else {
        out += ESCAPES[e] ?? e
        i += 2
      }
    }
    return { text: /[\uD800-\uDBFF]$/.test(out) ? out.slice(0, -1) : out, closed: false }
  }
  ws()
  if (json[i] !== "{") return { whole, keys }
  i++
  for (;;) {
    ws()
    if (json[i] === ",") { i++; ws() }
    if (json[i] !== '"') break
    const k = str()
    if (!k.closed) break
    ws()
    if (json[i] !== ":") break
    i++
    ws()
    if (i >= json.length) break
    keys.push(k.text)
    if (json[i] === '"') {
      const v = str()
      if (!v.closed) return { whole, keys, open: { key: k.text, text: v.text } }
      whole[k.text] = v.text
      continue
    }
    const start = i
    let depth = 0, quoted = false
    for (; i < json.length; i++) {
      const c = json[i]
      if (quoted) { if (c === "\\") i++; else if (c === '"') quoted = false; continue }
      if (c === '"') quoted = true
      else if (c === "{" || c === "[") depth++
      else if (c === "}" || c === "]") { if (depth === 0) break; depth-- }
      else if (c === "," && depth === 0) break
    }
    if (i >= json.length) { keys.pop(); break }
    try { whole[k.text] = JSON.parse(json.slice(start, i)) } catch { keys.pop(); break }
  }
  return { whole, keys }
}
