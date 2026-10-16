// ChatGPT's Intelligent UI markup (DIL): Markdown with JSX-like tags, {expr}, {@body js}, {#each}/{#if} blocks and
// <AppBlock> apps, read into a tree. No Node and no eval here: the server, the app and the sandbox all read it.

export type Part = string | { e: string } | { el: Node }
export type Prop = { name: string; str?: string; e?: string } | { spread: string }
export type Node =
  | { t: "md"; parts: Part[] }
  | { t: "body"; js: string }
  | { t: "el"; name: string; props: Prop[]; kids: Node[] }
  | { t: "app"; props: Prop[]; html: string }
  | { t: "each"; list: string; as: string; index?: string; key?: string; kids: Node[] }
  | { t: "if"; branches: { test: string | null; kids: Node[] }[] }

/** The line a fence keeps its live values on (`{@state {"selected":"G"}}`), the app's, never the model's. */
const STATE = /^[ \t]*\{@state[ \t]+(\{.*\})\}[ \t]*$/m
/** What ChatGPT filled in on its side (tool results by name, citations, found images), kept on a `{@data …}` line. */
const DATA = /^[ \t]*\{@data[ \t]+(\{.*\})\}[ \t]*$/m
export type Data = { bindings?: Record<string, unknown>; refs?: Record<string, { url: string; title?: string; source?: string }>; images?: { url: string; alt?: string }[][]
  maps?: { name: string; lat: number; lon: number; address?: string; category?: string }[][] }

/** Where the JS starting at `i` ends: the index of the `close` that ends it at depth 0, skipping strings, templates,
 *  comments and regexes; -1 when it never does. */
export function jsEnd(src: string, i: number, close = "}"): number {
  const stack: string[] = []
  let prev = "(" // the last significant character: whether a / starts a regex
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === "/" && src[i + 1] === "/") { const n = src.indexOf("\n", i); if (n < 0) return -1; i = n; continue }
    if (c === "/" && src[i + 1] === "*") { const n = src.indexOf("*/", i + 2); if (n < 0) return -1; i = n + 1; continue }
    if (c === '"' || c === "'") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++
      prev = c; continue
    }
    if (c === "`") {
      for (i++; i < src.length && src[i] !== "`"; i++) {
        if (src[i] === "\\") i++
        else if (src[i] === "$" && src[i + 1] === "{") { const e = jsEnd(src, i + 2); if (e < 0) return -1; i = e }
      }
      prev = "`"; continue
    }
    if (c === "/" && /[(,=:[!&|?{};+\-*%<>~^]/.test(prev)) {
      let cls = false
      for (i++; i < src.length && src[i] !== "\n"; i++) {
        if (src[i] === "\\") i++
        else if (src[i] === "[") cls = true
        else if (src[i] === "]") cls = false
        else if (src[i] === "/" && !cls) break
      }
      prev = "/"; continue
    }
    if (c === "(" || c === "[" || c === "{") stack.push(c === "(" ? ")" : c === "[" ? "]" : "}")
    else if (c === ")" || c === "]" || c === "}") {
      if (!stack.length) return c === close ? i : -1
      if (stack.pop() !== c) return -1
    }
    if (!/\s/.test(c)) prev = c
  }
  return -1
}

const NAME = /^[A-Za-z][\w.-]*/
/** Tags that sit inside a line of text (`The <Entity value="X"/> is…`): drawn in its paragraph, not as a block. */
const INLINE = new Set(["Entity", "Cite", "Link", "link", "a", "bold", "strong", "b", "i", "em", "italic", "code", "kbd", "span", "badge", "icon", "mark", "sup", "sub", "br"])
const ATTR = /^[A-Za-z_:@$][\w:.@$-]*/

type Tag = { name: string; props: Prop[]; self: boolean; end: number }

/** The opening tag at `i` (`<box gap={3}>`, `<icon name="copy"/>`), or null when it isn't one. */
function openTag(src: string, i: number): Tag | null {
  const m = NAME.exec(src.slice(i + 1, i + 80))
  if (!m) return null
  const name = m[0]
  let j = i + 1 + name.length
  const props: Prop[] = []
  for (;;) {
    while (/\s/.test(src[j] ?? "")) j++
    if (j >= src.length) return null
    if (src[j] === ">") return { name, props, self: false, end: j + 1 }
    if (src[j] === "/" && src[j + 1] === ">") return { name, props, self: true, end: j + 2 }
    if (src[j] === "{") {
      const e = jsEnd(src, j + 1)
      if (e < 0) return null
      const inner = src.slice(j + 1, e).trim()
      if (!inner.startsWith("...")) return null
      props.push({ spread: inner.slice(3) })
      j = e + 1
      continue
    }
    const a = ATTR.exec(src.slice(j, j + 80))
    if (!a) return null
    j += a[0].length
    while (src[j] === " " || src[j] === "\t") j++
    if (src[j] !== "=") { props.push({ name: a[0], e: "true" }); continue }
    j++
    while (src[j] === " " || src[j] === "\t") j++
    const q = src[j]
    if (q === '"' || q === "'") {
      const e = src.indexOf(q, j + 1)
      if (e < 0) return null
      props.push({ name: a[0], str: unescapeAttr(src.slice(j + 1, e)) })
      j = e + 1
    } else if (q === "{") {
      const e = jsEnd(src, j + 1)
      if (e < 0) return null
      props.push({ name: a[0], e: src.slice(j + 1, e) })
      j = e + 1
    } else {
      const v = /^[^\s/>]+/.exec(src.slice(j))
      if (!v) return null
      props.push({ name: a[0], str: v[0] })
      j += v[0].length
    }
  }
}

const unescapeAttr = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&")

/** Lines' shared indentation taken off (text inside tags is indented with them, which Markdown would read as code). */
function dedent(s: string): string {
  const lines = s.split("\n")
  const ind = lines.filter((l) => l.trim()).map((l) => /^[ \t]*/.exec(l)![0].length)
  const n = ind.length ? Math.min(...ind) : 0
  return n ? lines.map((l) => l.slice(Math.min(n, /^[ \t]*/.exec(l)![0].length))).join("\n") : s
}

type Frame = { name: string; kids: Node[]; node: Node | null; branch?: { test: string | null; kids: Node[] }[] }

/** DIL source read into its tree. It never throws: what doesn't parse is text. `span` gets where its DIL starts and
 *  ends (offsets), [-1, -1] for none. */
export function parse(src: string, span?: [number, number]): Node[] {
  const mark = (a: number, b: number) => { if (span) { if (span[0] < 0 || a < span[0]) span[0] = a; if (b > span[1]) span[1] = b } }
  if (span) { span[0] = -1; span[1] = -1 }
  const root: Frame = { name: "", kids: [], node: null }
  const stack: Frame[] = [root]
  const top = () => stack[stack.length - 1]
  let text: Part[] = []
  let buf = ""
  const flushBuf = () => { if (buf) { text.push(buf); buf = "" } }
  const flush = () => {
    flushBuf()
    if (!text.some((p) => typeof p !== "string" || p.trim())) { text = []; return }
    // Indentation from the tags around it, taken off the text's literal pieces together.
    const joined = text.map((p) => (typeof p === "string" ? p : "\u0000")).join("")
    const ded = dedent(joined).replace(/^\s*\n|\n\s*$/g, "")
    const pieces = ded.split("\u0000")
    const exprs = text.filter((p) => typeof p !== "string")
    const parts: Part[] = []
    pieces.forEach((s, k) => { if (s) parts.push(s); if (k < exprs.length) parts.push(exprs[k]) })
    top().kids.push({ t: "md", parts })
    text = []
  }
  const close = (name: string) => {
    for (let k = stack.length - 1; k > 0; k--) if (stack[k].name === name) { flush(); stack.length = k; return true }
    return false
  }
  let i = 0
  let lineStart = true
  while (i < src.length) {
    const c = src[i]
    // A Markdown code fence: as it is, to its end.
    if (lineStart) {
      const f = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*/.exec(src.slice(i, i + 200))
      if (f) {
        const mark = f[1]
        let j = src.indexOf("\n", i)
        let end = src.length
        while (j >= 0) {
          const n = src.indexOf("\n", j + 1)
          const l = src.slice(j + 1, n < 0 ? src.length : n)
          if (l.trim().startsWith(mark[0].repeat(mark.length)) && !l.trim().slice(mark.length).trim()) { end = n < 0 ? src.length : n; break }
          j = n
        }
        buf += src.slice(i, end)
        i = end
        lineStart = false
        continue
      }
    }
    lineStart = c === "\n"
    if (c === "\\" && (src[i + 1] === "{" || src[i + 1] === "<")) { buf += src.slice(i, i + 2); i += 2; continue }
    // Inline code and math stay text: a `{` or `<` in them is the writer's.
    if (c === "`") {
      const run = /^`+/.exec(src.slice(i))![0]
      const e = src.indexOf(run, i + run.length)
      if (e > 0 && !src.slice(i, e).includes("\n\n")) { buf += src.slice(i, e + run.length); i = e + run.length; continue }
      buf += run; i += run.length; continue
    }
    if (c === "$") {
      const d = src[i + 1] === "$" ? "$$" : "$"
      const e = src.indexOf(d, i + d.length)
      if (e > i + d.length && (d === "$$" || !src.slice(i, e).includes("\n")) && !/^\$\d/.test(src.slice(i, i + 2))) { buf += src.slice(i, e + d.length); i = e + d.length; continue }
    }
    if (c === "{") {
      // ({/each} and {:else} hold no JS: a / there isn't a regex)
      const e = /[/:]/.test(src[i + 1] ?? "") ? src.indexOf("}", i) : jsEnd(src, i + 1)
      if (e > i + 1) {
        const inner = src.slice(i + 1, e)
        const head = inner.trimStart()
        const done = () => { mark(i, e + 1); i = e + 1; if (src[i] === "\n" && !buf.trim() && !text.length) { i++; lineStart = true } }
        if (head.startsWith("@")) {
          const m = /^@(\w+)\s*([\s\S]*)$/.exec(head)
          const word = m?.[1] ?? "", rest = (m?.[2] ?? "").trim()
          if (word === "state" || word === "data") { done(); continue }
          flush()
          top().kids.push({ t: "body", js: word === "body" || word === "js" ? rest : word === "const" || word === "let" ? `${word} ${rest}` : rest })
          done(); continue
        }
        if (head.startsWith("#each")) {
          const m = /^#each\s+([\s\S]+?)\s+as\s+([\s\S]+?)\s*(?:\(([\s\S]+)\))?\s*$/.exec(head)
          if (m) {
            flush()
            const [as, index] = splitPattern(m[2])
            const node: Node = { t: "each", list: m[1], as, index, key: m[3], kids: [] }
            top().kids.push(node)
            stack.push({ name: "#each", kids: node.kids, node })
            done(); continue
          }
        }
        if (head.startsWith("#if")) {
          flush()
          const node: Node = { t: "if", branches: [{ test: head.slice(3).trim(), kids: [] }] }
          top().kids.push(node)
          stack.push({ name: "#if", kids: node.branches[0].kids, node, branch: node.branches })
          done(); continue
        }
        if (head.startsWith(":else")) {
          const f = [...stack].reverse().find((x) => x.name === "#if")
          if (f && f.branch) {
            close("#if")
            const m = /^:else(?:\s+if\s+([\s\S]+))?$/.exec(head.trim())
            const b = { test: m?.[1]?.trim() ?? null, kids: [] as Node[] }
            f.branch.push(b)
            stack.push({ name: "#if", kids: b.kids, node: f.node, branch: f.branch })
            done(); continue
          }
        }
        if (head.startsWith("/each") || head.startsWith("/if")) {
          if (close(head.startsWith("/each") ? "#each" : "#if")) { done(); continue }
        }
        if (head.startsWith("#") || head.startsWith("/") || head.startsWith(":")) {
          // A block DIL has that this doesn't know ({#key}, {#await}): its insides drawn as they are.
          flush()
          if (head.startsWith("#")) stack.push({ name: `#${/^#(\w+)/.exec(head)?.[1] ?? ""}`, kids: top().kids, node: null })
          else if (head.startsWith("/")) close(`#${/^\/(\w+)/.exec(head)?.[1] ?? ""}`)
          done(); continue
        }
        if (head.trim()) { flushBuf(); text.push({ e: inner }); mark(i, e + 1); i = e + 1; continue }
      }
    }
    if (c === "<") {
      if (src.startsWith("<!--", i)) {
        const e = src.indexOf("-->", i + 4)
        i = e < 0 ? src.length : e + 3
        continue
      }
      if (src[i + 1] === "/") {
        const m = /^<\/([A-Za-z][\w.-]*)\s*>/.exec(src.slice(i, i + 80))
        if (m && close(m[1])) { mark(i, i + m[0].length); i += m[0].length; if (src[i] === "\n") { i++; lineStart = true } continue }
      } else {
        const tag = openTag(src, i)
        const lineAt = Math.max(src.lastIndexOf("\n", i - 1), -1)
        // (what follows it on its line: after its closing tag, for one with insides)
        const close = !tag || tag.self ? -1 : src.indexOf(`</${tag.name}>`, tag.end)
        const from = close < 0 ? tag?.end ?? i : close + (tag?.name.length ?? 0) + 3, lineEnd = src.indexOf("\n", from)
        const before = src.slice(lineAt + 1, i).trim(), after = tag ? src.slice(from, lineEnd < 0 ? src.length : lineEnd).trim() : ""
        if (tag && INLINE.has(tag.name) && (before || (after && !after.startsWith("<")))) {
          // In its line: a part of the text around it, its insides read on their own.
          const kids = tag.self || close < 0 ? [] : parse(src.slice(tag.end, close))
          flushBuf()
          text.push({ el: { t: "el", name: tag.name, props: tag.props, kids } })
          const end = tag.self || close < 0 ? tag.end : close + tag.name.length + 3
          mark(i, end)
          i = end
          continue
        }
        if (tag) {
          flush()
          if (tag.name === "AppBlock") {
            const endAt = tag.self ? tag.end : src.indexOf("</AppBlock>", tag.end)
            const html = tag.self ? "" : src.slice(tag.end, endAt < 0 ? src.length : endAt)
            top().kids.push({ t: "app", props: tag.props, html: dedent(html).trim() })
            const end = tag.self ? tag.end : endAt < 0 ? src.length : endAt + "</AppBlock>".length
            mark(i, end)
            i = end
          } else {
            const node: Node = { t: "el", name: tag.name, props: tag.props, kids: [] }
            top().kids.push(node)
            if (!tag.self) stack.push({ name: tag.name, kids: node.kids, node })
            mark(i, tag.end)
            i = tag.end
          }
          if (src[i] === "\n") { i++; lineStart = true }
          continue
        }
      }
    }
    buf += c
    i++
  }
  flush()
  return root.kids
}

/** `item, i` or `{a, b}, i`: the pattern and the index's name. */
function splitPattern(s: string): [string, string | undefined] {
  const t = s.trim()
  const e = /^[[{]/.test(t) ? jsEnd(t, 1, t[0] === "[" ? "]" : "}") : -1
  const at = e >= 0 ? t.indexOf(",", e) : t.indexOf(",")
  return at < 0 ? [t, undefined] : [t.slice(0, at).trim(), t.slice(at + 1).trim() || undefined]
}

/** The names of a program's useState values, in the order it asks for them (`const [key, setKey] = DIL.useState(...)`):
 *  what its saved values are keyed by. A value without a name is its index. */
export function stateNames(nodes: Node[]): string[] {
  const out: string[] = []
  const walk = (ns: Node[]) => {
    for (const n of ns) {
      if (n.t === "body") {
        for (const m of n.js.matchAll(/\buseState\s*\(/g)) {
          const name = /(?:const|let|var)\s*\[\s*([\w$]+)[^\]]*\]\s*=\s*(?:[\w$]+\.)?$/.exec(n.js.slice(0, m.index))?.[1]
          out.push(name ?? String(out.length))
        }
      } else if (n.t === "el") walk(n.kids)
      else if (n.t === "if") n.branches.forEach((b) => walk(b.kids))
      else if (n.t === "each") walk(n.kids)
    }
  }
  walk(nodes)
  return out
}

/** The live values a fence keeps (`{@state …}`), {} when none or unreadable. */
export function savedState(src: string): Record<string, unknown> {
  const m = STATE.exec(src)
  if (!m) return {}
  try { const v = JSON.parse(m[1]); return v && typeof v === "object" && !Array.isArray(v) ? v : {} } catch { return {} }
}

/** What ChatGPT resolved for a program (its `{@data}` line), {} when none. */
export function savedData(src: string): Data {
  const m = DATA.exec(src)
  if (!m) return {}
  try { const v = JSON.parse(m[1]); return v && typeof v === "object" && !Array.isArray(v) ? v : {} } catch { return {} }
}

/** ChatGPT's resolved data for an answer (from its message's metadata: model_dil_v2, a map's points in
 *  content_references), as a `{@data}` line; "" when none. */
export function dataLine(meta: unknown): string {
  const m = (meta ?? {}) as { model_dil_v2?: { appData?: { opGenui?: { modelDataBindings?: unknown; componentResults?: Record<string, unknown> } } }; content_references?: unknown[] }
  const app = m.model_dil_v2?.appData?.opGenui
  if (!app) return ""
  const data: Data = {}
  for (const r of (Array.isArray(m.content_references) ? m.content_references : []) as { type?: string; category?: string; data?: { points?: Record<string, unknown>[] } }[]) {
    if (r?.type !== "client_defined_widget" || r.category !== "map" || !Array.isArray(r.data?.points)) continue
    ;(data.maps ??= []).push(r.data.points.filter((pt) => typeof pt.latitude === "number" && typeof pt.longitude === "number").map((pt) => ({
      name: String(pt.name ?? ""), lat: pt.latitude as number, lon: pt.longitude as number,
      address: typeof pt.address === "string" ? pt.address : undefined, category: typeof pt.category === "string" ? pt.category : undefined,
    })))
  }
  if (app.modelDataBindings && typeof app.modelDataBindings === "object" && Object.keys(app.modelDataBindings).length) data.bindings = app.modelDataBindings as Record<string, unknown>
  for (const r of Object.values(app.componentResults ?? {}) as { componentName?: string; state?: Record<string, unknown> }[]) {
    if (r?.componentName === "Cite") for (const it of (r.state?.items ?? []) as Record<string, unknown>[]) {
      if (typeof it.ref_id === "string" && typeof it.url === "string") (data.refs ??= {})[it.ref_id] = { url: it.url, title: typeof it.title === "string" ? it.title : undefined, source: typeof it.source_label === "string" ? it.source_label : undefined }
    } else if (r?.componentName === "AsyncImage") {
      const imgs = ((r.state?.images ?? []) as Record<string, unknown>[]).map((im) => ({ url: String(im.content_url ?? im.thumbnail_url ?? ""), alt: typeof im.title === "string" ? im.title : undefined })).filter((im) => /^https:/.test(im.url))
      ;(data.images ??= []).push(imgs)
    }
  }
  return Object.keys(data).length ? `{@data ${JSON.stringify(data)}}` : ""
}

/** The source with its live values set (its `{@state}` line replaced, or added at its end; none when empty). */
export function withState(src: string, state: Record<string, unknown>): string {
  const line = Object.keys(state).length ? `{@state ${JSON.stringify(state)}}` : ""
  if (STATE.test(src)) return src.replace(STATE, line).replace(/\n{3,}$/, "\n").replace(/\n+$/, line ? "" : "")
  return line ? `${src.replace(/\n+$/, "")}\n\n${line}` : src
}

/** What a program says as plain Markdown, for search, agents and a fence's text: its prose and labels, without what
 *  only running it shows (values, loops), like ChatGPT's own fallback. */
export function dilText(src: string): string {
  const out: string[] = []
  const str = (p: Prop[], name: string) => (p.find((x) => "name" in x && x.name === name) as { str?: string } | undefined)?.str
  // (a line that was mostly values, "→ → →", says nothing without them)
  const lit = (parts: Part[]) => {
    const s = parts.map((p) => (typeof p === "string" ? p : "el" in p ? str(p.el.t === "el" ? p.el.props : [], "value") ?? inline(p.el.t === "el" ? p.el.kids : []) : "")).join("").replace(/[ \t]+$/gm, "")
    return parts.some((p) => typeof p !== "string" && !("el" in p)) && (s.match(/\p{L}/gu) ?? []).length < 3 ? "" : s.replace(/[\s·:,–-]+$/u, "")
  }
  const inline = (ns: Node[]): string => ns.map((n) => (n.t === "md" ? lit(n.parts).trim() : n.t === "el" ? inline(n.kids) : "")).filter(Boolean).join(" ")
  const walk = (ns: Node[]) => {
    for (const n of ns) {
      if (n.t === "md") { const s = lit(n.parts).trim(); if (s) out.push(s) }
      else if (n.t === "app") out.push(`_(${str(n.props, "title") ?? "An interactive view"})_`)
      else if (n.t === "if" || n.t === "each" || n.t === "body") continue
      else if (/^(title|heading|h[1-6])$/i.test(n.name)) { const s = inline(n.kids); if (s) out.push(`**${s}**`) }
      else if (/^(text|caption|label|bold|badge|markdown|p)$/i.test(n.name)) { const s = inline(n.kids); if (s) out.push(s) }
      else if (/^button$/i.test(n.name)) { const s = inline(n.kids) || str(n.props, "label"); if (s) out.push(`[${s}]`) }
      else if (/^(img|image)$/i.test(n.name)) { const s = str(n.props, "src"), a = str(n.props, "alt") ?? ""; if (s && /^https?:/.test(s)) out.push(`![${a}](${s})`) }
      else walk(n.kids)
    }
  }
  walk(parse(src.replace(STATE, "").replace(DATA, "")))
  return out.join("\n\n").replace(/\n{3,}/g, "\n\n").trim()
}

/** Whether a text has DIL in it, not just HTML in Markdown: a {@body} or block, a component (capitalised: <Entity/>),
 *  or a tag only DIL has (<box>, <row>, <title>...). */
export const hasDil = (s: string) => /\{[@#](body|each|if|const)\b|<[A-Z][A-Za-z]+[\s/>]|<(box|row|col|grid|grid-item|title|text|caption|label|select|slider|button|checkbox|segmented-control|card|divider|badge|icon|pressable|carousel|flow|radio-group|list-item|spacer|chart)[\s/>]/.test(s)

/** A ChatGPT answer with its Intelligent UI as a ```genui fence (the lines from its first piece of DIL to its last),
 *  the prose around it left as Markdown; the text as it is when it has none. `data`: its {@data} line. */
export function fenceDil(s: string, data = ""): string {
  if (!hasDil(s)) return s
  const span: [number, number] = [-1, -1]
  parse(s, span)
  if (span[0] < 0) return s
  const a = s.lastIndexOf("\n", span[0] - 1) + 1
  const nl = s.indexOf("\n", span[1])
  const b = nl < 0 ? s.length : nl
  const body = s.slice(a, b).replace(/\s+$/, "") + (data ? `\n\n${data}` : "")
  const ticks = Math.max(3, ...[...body.matchAll(/^[ \t]*(`{3,})/gm)].map((m) => m[1].length + 1))
  const f = "`".repeat(ticks)
  const before = s.slice(0, a).trimEnd(), after = s.slice(b).trim()
  return [before, `${f}genui\n${body}\n${f}`, after].filter(Boolean).join("\n\n")
}
