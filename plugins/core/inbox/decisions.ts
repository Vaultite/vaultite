import { str } from "../../../core/vault.ts"

export type DecisionSpec = { question: string; title: string; options: string[]; effects: string[]; default: string; blocking: boolean; why: string; warn?: string }

const clean = (v: unknown) => (typeof v === "string" ? v : v === undefined || v === null ? "" : String(v)).replace(/\s+/g, " ").trim()

export function titleOf(question: string) {
  const q = clean(question).replace(/[?？]+$/, "").replace(/[\\/:*"<>|#^[\]]+/g, " ").replace(/\s+/g, " ").trim()
  if (q.length <= 60) return q
  const cut = q.slice(0, 60), space = cut.lastIndexOf(" ")
  return (space > 30 ? cut.slice(0, space) : cut).replace(/[\s,;:.-]+$/, "")
}

export function optionOf(v: unknown): { label: string; does: string } {
  if (v && typeof v === "object" && !Array.isArray(v)) { const o = v as Record<string, unknown>; return { label: clean(o.label), does: clean(o.does ?? o.description) } }
  const t = clean(v), at = t.indexOf(": ")
  return at > 0 ? { label: t.slice(0, at).trim(), does: t.slice(at + 2).trim() } : { label: t, does: "" }
}

export function vagueOf(question: string) {
  if (words(question).length < 3) return "it's too short to say what it's about"
  if (/^\W*\w+\s+(?:it|this|that|these|those|them)\b/i.test(question) || /\b(?:the (?:first|next|last|other)|both)\s+(?:\w+\s+)?(?:steps?|ones?|options?|parts?)\b/i.test(question))
    return "it points at something (it, this, the first steps) instead of naming it"
  return ""
}

export function specOf(v: unknown, blocking = false): DecisionSpec {
  let o: Record<string, unknown>
  if (typeof v === "string" && v.trim().startsWith("{")) {
    try { o = JSON.parse(v) } catch { throw new Error(`not a JSON object: ${v.slice(0, 80)}`) }
  } else if (typeof v === "string") {
    const [q, ...parts] = v.split("|").map((s) => s.trim())
    const why = parts.filter((s) => /^why:/i.test(s)).map((s) => s.slice(4).trim()).join(" ")
    const rest = parts.filter((s) => !/^why:/i.test(s))
    const marked = rest.filter((s) => s.endsWith("*"))
    if (rest.length && marked.length !== 1) throw new Error(`"${clean(q).slice(0, 80)}": mark its default with one * ("Question? | Yes: what that does* | No: what that does | why: <context>")`)
    o = { question: q, options: rest.map((s) => s.replace(/\*+$/, "").trim()), default: marked[0]?.replace(/\*+$/, "").trim(), why }
  } else if (v && typeof v === "object" && !Array.isArray(v)) o = v as Record<string, unknown>
  else throw new Error("a decision is \"Question? | Option: what it causes* | Option: what it causes | why: <context>\" or {question, options, default, why}")
  const question = clean(o.question)
  if (!question) throw new Error("a decision needs its question")
  if (question.length > 300) throw new Error(`"${question.slice(0, 60)}…": a question in at most 300 letters (its context goes in why)`)
  const given = (Array.isArray(o.options) ? o.options : typeof o.options === "string" ? o.options.split("|") : []).map(optionOf).filter((x) => x.label)
  const options = given.map((x) => x.label), effects = given.map((x) => x.does)
  const said = `"${question.slice(0, 80)}"`
  if (options.length < 2) throw new Error(`${said}: give it 2 to 6 options, the answers the user picks from`)
  if (options.length > 6) throw new Error(`${said}: at most 6 options`)
  if (options.some((x) => x.length > 80)) throw new Error(`${said}: an option is a short answer, at most 80 letters`)
  if (new Set(options.map((x) => x.toLowerCase())).size !== options.length) throw new Error(`${said}: two options are the same`)
  const bare = options.filter((_, i) => !effects[i])
  if (bare.length) throw new Error(`${said}: each option says what it causes, in a few words after a colon, shown under its button ("${bare[0]}: <what happens then>"); ${bare.map((x) => `"${x}"`).join(", ")} ${bare.length === 1 ? "doesn't" : "don't"}`)
  if (effects.some((x) => x.length > 120)) throw new Error(`${said}: what an option causes is a few words, at most 120 letters (the rest goes in why)`)
  const why = clean(o.why)
  if (!why) throw new Error(`${said}: say why, in one or two plain sentences: what it's about (which agent, project or note asks) and what the choice changes for them. They may not remember the task, nor have read a linked proposal`)
  const dflt = optionOf(o.default).label
  if (!dflt) throw new Error(`${said}: say its default, the option you take if the user doesn't answer`)
  const def = options.find((x) => x.toLowerCase() === dflt.toLowerCase())
  if (!def) throw new Error(`${said}: its default "${dflt}" isn't one of its options`)
  const title = titleOf(clean(o.title) || question)
  const vague = vagueOf(question)
  return { question, title, options, effects, default: def, blocking: typeof o.blocking === "boolean" ? o.blocking : blocking, why,
    ...(vague ? { warn: `${said}: ${vague}. Name its subject plainly (the feature, the note, the project) so it reads alone, next time` } : {}) }
}

const STOP = new Set(("a an the to of or and for in on it its is are be should do does you we i this that these with by as at from your my our " +
  "me us them they there here if so then than now just also still any all one which what when how").split(" "))
const words = (s: string) => clean(s).toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w))

export function overlap(a: string, b: string) {
  const sx = new Set(words(a)), sy = new Set(words(b))
  let both = 0
  for (const w of sx) if (sy.has(w)) both++
  return sx.size + sy.size - both ? both / (sx.size + sy.size - both) : 0
}

export function sameQuestion(a: string, b: string) {
  const x = words(a), y = words(b)
  if (x.join(" ") === y.join(" ")) return true
  return Math.min(x.length, y.length) >= 3 && overlap(a, b) >= 0.7
}

export function answerOf(options: string[], said: string): { answer: string; own: boolean } {
  const s = clean(said)
  const n = /^\d+$/.test(s) ? Number(s) : 0
  if (n >= 1 && n <= options.length) return { answer: options[n - 1], own: false }
  const exact = options.find((o) => o.toLowerCase() === s.toLowerCase())
  if (exact) return { answer: exact, own: false }
  const starts = s.length >= 3 ? options.filter((o) => o.toLowerCase().startsWith(s.toLowerCase())) : []
  return starts.length === 1 ? { answer: starts[0], own: false } : { answer: s, own: true }
}

export type Asked = { question?: string; options?: string[]; effects?: string[]; default?: string; blocking?: boolean; answer?: string; closed?: string }

export const listOf = (v: string[] | null | undefined): string[] => (Array.isArray(v) ? v : [])

export const linkTo = (p: string) => /^\[\[([^\]|#]+)/.exec(p.trim())?.[1]?.trim() ?? p.trim()

export const toldOf = (d: Asked, answer: string) => (d.blocking === true
  ? `"${str(d.question)}": ${answer}`
  : answer !== str(d.default) ? `"${str(d.question)}": you went with "${str(d.default)}"; the user wants "${answer}" instead, so change it` : "")

export const decidedText = (lines: string[]) =>
  `The user decided${lines.length > 1 ? ` ${lines.length} of your questions` : ""}: ${lines.map((l, i) => (lines.length > 1 ? `${i + 1}. ${l}` : l)).join(" ")}`

export const optionsText = (r: Asked, sep = " · ") => listOf(r.options).map((o, i) => {
  const does = str(listOf(r.effects)[i])
  return `${o}${o === r.default ? " (default)" : ""}${does ? `: ${does}` : ""}`
}).join(sep)
export const isDecision = (r: Asked) => !!r.question
export const standingOf = (r: Asked) => (r.answer ? `You chose ${r.answer}` : r.closed ? "Closed" : r.blocking ? "Waits on you" : `Went with ${r.default}`)
