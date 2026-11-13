// axLines runs in the page too, sent as source (pagetree.ts): it holds everything it uses.
import { shortUrl } from "./linktext.ts"

/** What changed between two trees, by what lines say, not their depth (a wrapper added moves nothing): a control whose
 *  line changed (its value, checked...) once as ~, then lines new (+), then gone (-), so a cut keeps what's new. */
export function changes(before: string[], after: string[]) {
  const plain = (l: string) => l.trim().replace(/^- /, "")
  const left = new Map<string, number>()
  for (const l of before) left.set(plain(l), (left.get(plain(l)) ?? 0) + 1)
  const added: string[] = []
  for (const l of after.map(plain)) {
    const n = left.get(l) ?? 0
    if (n) left.set(l, n - 1); else added.push(l)
  }
  const gone = before.map(plain).filter((l) => { const n = left.get(l) ?? 0; if (n) left.set(l, n - 1); return n > 0 })
  const refOf = (l: string) => /\[ref=(e\d+)\]/.exec(l)?.[1]
  const was = new Set(gone.map(refOf).filter(Boolean))
  const now = new Set(added.map(refOf).filter(Boolean))
  const both = (l: string) => { const r = refOf(l); return !!r && was.has(r) && now.has(r) }
  return [...added.filter(both).map((l) => `~ ${l}`), ...added.filter((l) => !both(l)).map((l) => `+ ${l}`), ...gone.filter((l) => !both(l)).map((l) => `- ${l}`)]
}

const AROUND_CONTENT = /^\s*- (navigation|banner|contentinfo|complementary)\b/
export function mainLines(lines: string[]) {
  const depth = (l: string) => l.length - l.trimStart().length
  const at = lines.findIndex((l) => /^\s*- main\b/.test(l))
  if (at >= 0) {
    const d = depth(lines[at]), end = lines.findIndex((l, i) => i > at && depth(l) <= d)
    return lines.slice(at + 1, end < 0 ? undefined : end).map((l) => l.slice(d + 2))
  }
  const out: string[] = []
  const root = /^- RootWebArea\b/.test(lines[0] ?? "")
  let skip = -1
  for (const l of root ? lines.slice(1) : lines) {
    if (skip >= 0 && depth(l) > skip) continue
    skip = AROUND_CONTENT.test(l) ? depth(l) : -1
    if (skip < 0) out.push(root ? l.slice(2) : l)
  }
  return out
}

export type AXValue = { value?: unknown }
export type AXNode = { nodeId: string; ignored?: boolean; role?: AXValue; name?: AXValue; value?: AXValue; childIds?: string[]; backendDOMNodeId?: number
  properties?: { name: string; value: AXValue }[] }
export const INTERACTIVE = new Set(["button", "link", "textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "menuitem",
  "menuitemcheckbox", "menuitemradio", "option", "tab", "treeitem", "listbox"])
export type Refs = { byRef: Map<string, number>; byNode: Map<number, string>; n: number
  // A list that reuses its rows (Gmail, Slack) can put another item in the same element.
  what: Map<string, { role: string; name: string }> }

export type LineKit = { short: (href: string, base: string) => string | null; interactive: Set<string> }

export function axLines(nodes: AXNode[], r: Refs, filled: (id: number) => boolean, scrub: (s: string) => string, base = "",
  kit: LineKit = { short: shortUrl, interactive: INTERACTIVE }): string[] {
  const SKIP = new Set(["none", "generic", "InlineTextBox", "LineBreak", "presentation", "LayoutTable", "LayoutTableRow", "LayoutTableCell", "MenuListPopup"])
  const MAX_TREE = 1_000_000, interactive = kit.interactive
  const linkTo = (role: string, name: string, url: string) => {
    const to = role === "link" && name ? kit.short(url, base) : null, said = name.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")
    return !to || said === to.toLowerCase() || (said.includes("/") && to.toLowerCase().endsWith(said)) ? "" : ` (→ ${to})`
  }
  const byId = new Map(nodes.map((n) => [n.nodeId, n]))
  const kids = new Set(nodes.flatMap((n) => n.childIds ?? []))
  const root = nodes.find((n) => !kids.has(n.nodeId)) ?? nodes[0]
  let size = 0
  const text = (v: AXValue | undefined) => (typeof v?.value === "string" ? v.value : v?.value == null ? "" : String(v.value)).replace(/\s+/g, " ").trim()
  const pad = (depth: number) => "  ".repeat(depth)
  const walk = (node: AXNode | undefined, depth: number, said: string | true): string[] => {
    if (!node || size > MAX_TREE) return []
    const role = text(node.role), name = text(node.name).slice(0, 200)
    const secret = !!node.backendDOMNodeId && filled(node.backendDOMNodeId)
    const shown = !node.ignored && !SKIP.has(role) && !(role === "StaticText" && !name)
    const under = (d: number, s: string | true) => (secret ? [] : (node.childIds ?? []).flatMap((c) => walk(byId.get(c), d, s)))
    if (!shown) return under(depth, said)
    if (role === "StaticText") {
      if (said === true || (said && said.includes(name))) return []
      const line = scrub(`${pad(depth)}- text "${name.replace(/"/g, "'")}"`)
      size += line.length + 1
      return [line]
    }
    const props = Object.fromEntries((node.properties ?? []).map((x) => [x.name, x.value?.value]))
    let line = `${pad(depth)}- ${role}${name ? ` "${name.replace(/"/g, "'")}"` : ""}${linkTo(role, name, text(node.properties?.find((x) => x.name === "url")?.value))}`
    const id = node.backendDOMNodeId
    let info = !!name
    if ((interactive.has(role) || (props.focusable === true && !!name)) && id) {
      let ref = r.byNode.get(id)
      if (!ref) { ref = `e${++r.n}`; r.byNode.set(id, ref); r.byRef.set(ref, id) }
      r.what.set(ref, { role, name })
      line += ` [ref=${ref}]`
      info = true
    }
    const value = secret || /^[•●*]+$/.test(text(node.value)) ? (text(node.value) ? "•••" : "") : text(node.value)
    if (value && value !== name) { line += `: ${value.slice(0, 200)}`; info = true }
    for (const k of ["checked", "pressed", "expanded", "selected", "disabled"]) if (props[k] === true || props[k] === "true" || props[k] === "mixed") { line += ` [${k}]`; info = true }
    const control = interactive.has(role) && !!name && !/^(textbox|searchbox|combobox|listbox)$/.test(role)
    let below = under(depth + 1, control ? true : name && role !== "RootWebArea" ? name : said)
    const top = (l: string) => l.startsWith(`${pad(depth + 1)}- `)
    const options = below.filter((l) => top(l) && /^\s*- option\b/.test(l))
    if (options.length > 15) {
      let shownOptions = 0
      below = below.filter((l) => !(top(l) && /^\s*- option\b/.test(l)) || /\[selected\]/.test(l) || shownOptions++ < 10)
      below.push(`${pad(depth + 1)}- … ${options.length - below.filter((l) => top(l) && /^\s*- option\b/.test(l)).length} more options`)
    }
    const tops = below.filter(top)
    if (!info && !below.length) return []
    if (tops.length === 1 && (!info || (!line.includes("[ref=") && name && new RegExp(`^\\s*- \\S+ "${name.replace(/"/g, "'").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`).test(tops[0])))) {
      return below.map((l) => l.slice(2))
    }
    if (!info && tops.length > 1 && tops.length <= 12 && tops.length === below.length) {
      const parts = below.map((l) => l.trim().replace(/^- (?:text|cell|gridcell|paragraph|StaticText) (?=")/, "").replace(/^- /, ""))
      const joined = `${pad(depth)}- ${role}: ${parts.join(" | ")}`
      if (joined.length < 500) return [joined]
    }
    line = scrub(line)
    size += line.length + 1
    return [line, ...below]
  }
  return walk(root, 0, "")
}
