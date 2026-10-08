// Lessons and cards as Markdown (format: AGENTS.md), read the same by the server and the app.

export type Option = { text: string; right: boolean; why: string }
export type Question =
  | { kind: "choice"; text: string; options: Option[]; why: string }
  | { kind: "recall"; text: string; answer: string }
  | { kind: "order"; text: string; items: string[]; why: string }
/** `first`: the question comes before the step's text (a guess first). */
export type Step = { title: string; body: string; question?: Question; first: boolean }
/** A card's `key` names it in reviews.json; a cloze card shows its prompt with its `cloze`th ==blank== hidden. */
export type Card = { key: string; prompt: string; answer: string; cloze?: number }

/** FNV-1a, as a short base-36 string: a card's key from its prompt. */
export function hash(s: string) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(36)
}

/** The same order for the same seed, so options don't move on a redraw. */
export function shuffled<T>(xs: T[], seed: string): T[] {
  let a = parseInt(hash(seed), 36) || 1
  const rand = () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
  const out = [...xs]
  for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]] }
  return out
}

/** The text before the first `## ` heading, and each heading with what's under it (headings in code don't count). */
function sections(body: string) {
  const out: { title: string; lines: string[] }[] = []
  const intro: string[] = []
  let fence = false
  for (const line of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = !fence && line.match(/^## +(.*)/)
    if (h) out.push({ title: h[1].trim(), lines: [] })
    else (out.length ? out[out.length - 1].lines : intro).push(line)
  }
  return { intro: intro.join("\n").trim(), sections: out }
}

const CALLOUT = /^>\s*\[!(question|recall|order)\][-+]?\s*(.*)$/i

function question(kind: string, text: string, lines: string[]): Question {
  if (kind === "recall") return { kind, text, answer: lines.join("\n").trim() }
  if (kind === "order") {
    const items: string[] = [], why: string[] = []
    for (const l of lines) { const m = l.match(/^\d+[.)]\s+(.*)/); if (m) items.push(m[1]); else why.push(l) }
    return { kind, text, items, why: why.join("\n").trim() }
  }
  const options: Option[] = [], why: string[] = []
  for (const l of lines) {
    const o = l.match(/^[-*]\s+\[( |x|X)\]\s+(.*)/)
    const sub = l.match(/^\s{2,}[-*]\s+(.*)/)
    if (o) options.push({ text: o[2], right: o[1] !== " ", why: "" })
    else if (sub && options.length) options[options.length - 1].why += (options[options.length - 1].why ? " " : "") + sub[1]
    else why.push(l)
  }
  return { kind: "choice", text, options, why: why.join("\n").trim() }
}

export function parseLesson(body: string): { intro: string; steps: Step[] } {
  const { intro, sections: parts } = sections(body)
  return {
    intro, steps: parts.map(({ title, lines }) => {
      const start = lines.findIndex((l) => CALLOUT.test(l))
      if (start < 0) return { title, body: lines.join("\n").trim(), first: false }
      let end = start + 1
      while (end < lines.length && lines[end].startsWith(">")) end++
      const [, kind, text] = lines[start].match(CALLOUT)!
      const inner = lines.slice(start + 1, end).map((l) => l.replace(/^>\s?/, ""))
      const before = lines.slice(0, start).join("\n").trim()
      return {
        title, body: [before, lines.slice(end).join("\n").trim()].filter(Boolean).join("\n\n"),
        question: question(kind.toLowerCase(), text.trim(), inner), first: !before,
      }
    }),
  }
}

const CLOZE = /==([^=\n]+)==/g

export function parseCards(body: string): Card[] {
  return sections(body).sections.flatMap(({ title, lines }): Card[] => {
    const answer = lines.join("\n").trim()
    const blanks = [...title.matchAll(CLOZE)].length
    if (!blanks) return [{ key: hash(title), prompt: title, answer }]
    return Array.from({ length: blanks }, (_, i) => ({ key: `${hash(title)}.${i + 1}`, prompt: title, answer, cloze: i }))
  })
}

/** A finished lesson's recall questions, as cards to review. */
export function lessonCards(body: string): Card[] {
  return parseLesson(body).steps.flatMap((s) => s.question?.kind === "recall"
    ? [{ key: hash(s.question.text), prompt: s.question.text, answer: s.question.answer }] : [])
}

/** A cloze card's prompt with its blank hidden (`shown`: revealed, marked) and the other blanks as plain text. */
export function clozeText(card: Card, shown: boolean) {
  if (card.cloze == null) return card.prompt
  let i = 0
  return card.prompt.replace(CLOZE, (_, t: string) => (i++ === card.cloze ? (shown ? `==${t}==` : "**[...]**") : t))
}
