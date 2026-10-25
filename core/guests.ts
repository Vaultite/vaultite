// What a shared folder's guest (plugins/core/share) may write: a note's words, checked on the text as it lands (after a
// merge, at its final name). Not its type or aliases, agents' instructions, or what the user's app would run or fetch.
import { Lexer, Marked, type Token } from "marked"
import { effectiveType } from "./fileprops.ts"
import { parseText } from "./frontmatter.ts"
import { type Item, requestWriter, type Vault } from "./vault.ts"

/** The request writing is a guest's. */
export const byGuest = () => requestWriter.getStore()?.client === "guest"

/** What coding agents read as instructions where they work (Claude Code, Codex, Gemini, Amp, aider, Copilot...). */
export const FOR_AGENTS = /^(claude|agents?|gemini|qwen|crush|conventions|skill|copilot-instructions|warp)(\.(local|override))?\.md$/i
/** Code blocks only drawn as code: any other language may be a plugin's block, which runs or fetches (Dataview's JS,
 *  genui, block-*, a chart): a guest adds none, nor a line inside one. */
const PLAIN = new Set(["", "text", "txt", "plain"])
/** What in a guest's words would draw as something live, whatever reads around it: an image or embed (`![`), raw HTML
 *  (`<` and a letter, `/`, `!`, `?`, `%`: Templater's too), Dataview's `$=`, links to the app's or Obsidian's commands. */
const LIVE = /!\[|<[a-z/!?%]|\$=|(vaultite|obsidian):/i
/** A link's or a definition's address (`](x`, `]: x`) in another app's scheme, read as Markdown reads it (escapes and
 *  entities undone): only the web's and mail's are a guest's to add. */
const OTHER_APP = /\](\s*\(|:)\s*<?\s*(?!(https?|mailto):)[a-z][a-z0-9+.-]*:(?!\s)/i
const ENTITY = /&(#x[0-9a-f]+|#\d+|[a-z]+);?/gi
const unescaped = (l: string) => l.replace(/\\/g, "").replace(ENTITY, (m, e: string) => {
  const l2 = e.toLowerCase()
  if (l2[0] !== "#") return ({ colon: ":", sol: "/", lpar: "(", rpar: ")", rsqb: "]", lsqb: "[" } as Record<string, string>)[l2] ?? m
  const n = l2[1] === "x" ? parseInt(l2.slice(2), 16) : parseInt(l2.slice(1), 10)
  return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m
})
/** Every other app's address a link or definition gives in the note, read across lines. */
const otherApps = (text: string) => [...unescaped(text).matchAll(new RegExp(OTHER_APP.source + "[^\\s)>]*", "gi"))].map((m) => m[0].replace(/^\](\s*\(|:)\s*<?\s*/, ""))
/** An added line that draws live (LIVE), or links another app (OTHER_APP). */
const liveLine = (l: string) => LIVE.test(l) || OTHER_APP.test(unescaped(l)) || LIVE.test(unescaped(l))

const norm = (s: string) => s.replace(/^﻿/, "").replace(/\r\n?/g, "\n")

/** A note's fenced code blocks of languages that aren't PLAIN, each as its language and lines (quote marks off). */
function liveBlocks(text: string): string[] {
  const out: string[] = []
  let open: { mark: string; lang: string; lines: string[] } | null = null
  const close = () => { if (open && !PLAIN.has(open.lang)) out.push(`${open.lang}\n${open.lines.join("\n")}`); open = null }
  for (const raw of text.split("\n")) {
    const line = raw.replace(/^(\s*>\s?)+/, "")
    const f = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(line)
    if (!open) { if (f) open = { mark: f[1], lang: f[2].toLowerCase(), lines: [] }; continue }
    if (f && f[1][0] === open.mark[0] && f[1].length >= open.mark.length && !f[2]) close()
    else open.lines.push(line)
  }
  close()
  return out
}

const walker = new Marked()
/** Links' and images' addresses a guest may add: the web's, mail, and the vault's own (no scheme). */
const SAFE = /^(https?:|mailto:|[^:]*$)/i
/** What the text draws live, as Markdown reads it (escapes undone, references resolved): images, raw HTML, links to
 *  other apps' addresses, code of another language. A key each, to tell what's new. */
function liveTokens(text: string): string[] {
  const out: string[] = []
  let tokens: Token[] & { links?: Record<string, { href: string }> }
  try { tokens = new Lexer({ gfm: true }).lex(text) } catch { return ["unreadable"] }
  for (const [k, v] of Object.entries(tokens.links ?? {})) if (!SAFE.test(String(v.href).trim())) out.push(`def:${k}:${v.href}`)
  walker.walkTokens(tokens, (t) => {
    const x = t as Item
    if (t.type === "image") out.push(`img:${x.href}`)
    else if ((t.type === "link" || t.type === "def") && !SAFE.test(String(x.href).trim())) out.push(`link:${x.href}`)
    else if (t.type === "html") out.push(`html:${String(x.raw).trim()}`)
    else if (t.type === "code" && !PLAIN.has(String(x.lang ?? "").trim().toLowerCase())) out.push(`code:${x.lang}:${x.text}`)
    // (Dataview's inline query, `= expr`: the owner's app runs it over the whole vault)
    else if (t.type === "codespan" && /^\s*\$?=/.test(String(x.text))) out.push(`query:${x.text}`)
  })
  return out
}

/** Whether words a guest adds (a comment, a reply: all of it theirs) hold anything live. */
export const liveIn = (text: string) => norm(text).split("\n").some(liveLine) || otherApps(norm(text)).length > 0 || liveBlocks(norm(text)).length > 0 || liveTokens(norm(text)).length > 0

const fmOf = (text: string): Item => { try { return parseText(text)[0] } catch { return {} } }
/** A note's type as the vault reads it (its kind's, `type:`, a key that marks one), and its aliases. */
function headOf(vault: Vault, rel: string, fm: Item) {
  return JSON.stringify([effectiveType(vault.kindFor(rel, fm)?.type ?? null, fm), fm.aliases ?? null, fm.alias ?? null])
}
/** Properties a plugin may draw as a picture (slides' `bg`, a banner...): from the vault only. */
const MEDIA = /^(bg|background|banner|cover|image|images|thumbnail|poster|icon|avatar|photo|picture)$/i
/** A frontmatter's text values, nested ones too, as YAML reads them (escapes undone), each by its key. */
const valuesOf = (v: unknown, key = ""): [string, string][] => typeof v === "string" ? [[key, v]]
  : v && typeof v === "object" ? Object.entries(v).flatMap(([k, x]) => valuesOf(x, Array.isArray(v) ? key : k)) : []
/** A value a guest sets that would draw live (as Markdown, a style, a picture from elsewhere). */
const liveValue = ([k, v]: [string, string]) => liveIn(v) || /(url|image|image-set|cross-fade|element|src)\s*\(/i.test(v) || (MEDIA.test(k) && /[:()]|\/\//.test(v))

/** Why a guest may not write `after` at `rel` (over `before`, null for a new note), or "". Read as the vault reads it. */
export function guestRefusal(vault: Vault, rel: string, before: string | null, after: string): string {
  const was = norm(before ?? ""), now = norm(after)
  if (!/\.md$/i.test(rel)) return "only notes can be written here"
  if (FOR_AGENTS.test(rel.split("/").pop()!)) return `${rel.split("/").pop()} is for agents: it can't be written here`
  const fmWas = fmOf(was), fmNow = fmOf(now)
  if (headOf(vault, rel, fmNow) !== headOf(vault, rel, fmWas)) return "a note's type and aliases can't be changed here"
  const kept = new Set(valuesOf(fmWas).map((x) => JSON.stringify(x)))
  if (valuesOf(fmNow).some((x) => !kept.has(JSON.stringify(x)) && liveValue(x))) return "a property can't hold that here"
  // (added lines, whatever reads around them; and the whole note as Markdown reads it, so what a deletion or a changed
  // reference makes live counts too)
  const had = new Set(was.split("\n")), blocks = new Set(liveBlocks(was)), tokens = new Set(liveTokens(was)), apps = new Set(otherApps(was))
  if (otherApps(now).some((a) => !apps.has(a)) || now.split("\n").some((l) => !had.has(l) && liveLine(l)) || liveBlocks(now).some((b) => !blocks.has(b)) || liveTokens(now).some((k) => !tokens.has(k))) {
    return "images, HTML, code blocks other apps run and links to commands can't be written here"
  }
  return ""
}
