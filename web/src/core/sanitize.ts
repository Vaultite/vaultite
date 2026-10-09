// Raw HTML in Markdown, drawn as Obsidian does but safe: tags and attributes from a list, each tag written anew (never
// passed through), links and images through the caller; scripts, styles, frames and forms dropped or shown as text.

/** Tags drawn as they are. */
const TAGS = new Set(["a", "abbr", "b", "bdi", "bdo", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
  "dd", "del", "details", "dfn", "div", "dl", "dt", "em", "figcaption", "figure", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i",
  "img", "ins", "kbd", "li", "mark", "ol", "p", "pre", "q", "rp", "rt", "ruby", "s", "samp", "small", "span", "strike", "strong", "sub",
  "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "tt", "u", "ul", "var", "wbr"])
/** Tags whose content goes too. */
const GONE = new Set(["script", "style", "iframe", "object", "embed", "noscript", "template", "textarea", "title", "frame", "frameset", "select"])
/** Attributes any allowed tag keeps (`style` filtered, `href` and `src` through the caller). */
const ATTRS = new Set(["title", "alt", "width", "height", "align", "valign", "colspan", "rowspan", "open", "start", "reversed", "type", "dir",
  "lang", "cite", "datetime", "color", "face", "size", "style"])

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
/** Text between tags as it is (its entities too), but a stray < or > that isn't a tag. */
const text = (s: string) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;")
const unesc = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) => {
  const l = e.toLowerCase()
  if (l[0] === "#") return String.fromCodePoint(l[1] === "x" ? parseInt(l.slice(2), 16) : parseInt(l.slice(1), 10))
  return ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" } as Record<string, string>)[l]
})

/** CSS a note may set: no fixed or absolute boxes over the app, no addresses fetched, no old IE scripts. */
function safeStyle(css: string) {
  return css.split(";").map((d) => d.trim()).filter((d) => {
    const prop = d.slice(0, d.indexOf(":")).trim().toLowerCase()
    return d.includes(":") && !/^(position|z-index|inset|top|left|right|bottom|behavior|-moz-binding)$/.test(prop) && !/url\(|expression\(|@import|javascript:/i.test(d)
  }).join("; ")
}

export type HtmlLinks = {
  /** An <a>'s href: its attributes as the Markdown link's would be (` href=… target=…` or ` class=… data-wiki=…`), or null to drop it. */
  link: (href: string) => string | null
  /** An <img>'s src: an address to show, or null to drop it. */
  image: (src: string) => string | null
}

const TAG = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][\w-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*(\/?)>/g
const ATTR = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** HTML from a note, made safe to draw: allowed tags rebuilt from their allowed attributes, the rest escaped as text. */
export function sanitizeHtml(html: string, links: HtmlLinks): string {
  let out = "", at = 0, gone: string | null = null
  for (const m of html.matchAll(TAG)) {
    const before = html.slice(at, m.index)
    at = m.index + m[0].length
    if (gone) {
      if (m[1] && m[2].toLowerCase() === gone) gone = null
      continue
    }
    out += text(before)
    if (m[0].startsWith("<!--")) continue
    const [, close, rawName, attrs, self] = m
    const name = rawName.toLowerCase()
    if (GONE.has(name)) { if (!close && !self) gone = name; continue }
    if (!TAGS.has(name)) { out += esc(m[0]); continue }
    if (close) { out += `</${name}>`; continue }
    let kept = ""
    for (const a of attrs.matchAll(ATTR)) {
      const key = a[1].toLowerCase(), value = unesc(a[2] ?? a[3] ?? a[4] ?? "")
      if (key === "href" && name === "a") { const l = links.link(value.trim()); if (l) kept += l; continue }
      if (key === "src" && name === "img") { const src = links.image(value.trim()); if (src) kept += ` src="${esc(src)}"`; continue }
      if (!ATTRS.has(key)) continue
      const v = key === "style" ? safeStyle(value) : value
      if (key === "open" || a[2] !== undefined || a[3] !== undefined || a[4] !== undefined) kept += v || key === "open" ? ` ${key}="${esc(v)}"` : ""
    }
    if (name === "img" && !kept.includes(" src=")) continue
    out += `<${name}${kept}${name === "img" ? ' loading="lazy"' : ""}>`
  }
  return gone ? out : out + text(html.slice(at))
}
