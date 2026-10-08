// A note as slides: its body (no frontmatter) split at `---` lines (a line of three or more dashes on its
// own), never inside a code fence. Empty slides are dropped. No imports: tests run it on Node.

/** The note's slides, in order (Markdown each). */
export function splitSlides(body: string): string[] {
  const out: string[][] = [[]]
  let fence = ""
  for (const line of body.replace(/\r\n?/g, "\n").split("\n")) {
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line)
    if (f) {
      if (!fence) fence = f[1]
      else if (f[1][0] === fence[0] && f[1].length >= fence.length && !line.trim().slice(f[1].length).trim()) fence = ""
    } else if (!fence && /^\s{0,3}-{3,}\s*$/.test(line)) {
      out.push([])
      continue
    }
    out[out.length - 1].push(line)
  }
  return out.map((l) => l.join("\n").trim()).filter(Boolean)
}

/** A title slide (headings only, maybe a short line under them): drawn centred. */
export function isTitleSlide(md: string): boolean {
  const lines = md.split("\n").map((l) => l.trim()).filter(Boolean)
  const heads = lines.filter((l) => /^#{1,6}\s/.test(l)).length
  const rest = lines.filter((l) => !/^#{1,6}\s/.test(l))
  return heads > 0 && rest.length <= 1 && rest.every((l) => l.length <= 80 && !/^([-*+]|\d+\.|>|!?\[\[|```|\|)/.test(l))
}
