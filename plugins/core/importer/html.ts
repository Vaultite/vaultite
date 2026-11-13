import TurndownService from "turndown"

export type Media = (hash: string, type: string) => string | null

const isBlank = (s: string) => !s.replace(/[\s ]+/g, "")
const cell = (s: string) => s.replace(/\n+/g, "<br>").replace(/\|/g, "\\|").trim()

// Turndown's DOM has no spec querySelectorAll
const kids = (n: Node) => Array.from(n.childNodes)
const rowsOf = (n: Node): Node[] => kids(n).flatMap((c) => (c.nodeName === "TR" ? [c] : ["THEAD", "TBODY", "TFOOT"].includes(c.nodeName) ? rowsOf(c) : []))

function service(media: Media) {
  const t = new TurndownService({ headingStyle: "atx", hr: "---", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*", strongDelimiter: "**" })
  t.remove(["style", "script", "title", "head"])
  t.addRule("todo", {
    filter: (n) => n.nodeName === "INPUT" && (n as HTMLInputElement).getAttribute("type") === "checkbox",
    replacement: (_c, n) => ((n as HTMLElement).hasAttribute("checked") && (n as HTMLElement).getAttribute("checked") !== "false" ? "[x] " : "[ ] "),
  })
  t.addRule("media", {
    filter: (n) => n.nodeName === "IMG" && (n as HTMLElement).hasAttribute("data-hash"),
    replacement: (_c, n) => {
      const e = n as HTMLElement
      const out = media(e.getAttribute("data-hash") ?? "", e.getAttribute("data-type") ?? "")
      return out ? `\n\n${out}\n\n` : ""
    },
  })
  t.addRule("listItem", {
    filter: "li",
    replacement: (content, n, o) => {
      const parent = n.parentNode as HTMLElement
      const ordered = parent?.nodeName === "OL"
      const at = Array.prototype.indexOf.call(parent?.children ?? [], n)
      const start = Number(parent?.getAttribute?.("start")) || 1
      const prefix = ordered ? `${start + at}. ` : `${o.bulletListMarker} `
      const body = content.replace(/^\n+/, "").replace(/\n+$/, "").replace(/\n/gm, `\n${" ".repeat(prefix.length)}`)
      return prefix + body + (n.nextSibling ? "\n" : "")
    },
  })
  t.addRule("table", {
    filter: "table",
    replacement: (_c, n) => {
      const rows = rowsOf(n).map((tr) => kids(tr).filter((c) => c.nodeName === "TD" || c.nodeName === "TH").map((td) => cell(t.turndown((td as HTMLElement).innerHTML))))
      if (!rows.length) return ""
      const w = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? "").join(" | ")} |`
      return `\n\n${[line(rows[0]), line(Array(w).fill("---")), ...rows.slice(1).map(line)].join("\n")}\n\n`
    },
  })
  t.addRule("styled", {
    filter: (n) => n.nodeName === "SPAN" && !!(n as HTMLElement).getAttribute("style"),
    replacement: (content, n) => {
      const s = (n as HTMLElement).getAttribute("style") ?? ""
      if (isBlank(content)) return content
      let out = content
      if (/font-weight\s*:\s*(bold|[6-9]00)/.test(s)) out = `**${out}**`
      if (/font-style\s*:\s*italic/.test(s)) out = `*${out}*`
      if (/line-through/.test(s)) out = `~~${out}~~`
      if (/--en-highlight/.test(s)) out = `==${out}==`
      return out
    },
  })
  t.addRule("strike", { filter: (n) => ["S", "DEL", "STRIKE"].includes(n.nodeName), replacement: (c) => (isBlank(c) ? c : `~~${c}~~`) })
  t.addRule("mark", { filter: ["mark"], replacement: (c) => (isBlank(c) ? c : `==${c}==`) })
  return t
}

// `<en-todo/>` and `<en-media/>` are void in ENML, not in HTML
export function fromEnml(enml: string) {
  return enml
    .replace(/<\?xml[^>]*\?>|<!DOCTYPE[^>]*>/gi, "")
    .replace(/<en-note\b[^>]*>/i, "<div>").replace(/<\/en-note>/i, "</div>")
    .replace(/<en-todo\b([^>]*?)\/?>(\s*<\/en-todo>)?/gi, (_, a: string) => `<input type="checkbox"${/checked\s*=\s*["']true["']/i.test(a) ? " checked" : ""}>`)
    .replace(/<en-media\b([^>]*?)\/?>(\s*<\/en-media>)?/gi, (_, a: string) => {
      const hash = /hash\s*=\s*["']([0-9a-f]+)["']/i.exec(a)?.[1] ?? ""
      const type = /type\s*=\s*["']([^"']+)["']/i.exec(a)?.[1] ?? ""
      return `<img data-hash="${hash}" data-type="${type}">`
    })
    // Evernote's code block is a div of lines, styled "--en-codeblock:true"
    .replace(/<div\b[^>]*--en-codeblock\s*:\s*true[^>]*>((?:\s*<div\b[^>]*>[\s\S]*?<\/div>)*)\s*<\/div>/gi, (_, inner: string) => {
      const lines = [...inner.matchAll(/<div\b[^>]*>([\s\S]*?)<\/div>/gi)].map((m) => m[1].replace(/<br\s*\/?>/gi, "").replace(/<[^>]+>/g, ""))
      return `<pre><code>${lines.join("\n")}</code></pre>`
    })
    .replace(/<en-crypt\b[^>]*>[\s\S]*?<\/en-crypt>/gi, "<p><em>(encrypted text, not imported)</em></p>")
}

export function toMarkdown(html: string, media: Media = () => null) {
  const md = service(media).turndown(html)
  return md
    .split("\n").map((l) => l.replace(/[ \t ]+$/, "")).join("\n")
    .replace(/^(\s*)\[([ x])\] /gm, "$1- [$2] ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(- \[[ x]\] .*)\n\n(?=- \[[ x]\] )/gm, "$1\n")
    .trim()
}
