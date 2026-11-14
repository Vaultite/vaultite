const TAGS = new Set(["i", "b", "em", "strong", "sup", "sub", "span", "a", "div", "br"])
const TAG = /<(\/?)([a-zA-Z]+)([^>]*)>/g

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`)

function attrsOf(name: string, raw: string): string {
  let out = ""
  const cls = /\bclass="([\w\s-]*)"/.exec(raw)?.[1]
  if (cls) out += ` class="${esc(cls)}"`
  if (name === "span" && /font-variant:\s*small-caps/.test(raw)) out += ' style="font-variant:small-caps"'
  const href = name === "a" ? /\bhref="([^"]*)"/.exec(raw)?.[1] : undefined
  if (href && /^(https?:\/\/|zotero:\/\/)/i.test(href.replace(/&amp;/g, "&"))) out += ` href="${href}" target="_blank" rel="noopener noreferrer"`
  return out
}

export function safeHtml(html: string): string {
  return html.replace(TAG, (_m, close: string, raw: string, attrs: string) => {
    const name = raw.toLowerCase()
    if (!TAGS.has(name)) return ""
    return close ? `</${name}>` : `<${name}${attrsOf(name, attrs)}>`
  })
}

export const plainOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#38;|&amp;/g, "&").replace(/&#60;|&lt;/g, "<").replace(/&#62;|&gt;/g, ">")
  .replace(/&#34;|&quot;/g, "\"").replace(/&#39;/g, "'").replace(/&#160;|&nbsp;/g, " ")
