import TurndownService from "turndown"

export type HtmlMedia = (hash: string, type: string) => string | null

const isBlank = (s: string) => !s.replace(/[\s ]+/g, "")
const cell = (s: string) => s.replace(/\n+/g, "<br>").replace(/\|/g, "\\|").trim()

// What the rules read of a node, the browser's or turndown's own in Node (no spec querySelectorAll there)
type Dom = { nodeName: string; childNodes: ArrayLike<Dom>; innerHTML?: string }
type Parent = { nodeName: string; children?: ArrayLike<unknown>; getAttribute?: (name: string) => string | null }
const kids = (n: Dom) => Array.from(n.childNodes)
const rowsOf = (n: Dom): Dom[] => kids(n).flatMap((c) => (c.nodeName === "TR" ? [c] : ["THEAD", "TBODY", "TFOOT"].includes(c.nodeName) ? rowsOf(c) : []))

function service(media: HtmlMedia) {
  const t = new TurndownService({ headingStyle: "atx", hr: "---", bulletListMarker: "-", codeBlockStyle: "fenced", emDelimiter: "*", strongDelimiter: "**" })
  t.remove(["style", "script", "title", "head"])
  t.addRule("todo", {
    filter: (n) => n.nodeName === "INPUT" && n.getAttribute("type") === "checkbox",
    replacement: (_c, n) => (n.hasAttribute("checked") && n.getAttribute("checked") !== "false" ? "[x] " : "[ ] "),
  })
  t.addRule("media", {
    filter: (n) => n.nodeName === "IMG" && n.hasAttribute("data-hash"),
    replacement: (_c, n) => {
      const out = media(n.getAttribute("data-hash") ?? "", n.getAttribute("data-type") ?? "")
      return out ? `\n\n${out}\n\n` : ""
    },
  })
  t.addRule("listItem", {
    filter: "li",
    replacement: (content, n, o) => {
      const parent: Parent | null = n.parentNode
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
      const rows = rowsOf(n).map((tr) => kids(tr).filter((c) => c.nodeName === "TD" || c.nodeName === "TH").map((td) => cell(t.turndown(td.innerHTML ?? ""))))
      if (!rows.length) return ""
      const w = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `| ${Array.from({ length: w }, (_, i) => r[i] ?? "").join(" | ")} |`
      return `\n\n${[line(rows[0]), line(Array(w).fill("---")), ...rows.slice(1).map(line)].join("\n")}\n\n`
    },
  })
  t.addRule("styled", {
    filter: (n) => n.nodeName === "SPAN" && !!n.getAttribute("style"),
    replacement: (content, n) => {
      const s = n.getAttribute("style") ?? ""
      if (isBlank(content)) return content
      let out = content
      if (/font-weight\s*:\s*(bold|[6-9]00)/.test(s)) out = `**${out}**`
      if (/font-style\s*:\s*italic/.test(s)) out = `*${out}*`
      if (/line-through/.test(s)) out = `~~${out}~~`
      if (/--en-highlight/.test(s)) out = `==${out}==`
      return out
    },
  })
  t.addRule("wikilink", {
    filter: (n) => n.nodeName === "A" && n.hasAttribute("data-wiki"),
    replacement: (c, n) => {
      const to: string = n.getAttribute("data-wiki") ?? "", shown = to.split("#").map((x) => x.trim()).filter(Boolean).join(" › ")
      return `${n.hasAttribute("data-wiki-embed") ? "!" : ""}[[${to}${c && c !== shown ? `|${c}` : ""}]]`
    },
  })
  t.addRule("googleDocsWrapper", { filter: (n) => n.nodeName === "B" && /font-weight\s*:\s*(normal|[1-5]00)/.test(n.getAttribute("style") ?? ""), replacement: (c) => c })
  t.addRule("strike", { filter: (n) => ["S", "DEL", "STRIKE"].includes(n.nodeName), replacement: (c) => (isBlank(c) ? c : `~~${c}~~`) })
  t.addRule("mark", { filter: ["mark"], replacement: (c) => (isBlank(c) ? c : `==${c}==`) })
  return t
}

export function htmlToMarkdown(html: string, media: HtmlMedia = () => null) {
  const md = service(media).turndown(html)
  return md
    .split("\n").map((l) => l.replace(/[ \t ]+$/, "")).join("\n")
    .replace(/^(\s*)\[([ x])\] /gm, "$1- [$2] ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/^(- \[[ x]\] .*)\n\n(?=- \[[ x]\] )/gm, "$1\n")
    .trim()
}
