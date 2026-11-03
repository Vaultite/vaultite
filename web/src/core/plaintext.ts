// Markdown as plain text, apart from links.ts so a page of its own (the screen's overlay) has it without the app.
import { dropHighlightEmoji } from "@/core/highlights"
import { WIKI_LINK } from "@/core/markdown"

/** Markdown to plain text, for previews and search snippets: no marks, code fences, display math, callouts' types, rules or table pipes. */
export function plainText(md: string) {
  return dropHighlightEmoji(md)
    .replace(/^\s*(```|~~~)[\s\S]*?^\s*\1.*$/gm, " ")
    .replace(/\$\$[\s\S]*?\$\$/g, " ")
    .replace(new RegExp(`!?${WIKI_LINK}`, "g"), (_, t: string, a?: string) => (a ?? (t.split("#")[0] || t.split("#").pop()!)).trim())
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[ \t]*([-*_])([ \t]*\1){2,}[ \t]*$/gm, "")
    .replace(/^[ \t]*\|?([ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*$/gm, "")
    .replace(/^[ \t]*\|(.*?)\|?[ \t]*$/gm, (_, row: string) => row.split("|").map((c) => c.trim()).join(" "))
    .replace(/^[ \t]*(#{1,6}[ \t]+|>[ \t]?|[-*+][ \t]+(\[[ xX]\][ \t]+)?|\d+[.)](?=[ \t]|$)[ \t]*)/gm, "")
    .replace(/^[ \t]*\[![^\]\n]+\][+-]?[ \t]*/gm, "")
    .replace(/(^|[^\w\\])(_{1,3})(?=\S)(.*?\S)\2(?!\w)/gm, "$1$3")
    .replace(/(\*\*|__|\*|~~|==|`)/g, "")
    .replace(/<!--[\s\S]*?-->|<\/?[a-z][^>\n]*>/gi, "")
    .replace(/\\([\\`*_{}[\]()#+\-.!|>~])/g, "$1")
}

/** Markdown as one line of plain text: a preview in a row, a card or a search result. */
export const snippet = (md: string) => plainText(md).replace(/\s+/g, " ").trim()
