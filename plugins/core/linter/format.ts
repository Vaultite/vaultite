// Markdown made tidy by rules, for both sides: only prose lines change; frontmatter, code and math stay as written.

export type Rules = {
  /** Spaces and tabs at line ends off. */
  trailingSpaces: boolean
  /** Two or more blank lines in a row made one. */
  blankLines: boolean
  /** A blank line before and after each heading. */
  headingSpacing: boolean
  /** `##Title` made `## Title` (not one `#`: that's a tag). */
  headingSpace: boolean
  /** `>quote` made `> quote`. */
  quoteSpace: boolean
  /** `## Title ##` made `## Title`. */
  headingMarks: boolean
  /** `*` and `+` bullets made `-`. */
  listMarkers: boolean
  /** The text ends in exactly one line break. */
  finalNewline: boolean
}

export const RULES: Rules = { trailingSpaces: true, blankLines: true, headingSpacing: true, headingSpace: true, quoteSpace: true, headingMarks: true, listMarkers: true, finalNewline: true }

/** The rules from settings (a value that isn't a boolean keeps the default). */
export const rulesOf = (s: Record<string, unknown>): Rules =>
  Object.fromEntries(Object.entries(RULES).map(([k, d]) => [k, typeof s[k] === "boolean" ? s[k] : d])) as Rules

const HEADING = /^#{1,6}(\s|$)/
const HR = /^ {0,3}([*_-])(?:[ \t]*\1){2,}[ \t]*$/

/** Which lines are prose (false: frontmatter, a fenced block with its fences, a $$ math block). */
function proseLines(lines: string[]) {
  const prose = lines.map(() => true)
  let i = 0
  if (lines[0] === "---") {
    const end = lines.indexOf("---", 1)
    if (end > 0) { for (; i <= end; i++) prose[i] = false }
  }
  for (; i < lines.length; i++) {
    // (a fence at any indent: one in a list item is code too; it closes on its own mark, at least as long, alone)
    const f = /^\s*(`{3,}|~{3,})/.exec(lines[i])
    const t = lines[i].trim()
    const math = t.startsWith("$$") && (t === "$$" || !t.slice(2).includes("$$"))
    if (!f && !math) continue
    const close = f ? new RegExp(`^\\s*${f[1][0] === "`" ? "`" : "~"}{${f[1].length},}\\s*$`) : /\$\$\s*$/
    let j = i + 1
    while (j < lines.length && !close.test(lines[j])) j++
    for (let k = i; k <= Math.min(j, lines.length - 1); k++) prose[k] = false
    i = j
  }
  return prose
}

/** `text` with the rules applied. */
export function formatMarkdown(text: string, rules: Rules = RULES): string {
  const src = text.replace(/\r\n?/g, "\n").split("\n")
  const prose = proseLines(src)
  const out: { line: string; prose: boolean }[] = []
  for (let i = 0; i < src.length; i++) {
    let line = src[i]
    if (!prose[i]) { out.push({ line, prose: false }); continue }
    if (rules.trailingSpaces) line = line.replace(/[ \t]+$/, "")
    if (rules.headingSpace) line = line.replace(/^(#{2,6})(?=[^\s#])/, "$1 ")
    if (rules.quoteSpace) line = line.replace(/^( {0,3}>+)(?=[^\s>])/, "$1 ")
    const heading = HEADING.test(line)
    if (heading && rules.headingMarks) line = line.replace(/\s+#+\s*$/, "").replace(/^(#{1,6})\s*$/, "$1")
    if (rules.listMarkers && !HR.test(line)) line = line.replace(/^(\s*)[*+](?=[ \t])/, "$1-")
    const empty = !line.trim()
    if (empty && rules.blankLines && out.at(-1)?.prose && !out.at(-1)!.line.trim()) continue
    if (heading && rules.headingSpacing && out.length && out.at(-1)!.line.trim()) out.push({ line: "", prose: true })
    out.push({ line, prose: true })
    if (heading && rules.headingSpacing && src[i + 1]?.trim()) out.push({ line: "", prose: true })
  }
  let result = out.map((o) => o.line).join("\n")
  if (rules.finalNewline) result = result.replace(/\n*$/, "") + (result.trim() ? "\n" : "")
  return result
}
