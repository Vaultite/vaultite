const QUOTES = String.raw`((?:> ?)*[ \t]*)`
const BULLET = new RegExp(String.raw`^${QUOTES}\\([-*+])(?=[ \t]+\S)`)
const ORDERED = new RegExp(String.raw`^${QUOTES}(\d{1,3})\\([.)])(?=[ \t]+\S)`)
const QUOTE = new RegExp(String.raw`^${QUOTES}\\>`)
const FENCE = /^(?:> ?)*[ \t]*(`{3,}|~{3,})/

const inWords = (s: string) => s.split(/(`+[^`]*`+)/).map((x, i) => (i % 2 ? x : x.replace(/(?<=[\p{L}\p{N}])\\_(?=[\p{L}\p{N}])/gu, "_"))).join("")

function line(s: string) {
  let out = s
  for (let prev = ""; prev !== out;) {
    prev = out
    out = out.replace(QUOTE, "$1>")
  }
  return inWords(out.replace(BULLET, "$1$2").replace(ORDERED, "$1$2$3"))
}

export function unescapeTurndownLists(markdown: string) {
  let fence = ""
  return markdown.split("\n").map((s) => {
    const f = FENCE.exec(s)?.[1]
    if (f && (!fence || (f[0] === fence[0] && f.length >= fence.length))) { fence = fence ? "" : f; return s }
    return fence ? s : line(s)
  }).join("\n")
}
