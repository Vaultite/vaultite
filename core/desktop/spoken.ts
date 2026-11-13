
export function speakable(md: string): string {
  return md
    .replace(/```[\s\S]*?(```|$)/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]+))?\]\]/g, (_m, note: string, alias?: string) => alias ?? note.split("/").pop()!)
    .replace(/\[([^\]]+)\]\((?:[^()]|\([^)]*\))*\)/g, (_m, t: string) => (/^(https?:\/\/|www\.)/i.test(t) ? "this link" : t))
    .replace(/<?\b(?:https?:\/\/|www\.)[^\s<>)]*[^\s<>).,;:!?'"]>?/gi, "this link")
    .replace(/`([^`\n]*)`/g, (_m, c: string) => (c.length <= 24 && !/[{}()[\]<>=;$\\|]/.test(c) ? c : "this"))
    .replace(/\{[^{}]*"el"[^{}]*\}/g, " ")
    .replace(/\(\s*(?:id\s+)?[ae]\d{1,3}\s*\)/gi, " ")
    .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "")
    .replace(/(\*\*|__|~~|==)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/<\/?[a-z][^>]*>/gi, " ")
    .replace(/([^\s.,;:!?…])[ \t]*\n/g, "$1.\n")
    .replace(/\s+(?:->|→|=>)\s+/g, " to ")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[|*#~^]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .trim()
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"]
const ABBR: Record<string, number> = { jan: 0, feb: 1, fev: 1, mar: 2, apr: 3, abr: 3, may: 4, mai: 4, jun: 5, jul: 6, aug: 7, ago: 7, sep: 8, sept: 8, set: 8, oct: 9, out: 9, nov: 10, dec: 11, dez: 11 }
const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] ?? "th"}`
const dayOf = (m: number, d: number, lang: string, y?: string) => (lang === "pt" ? `${d} de ${MESES[m]}${y ? ` de ${y}` : ""}` : `${MONTHS[m]} ${ordinal(d)}${y ? `, ${y}` : ""}`)
const ok = (m: number, d: number) => m >= 0 && m < 12 && d >= 1 && d <= 31

export function sayable(text: string, lang = "en"): string {
  const pt = lang === "pt", to = pt ? " a " : " to "
  return text
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (x, y: string, m: string, d: string) => (ok(+m - 1, +d) ? dayOf(+m - 1, +d, lang, y) : x))
    .replace(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?\b/g, (x, a: string, b: string, y?: string) => {
      const [m, d] = pt ? [+b - 1, +a] : [+a - 1, +b]
      return ok(m, d) ? dayOf(m, d, lang, y) : x
    })
    .replace(/\b(Jan|Feb|Fev|Mar|Apr|Abr|May|Mai|Jun|Jul|Aug|Ago|Sept?|Set|Oct|Out|Nov|Dec|Dez)\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b(?!:)/gi, (x, mon: string, d: string) => {
      const m = ABBR[mon.toLowerCase()]
      return m === undefined || !ok(m, +d) || (pt && mon.toLowerCase() === "out") ? x : dayOf(m, +d, lang)
    })
    .replace(/\b(\d{1,2}) de (jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)(\.?)(?=[\s,.;:!?]|$)/gi, (x, d: string, mon: string, dot: string, at: number, all: string) =>
      `${d} de ${MESES[ABBR[mon.toLowerCase()]]}${dot && at + x.length >= all.trimEnd().length ? "." : ""}`)
    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2})\b(?!(?:st|nd|rd|th)|:|\d)/g, (_x, mon: string, d: string) => `${mon} ${ordinal(+d)}`)
    .replace(/(?<=\d(?:st|nd|rd|th)?|\b(?:AM|PM|am|pm))\s*[–—-]\s*(?=(?:January|February|March|April|May|June|July|August|September|October|November|December) )/g, to)
    .replace(/(?<![\d.\/-])(\d+(?:[.,]\d+)?)\s*[–—-]\s*(\d+(?:[.,]\d+)?)(?![\d\/-])/g, `$1${to}$2`)
    .replace(/\b(around|about|roughly|cerca de|cerca|uns|umas)\s*~\s*/gi, "$1 ")
    .replace(/(^|[\s(])~\s*(?=\d|\$|€|R\$)/g, `$1${pt ? "cerca de " : "about "}`)
    .replace(/~/g, pt ? "cerca de " : "about ")
    .replace(/\bv(\d+(?:\.\d+)+)\b/g, `${pt ? "versão" : "version"} $1`)
    .replace(/\b(?:e\.g\.|eg\.)(?=\s|,|$)/gi, pt ? "por exemplo" : "for example")
    .replace(/\bi\.e\.(?=\s|,|$)/gi, pt ? "isto é" : "that is")
    .replace(/\b(?:p\.\s?ex\.|ex\.:)/gi, "por exemplo")
    .replace(/\betc\./gi, pt ? "etcetera." : "et cetera.")
    .replace(/\betc\b/gi, pt ? "etcetera" : "et cetera")
    .replace(/\bvs\.?(?=\s)/gi, "versus")
    .replace(/\bapprox\.(?=\s)/gi, "about")
    .replace(/\s+/g, " ")
    .replace(/\.{2,}$/, ".")
}

const ABBREV = /(?:^|\s)(?:e\.g|i\.e|etc|vs|cf|approx|no|dr|mr|mrs|ms|sr|sra|st|av|nº|p\.ex|ex)\.$/i

function cuts(s: string, from: number, clause: boolean): number[] {
  const at: number[] = []
  let fence = false, tick = false, bracket = 0
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (s.startsWith("```", i)) { fence = !fence; i += 2; continue }
    if (fence) continue
    if (c === "`") { tick = !tick; continue }
    if (tick) continue
    if (c === "[" || c === "(") bracket++
    else if ((c === "]" || c === ")") && bracket) bracket--
    if (i < from || bracket) continue
    const next = s[i + 1]
    if (c === "\n") { at.push(i + 1); continue }
    if (next === undefined || !/\s/.test(next)) continue
    if (/[.!?…]/.test(c)) { if (c !== "." || (!ABBREV.test(s.slice(Math.max(0, i - 6), i + 1)) && s[i + 2] !== undefined && !/\p{Ll}/u.test(s[i + 2]))) at.push(i + 1) }
    else if (clause && /[,;:—–]/.test(c)) at.push(i + 1)
  }
  return at
}

const CLAUSE = 90, HARD = 240, BATCH = 360

export function chunker() {
  let text = "", used = 0
  const take = (end: number) => { const piece = speakable(text.slice(used, end)); used = end; return piece }
  const next = () => {
    const rest = text.length - used, ready = cuts(text, used, false)
    if (ready.length) return used === 0 ? ready[0] : ready.filter((c) => c - used <= BATCH).at(-1) ?? ready[0]
    if (rest <= CLAUSE) return -1
    const clause = cuts(text, used + CLAUSE / 2, true).filter((c) => c - used <= HARD).at(-1)
    if (clause) return clause
    if (rest <= HARD) return -1
    const sp = text.lastIndexOf(" ", used + HARD)
    return sp > used ? sp + 1 : used + HARD
  }
  return {
    feed(whole: string): string[] {
      if (whole.length >= used) text = whole
      const out: string[] = []
      for (let end = next(); end > used; end = next()) { const piece = take(end); if (piece) out.push(piece) }
      return out
    },
    flush(): string | null { const piece = text.length > used ? take(text.length) : ""; return piece || null },
  }
}

export const AGENT_VOICES = ["Grace", "Logan", "Hazel", "Owen", "Nina", "Shane", "Iris", "Mason", "Poppy", "Rafael", "Harper", "Ruby"]
export function voiceOf(name: string, main: string, own: string) {
  if (!name.trim() || name.trim().toLowerCase() === main.trim().toLowerCase()) return null
  const pool = AGENT_VOICES.filter((v) => v.toLowerCase() !== (own || "Adrian").toLowerCase())
  let h = 0
  for (const c of name.trim().toLowerCase()) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return pool[h % pool.length]
}

const WORDS: Record<string, string[]> = {
  en: ["the", "and", "is", "you", "that", "it", "to", "of", "this", "for", "with", "your", "are", "on", "here", "click", "what", "can", "there"],
  pt: ["o", "a", "os", "as", "é", "não", "que", "de", "do", "da", "você", "para", "com", "um", "uma", "isso", "esse", "essa", "aqui", "clique", "em", "no", "na", "mais"],
  es: ["el", "la", "los", "las", "es", "no", "que", "de", "del", "usted", "tú", "para", "con", "un", "una", "esto", "ese", "aquí", "haz", "en", "más", "y"],
  fr: ["le", "la", "les", "est", "pas", "que", "de", "du", "vous", "pour", "avec", "un", "une", "ce", "cette", "ici", "cliquez", "et", "dans", "plus"],
  de: ["der", "die", "das", "ist", "nicht", "und", "zu", "von", "sie", "du", "für", "mit", "ein", "eine", "hier", "klicken", "auf", "im", "mehr"],
  it: ["il", "la", "è", "non", "che", "di", "del", "della", "per", "con", "un", "una", "questo", "qui", "clicca", "e", "nel", "più"],
}
const MARKS: Record<string, RegExp> = { pt: /[ãõç]|ção|ões/g, es: /[ñ¿¡]|ción/g, fr: /[èêëàùç]|eau/g, de: /[äöüß]/g, it: /zion[ei]\b/g }

export function languageIn(text: string, hints: string[] = []): string | null {
  const known = (hints.length ? hints : Object.keys(WORDS)).map((h) => h.slice(0, 2).toLowerCase()).filter((h) => WORDS[h])
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  let best: string | null = null, top = 0
  for (const l of known) {
    const set = new Set(WORDS[l])
    const n = words.filter((w) => set.has(w)).length + 2 * (text.toLowerCase().match(MARKS[l] ?? /$^/g)?.length ?? 0)
    if (n > top) { top = n; best = l }
  }
  return best
}
export function languageOf(text: string, hints: string[] = [], fallback = hints[0] ?? "en"): string {
  const known = hints.map((h) => h.slice(0, 2).toLowerCase()).filter((h) => WORDS[h])
  if (hints.length && known.length < 2) return known[0] ?? fallback
  return languageIn(text, hints) ?? fallback
}
