// Decisions: a question an agent asks the user, a file each (Inbox/<title>.md with `question`): its options, the default
// it takes unanswered, whether it waits on it (blocking). Pure: plugin.ts keeps the files.

export type DecisionSpec = { question: string; title: string; options: string[]; default: string; blocking: boolean; why: string }

const clean = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v)).replace(/\s+/g, " ").trim()

/** A file name's worth of the question: its words without the question mark, cut at a word by about 60 letters. */
export function titleOf(question: string) {
  const q = clean(question).replace(/[?？]+$/, "").replace(/[\\/:*"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim()
  if (q.length <= 60) return q
  const cut = q.slice(0, 60), space = cut.lastIndexOf(" ")
  return (space > 30 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")
}

/** One decision as given: an object ({question, options, default, blocking?, why?, title?}), or text
 *  "Question? | Option* | Option" (`*` marks the default; `blocking` is its default then). Throws what's wrong. */
export function specOf(v: unknown, blocking = false): DecisionSpec {
  let o: Record<string, unknown>
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try { o = JSON.parse(v) } catch { throw new Error(`not a JSON object: ${v.slice(0, 80)}`) }
  } else if (typeof v === "string") {
    const [q, ...rest] = v.split("|").map((s) => s.trim())
    const marked = rest.filter((s) => s.endsWith("*"))
    if (rest.length && marked.length !== 1) throw new Error(`"${clean(q).slice(0, 80)}": mark its default with one * ("Question? | Yes* | No")`)
    o = { question: q, options: rest.map((s) => s.replace(/\*+$/, "").trim()), default: marked[0]?.replace(/\*+$/, "").trim() }
  } else if (v && typeof v === "object" && !Array.isArray(v)) o = v as Record<string, unknown>
  else throw new Error("a decision is \"Question? | Option* | Option\" or {question, options, default}")
  const question = clean(o.question)
  if (!question) throw new Error("a decision needs its question")
  if (question.length > 300) throw new Error(`"${question.slice(0, 60)}…": a question in at most 300 letters (its context goes in why)`)
  const options = (Array.isArray(o.options) ? o.options : typeof o.options === "string" ? o.options.split("|") : []).map(clean).filter(Boolean)
  const said = `"${question.slice(0, 80)}"`
  if (options.length < 2) throw new Error(`${said}: give it 2 to 6 options, the answers the user picks from`)
  if (options.length > 6) throw new Error(`${said}: at most 6 options`)
  if (options.some((x) => x.length > 80)) throw new Error(`${said}: an option is a short answer, at most 80 letters`)
  if (new Set(options.map((x) => x.toLowerCase())).size !== options.length) throw new Error(`${said}: two options are the same`)
  const given = clean(o.default)
  if (!given) throw new Error(`${said}: say its default, the option you take if the user doesn't answer`)
  const def = options.find((x) => x.toLowerCase() === given.toLowerCase())
  if (!def) throw new Error(`${said}: its default "${given}" isn't one of its options`)
  const title = titleOf(clean(o.title) || question)
  return { question, title, options, default: def, blocking: typeof o.blocking === "boolean" ? o.blocking : blocking, why: clean(o.why) }
}

const STOP = new Set(("a an the to of or and for in on it its is are be should do does you we i this that these with by as at from your my our " +
  "me us them they there here if so then than now just also still any all one which what when how").split(" "))
const words = (s: string) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w))

/** The same question, said much the same way (from two agents, or the same one twice): one decision. */
export function sameQuestion(a: string, b: string) {
  const x = words(a), y = words(b)
  if (x.join(" ") === y.join(" ")) return true
  if (Math.min(x.length, y.length) < 3) return false
  const sx = new Set(x), sy = new Set(y)
  let both = 0
  for (const w of sx) if (sy.has(w)) both++
  return both / (sx.size + sy.size - both) >= 0.7
}

/** What the user answered, as one of `options`: by its number (1-based) or its words (whole, else the only option
 *  they start); anything else is their own answer, as said. */
export function answerOf(options: string[], said: string): { answer: string; own: boolean } {
  const s = clean(said)
  const n = /^\d+$/.test(s) ? Number(s) : 0
  if (n >= 1 && n <= options.length) return { answer: options[n - 1], own: false }
  const exact = options.find((o) => o.toLowerCase() === s.toLowerCase())
  if (exact) return { answer: exact, own: false }
  const starts = s.length >= 3 ? options.filter((o) => o.toLowerCase().startsWith(s.toLowerCase())) : []
  return starts.length === 1 ? { answer: starts[0], own: false } : { answer: s, own: true }
}

/** A decision as the lists read it: an Inbox/ result with a question. */
export type Asked = { question?: string; options?: string[]; default?: string; blocking?: boolean; answer?: string; closed?: string }
export const isDecision = (r: Asked) => !!r.question
/** What it says to the user it already did, or waits on: "I went with X" (a default taken), "Waits on you". */
export const standingOf = (r: Asked) => (r.answer ? `You chose ${r.answer}` : r.closed ? "Closed" : r.blocking ? "Waits on you" : `Went with ${r.default}`)
