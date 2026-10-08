// Chats as Markdown and the memory review list, pure text in and out. Every `## ` line of a chat's body is a turn
// (headings inside messages move down), so what's above the first one is the user's and survives re-imports.
import { type Chat, type Memory, type MemoryAbout, type Message, type Part, type Project, said } from "./chat.ts"

export const LABELS: Record<Chat["source"], string> = { chatgpt: "ChatGPT", claude: "Claude" }

const pad = (n: number) => String(n).padStart(2, "0")
/** The local date, YYYY-MM-DD (the vault's dates are the user's local ones). */
export const localDate = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
const localTime = (t: number) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
/** "YYYY-MM-DD HH:MM:SS" in UTC, like notes' created and updated. */
export const utc = (t: number) => {
  const d = new Date(t)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
}

const FENCE = /^\s*(`{3,}|~{3,})/

/** Markdown with its headings `by` levels deeper (at most ######), code left alone. */
export function shiftHeadings(md: string, by = 2) {
  let fence: string | null = null
  return md.split("\n").map((l) => {
    const f = FENCE.exec(l)
    if (f) {
      if (!fence) fence = f[1][0].repeat(f[1].length)
      else if (l.trim().startsWith(fence)) fence = null
      return l
    }
    if (fence) return l
    const h = /^(#{1,6})(\s.*)$/.exec(l)
    return h ? `${"#".repeat(Math.min(6, h[1].length + by))}${h[2]}` : l
  }).join("\n")
}

/** A fenced block that the text can't close early. */
export function fenced(text: string, lang = "") {
  const longest = Math.max(2, ...[...text.matchAll(/`+/g)].map((m) => m[0].length))
  const f = "`".repeat(longest + 1)
  return `${f}${lang}\n${text.replace(/\n+$/, "")}\n${f}`
}

const quote = (s: string) => s.split("\n").map((l) => (l ? `> ${l}` : ">")).join("\n")
const callout = (type: string, title: string, body: string, folded = true) => `> [!${type}]${folded ? "-" : ""} ${title}\n${quote(body)}`
const MAX_FILE = 50_000
const italic = (s: string) => (s.includes("*") ? s : `*${s.replace(/\s+/g, " ").trim()}*`)

/** A part as Markdown. `images`: the vault file name of each imported image, by its export id. */
function partText(p: Part, images: Map<string, string>): string {
  switch (p.kind) {
    case "text": return shiftHeadings(p.text.replace(/\r\n?/g, "\n")).trim()
    case "code": {
      const block = fenced(p.text, p.lang ?? "")
      if (p.open) return `**${p.title ?? "Code"}**\n\n${block}`
      return callout("example", p.title ?? "Code", block)
    }
    case "output": return callout("info", p.title ?? "Output", fenced(p.text))
    case "thinking": return callout("abstract", "Thinking", shiftHeadings(p.text).trim())
    case "image": {
      const name = p.ref ? images.get(p.ref) : undefined
      if (name) return `![[${name}]]`
      return italic(`An image${p.name ? ` (${p.name})` : ""}, not in the import`)
    }
    case "file": {
      if (!p.text?.trim()) return italic(`Attached ${p.name}`)
      const t = p.text.length > MAX_FILE ? `${p.text.slice(0, MAX_FILE)}\n...` : p.text
      return callout("note", `Attached ${p.name}`, fenced(t))
    }
    case "memory": return callout("info", "Saved to memory", p.text, false)
    case "note": return italic(p.text)
  }
}

/** A chat's frontmatter (the keys the importer owns, in order) and its transcript. `projectLink`: its project's note, as
 *  a link. */
export function chatNote(c: Chat, images: Map<string, string> = new Map(), projectLink?: string): { fm: Record<string, unknown>; body: string } {
  const who = LABELS[c.source]
  const fm: Record<string, unknown> = { type: "chat", source: c.source, ext_id: `${c.source}-${c.id}` }
  fm.models = c.models.length ? c.models : undefined
  fm.project = projectLink
  fm.messages = said(c)
  fm.url = c.url
  const created = c.created ?? c.messages.find((m) => m.at)?.at
  const updated = c.updated ?? [...c.messages].reverse().find((m) => m.at)?.at ?? created
  fm.created = created ? utc(created) : undefined
  fm.updated = updated ? utc(updated) : undefined
  const out: string[] = []
  let day = ""
  let turn: "user" | "ai" | null = null
  for (const m of c.messages) {
    const side = m.role === "user" ? "user" : "ai"
    const parts = m.parts.map((p) => partText(p, images)).filter(Boolean)
    if (!parts.length) continue
    if (side !== turn) {
      turn = side
      out.push(heading(m, side === "user" ? "You" : who, day))
      if (m.at) day = localDate(m.at)
    }
    out.push(...parts)
  }
  if (c.otherBranches) {
    out.push(italic(`This chat has ${c.otherBranches} other branch${c.otherBranches === 1 ? "" : "es"} (an edited prompt or a retried answer); this is the one last seen.`))
  }
  return { fm, body: out.join("\n\n") }
}

function heading(m: Message, who: string, day: string) {
  if (!m.at) return `## ${who}`
  const d = localDate(m.at)
  return `## ${who} · ${d === day ? localTime(m.at) : `${d} ${localTime(m.at)}`}`
}

/** A body's own part (what the user wrote above the transcript) and the transcript. */
export function splitBody(body: string) {
  const at = body.search(/^## /m)
  return at < 0 ? { own: body.trim(), transcript: "" } : { own: body.slice(0, at).trim(), transcript: body.slice(at) }
}

/** A Claude project's note: what it's about, its instructions and its files. */
export function projectNote(p: Project): { fm: Record<string, unknown>; body: string } {
  const fm: Record<string, unknown> = { type: "chat-project", source: "claude", ext_id: `claude-project-${p.id}`,
    created: p.created ? utc(p.created) : undefined, updated: p.updated ? utc(p.updated) : undefined }
  const out: string[] = []
  if (p.description) out.push(`## About\n\n${shiftHeadings(p.description).trim()}`)
  if (p.instructions) out.push(`## Instructions\n\n${shiftHeadings(p.instructions).trim()}`)
  if (p.docs.length) {
    out.push("## Files")
    for (const d of p.docs) out.push(`### ${d.name}\n\n${shiftHeadings(d.text.length > MAX_FILE * 4 ? `${d.text.slice(0, MAX_FILE * 4)}\n...` : d.text, 3).trim()}`)
  }
  return { fm, body: out.join("\n\n") }
}

// ---------- the review list ----------

const ME = "Me", PREF = "How to work with me"

export const labelOf = (about: MemoryAbout) => (about === "me" ? ME : about === "preference" ? PREF : about)
/** A label as remember's `about`: me, preference, or a person's name (a [[link]] read as its name). */
export function aboutOfLabel(label: string): MemoryAbout {
  const l = label.replace(/^\[\[|\]\]$/g, "").split("|")[0].trim()
  if (!l || /^(me|about me|myself|i|user)$/i.test(l)) return "me"
  if (/^(how to work with me|preference|preferences)$/i.test(l)) return "preference"
  return l
}

/** Text compared without case, spaces or punctuation: the same memory twice. */
export const norm = (s: string) => s.toLowerCase().replace(/\(from [^)]*\)/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim()

const TASK = /^([ \t]*)[-*+] \[( |x|X)\] (.*)$/
const ERROR = /^[ \t]+[-*+] Couldn't add( it)?:/

export type ReviewItem = { line: number; done: boolean; label: string; about: MemoryAbout; fact: string }

/** The review list's memories: every task line, its label (bold, before " · ") and fact. */
export function reviewItems(textIn: string): ReviewItem[] {
  const out: ReviewItem[] = []
  textIn.split("\n").forEach((l, i) => {
    const m = TASK.exec(l)
    if (!m || m[1].length) return
    const rest = m[3].trim()
    const lab = /^\*\*(.+?)\*\*\s*(?:·|-|–|—|:)\s*(.*)$/.exec(rest)
    const label = lab ? lab[1].trim() : ME
    const fact = (lab ? lab[2] : rest).trim()
    if (fact) out.push({ line: i, done: m[2] !== " ", label, about: aboutOfLabel(label), fact })
  })
  return out
}

/** The review list for `memories` from `who`, new or merged into `existing`: only memories not there already nor in
 *  `known` (ME.md's and people's text). Returns the text and how many it added. */
export function reviewText(who: string, memories: Memory[], existing: string | null, known: string, now: string): { text: string; added: number } {
  const seen = new Set<string>()
  const knownN = norm(known)
  const base = existing ?? `---\ntype: memory-review\nsource: ${who.toLowerCase()}\ncreated: '${now}'\nupdated: '${now}'\n---\n\n` +
    "```block-memory-review\n```\n\n" +
    `What ${who} remembered about you, from its export. None of it is in ME.md or People/ yet. Tick the ones to keep and ` +
    "fix the label in bold where it's wrong: **Me**, **How to work with me**, or a person's name as in People/. Then press " +
    "Add in the card above (or run \"Add ticked memories\" from the command palette). Delete the lines you don't want.\n\n## To review\n"
  for (const l of base.split("\n")) {
    const t = TASK.exec(l)?.[3] ?? /^[-*+] (?:.*? · )?(.*)$/.exec(l)?.[1]
    if (t) seen.add(norm(t.replace(/^\*\*.+?\*\*\s*·\s*/, "")))
  }
  const groups = new Map<string, Memory[]>()
  for (const m of memories) {
    const n = norm(m.text)
    if (!n || seen.has(n) || (n.length > 12 && knownN.includes(n))) continue
    seen.add(n)
    groups.set(m.from, [...(groups.get(m.from) ?? []), m])
  }
  let lines = base.replace(/\n+$/, "").split("\n")
  let added = 0
  for (const [from, ms] of groups) {
    const items = ms.map((m) => `- [ ] **${labelOf(m.about)}** · ${m.text}`)
    added += items.length
    const h = lines.findIndex((l) => l.trim() === `### From ${from}`)
    if (h >= 0) {
      let end = h + 1
      while (end < lines.length && !/^#{1,3} /.test(lines[end])) end++
      while (end > h + 1 && !lines[end - 1].trim()) end--
      lines.splice(end, 0, ...items)
    } else {
      // Before `## Added` (the applied ones stay last), else at the end.
      let at = lines.findIndex((l) => l.trim() === "## Added")
      if (at < 0) at = lines.length
      while (at > 0 && !lines[at - 1].trim()) at--
      lines.splice(at, 0, "", `### From ${from}`, "", ...items, ...(at < lines.length ? [""] : []))
    }
  }
  if (added && existing) lines = lines.map((l) => (/^updated: /.test(l) ? `updated: '${now}'` : l))
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n") + "\n", added }
}

export type Applied = { fact: string; where?: string; error?: string }

/** The review list after applying, matched by text against `textIn` (the user may have edited it): added ones move
 *  under `## Added`, failed ones stay ticked with why. */
export function afterApply(textIn: string, results: Applied[]): string {
  const lines = textIn.replace(/\n+$/, "").split("\n")
  const byFact = new Map(results.map((r) => [norm(r.fact), r]))
  const items = new Map(reviewItems(textIn).filter((it) => it.done).map((it) => [it.line, it]))
  const out: string[] = []
  const added: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const it = items.get(i)
    const r = it ? byFact.get(norm(it.fact)) : undefined
    if (!it || !r) { out.push(lines[i]); continue }
    // Its old "Couldn't add" lines go (a new one comes if it failed again).
    let j = i + 1
    while (j < lines.length && ERROR.test(lines[j])) j++
    if (r.error) out.push(lines[i], `    - Couldn't add it: ${r.error.replace(/\s+/g, " ").trim()}`)
    else added.push(`- ${r.where ?? "Added"} · ${it.fact}`)
    i = j - 1
  }
  if (added.length) {
    let h = out.findIndex((l) => l.trim() === "## Added")
    if (h < 0) { out.push("", "## Added", ""); h = out.length - 2 }
    let end = h + 1
    while (end < out.length && !/^#{1,2} /.test(out[end])) end++
    while (end > h + 1 && !out[end - 1].trim()) end--
    if (end === h + 1) { out.splice(end, 0, ""); end++ }
    out.splice(end, 0, ...added)
  }
  // A "### From ..." heading with nothing left under it goes.
  const kept = out.filter((l, i) => {
    if (!/^### /.test(l)) return true
    let k = i + 1
    while (k < out.length && !out[k].trim()) k++
    return k < out.length && !/^#{1,3} /.test(out[k])
  })
  return kept.join("\n").replace(/\n{3,}/g, "\n\n").replace(/\n+$/, "") + "\n"
}
