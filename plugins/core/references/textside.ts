import { citationsIn } from "./cite.ts"
import { markdownOf } from "./format.ts"
import { REFS_DIV, refsPlace } from "./place.ts"
import { realCites, type References } from "./refs.ts"

export async function pageText(refs: References, path: string, text: string): Promise<string | null> {
  const all = citationsIn(text)
  if (!all.length) return null
  const lib = refs.library(path)
  const cites = realCites(all, lib)
  if (!cites.length) return null
  const { style, problem } = refs.styleFor(path)
  const f = await refs.format(style, refs.langFor(path), lib, cites)
  let out = ""
  let at = 0
  cites.forEach((c, i) => {
    out += text.slice(at, c.from) + markdownOf(f.citations[i] ?? "")
    at = c.to
  })
  out += text.slice(at)
  const list = f.entries.map((e) => (f.numbered ? markdownOf(e.html) : `- ${markdownOf(e.html)}`)).join(f.numbered ? "\n\n" : "\n")
  const said = [problem && `_(${problem})_`, f.missing.length ? `_(not in the library: ${f.missing.map((k) => `@${k}`).join(", ")})_` : ""].filter(Boolean).join("\n\n")
  const refsText = [list, said].filter(Boolean).join("\n\n")
  const place = refsPlace(out)
  if (place === "div") return out.replace(REFS_DIV, refsText)
  if (place === "heading") return `${out.replace(/\s+$/, "")}\n\n${refsText}\n`
  return `${out.replace(/\s+$/, "")}\n\n## References\n\n_(${style.title})_\n\n${refsText}\n`
}
