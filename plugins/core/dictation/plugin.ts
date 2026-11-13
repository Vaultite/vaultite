import { z } from "zod"
import { inDesktop, OpError, Plugin } from "../../../core/plugins.ts"
import { Kind } from "../../../core/vault.ts"
import { addEntry, hintOf, readDictionary, readEntries, removeEntry } from "./words.ts"
import type { Entry } from "../../../core/desktop/dictationlearn.ts"

export const plugin = new Plugin(import.meta.url)

const WS = () => process.env.VAULTITE_SONIOX_URL || "wss://stt-rt.soniox.com/transcribe-websocket"
const API = () => process.env.VAULTITE_SONIOX_API || "https://api.soniox.com"
const MODEL = "stt-rt-v6"
export const SET_KEY = `vau secret "Soniox API key" | vau dictation key`

const SECRETS = z.looseObject({ soniox: z.string().optional().catch(undefined) }).catch({})
const stored = () => SECRETS.parse(plugin.secrets()[plugin.id] ?? {})
const keyHere = () => stored().soniox?.trim() ?? ""

const VOCABULARY = ["Vaultite", "vau", "Claude", "Claude Code", "Codex", "Sonnet", "Opus", "Agent SDK"]
const REPLACEMENTS: [string, string][] = [["at Claude", "@claude"]]
const NOTE_NAMES = 40

plugin.kind(new Kind({
  type: "dictionary", collection: "dictionary", file: "Dictionary.md",
  parse: (_fm, body) => [{ body }, []],
  render: (d) => [{}, typeof d.body === "string" ? d.body : ""],
}))
const note = () => plugin.vault.get("dictionary", "dictionary")
const dictionary = () => readDictionary(String(note()?.body ?? ""))
plugin.state(() => ({ dictionary: { note: note() ? `${note()!.id}.md` : null, size: readEntries(String(note()?.body ?? "")).length } }))

export const replacements = (): [string, string][] => [...REPLACEMENTS, ...dictionary().replacements]

const shown = (e: { rel: string; archived: boolean; fm?: Record<string, unknown> | null }) => e.rel.endsWith(".md") && !e.rel.startsWith(".") && !e.archived && !e.fm?.private && e.fm?.companion !== "private"
const stem = (rel: string) => rel.split("/").pop()!.slice(0, -3)
export function terms(): string[] {
  const d = dictionary()
  const added = plugin.allServices("dictation:terms").flatMap((fn) => { try { const t = fn(); return Array.isArray(t) ? t : [] } catch { return [] } })
  const files = [...plugin.vault.entries.values()].filter((e) => shown(e) && e.type !== "dictionary")
  const named = files.filter((e) => e.type === "person" || e.type === "project").map((e) => String(e.item?.name || stem(e.rel)))
  const notes = files.sort((a, b) => (a.stat.ns < b.stat.ns ? 1 : a.stat.ns > b.stat.ns ? -1 : 0))
    .map((e) => stem(e.rel)).filter((n) => n.length >= 3 && n.length <= 40 && !/^\d/.test(n) && n.split(/\s+/).length <= 4)
  return [...new Set([...d.words, ...[...d.replacements, ...REPLACEMENTS].map(hintOf), ...VOCABULARY, ...added.filter((t): t is string => typeof t === "string"), ...named, ...notes.slice(0, NOTE_NAMES)]
    .map((t) => t.trim()).filter(Boolean))].slice(0, 100)
}

plugin.route("GET", "dictation/cloud", async (req) => {
  await plugin.ownerOnly(req, "Dictation's key")
  const s = plugin.settings()
  const engine = s.engine ?? "auto"
  if (plugin.isOff()) return {}
  const expect = { terms: terms(), replacements: replacements(), keep: s.history !== false }
  if (engine !== "auto" && engine !== "soniox") return expect
  const key = keyHere()
  if (!key) return engine === "soniox" ? { why: `No Soniox key on this machine (${SET_KEY})`, ...expect } : expect
  const languages = Array.isArray(s.languages) ? s.languages.filter((l): l is string => typeof l === "string" && !!l.trim()).map((l) => l.trim()) : []
  return { url: WS(), key, model: MODEL, languages, ...expect }
}, { lock: false, sync: false })

plugin.op({
  id: "dictation.key",
  cli: "dictation key",
  mcp: false,
  owner: "Dictation's key",
  summary: "Set this machine's Soniox key: dictation then goes through Soniox's cloud recognizer (this Mac's when it can't), and the companion speaks with Soniox's voice.",
  help: `Kept in this machine's data/config.json, never in the vault; checked with Soniox first. Pipe it in from vau secret, so
it never lands in a transcript. With nothing piped, says whether one is set.

  ${SET_KEY}
  vau dictation key --remove`,
  kind: "write",
  params: {
    key: { type: "string", stdin: true, description: "the Soniox API key (piped in when left out)" },
    remove: { type: "boolean", description: "remove the key: dictation is this Mac's again" },
  },
  lock: false,
  run: async ({ key, remove }, ctx) => {
    if (ctx.who.client === "mcp") throw new OpError("not over MCP: keys stay on the user's machines (vau dictation key, in a terminal)", 403)
    if (remove) { plugin.saveSecrets(null); return { set: false, removed: true } }
    const k = typeof key === "string" ? key.trim() : ""
    if (!k) return { set: !!keyHere() }
    if (!/^[\x21-\x7e]{8,200}$/.test(k)) throw new OpError("that isn't a Soniox key (one line, no spaces)")
    const r = await fetch(`${API()}/v1/models`, { headers: { Authorization: `Bearer ${k}` }, signal: AbortSignal.timeout(8000) }).catch(() => null)
    if (r && (r.status === 401 || r.status === 403)) throw new OpError("Soniox refused this key: check it in Soniox's console", 400)
    plugin.saveSecrets({ ...stored(), soniox: k })
    return { set: true, checked: !!r?.ok }
  },
  text: (r: { set: boolean; removed?: boolean; checked?: boolean }) => r.removed ? "Removed the Soniox key: dictation is this Mac's." :
    r.checked === undefined ? (r.set ? "A Soniox key is set: dictation goes through Soniox." : `No Soniox key here: ${SET_KEY}`) :
    `Set the Soniox key${r.checked ? "" : " (Soniox didn't answer, so it isn't checked)"}: dictation goes through Soniox.`,
  did: (p) => ({ action: "settings", text: p.remove ? "Removed the Soniox key" : p.key ? "Set the Soniox key" : "Checked for a Soniox key" }),
})

const clean = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 100) : "")
const entryOf = (p: Record<string, unknown>): Entry => {
  const word = clean(p.word), said = clean(p.said)
  if (!word) throw new OpError("say which word with `word`")
  if (/[\n:]\s/.test(word) || said.includes(": ")) throw new OpError("a word, without \": \" (what's said goes in `said`)")
  return said && said.toLowerCase() !== word.toLowerCase() ? { word, said } : { word }
}
let changing: Promise<unknown> = Promise.resolve()
function changeDictionary(change: (body: string) => { body: string; did: boolean }) {
  const next = changing.then(async () => {
    const old = note(), r = change(String(old?.body ?? ""))
    const saved = r.did ? await plugin.vault.save("dictionary", { body: r.body }, old?.id ?? null) : old
    return { path: saved ? `${saved.id}.md` : null, did: r.did }
  })
  changing = next.catch(() => {})
  return next
}
const named = (e: Entry) => (e.said ? `"${e.said}" as ${e.word}` : e.word)

plugin.op({
  id: "dictation.add",
  cli: "dictation add",
  summary: "Teach dictation a word it gets wrong (a name, a project, jargon), or what it mishears it as: every recognizer expects it from then on.",
  help: `The dictionary is a note of the user's, Dictionary.md (type: dictionary): a "- word" line each, or "- said: written"
for what dictation writes wrong and what's written instead. Dictation adds the words the user fixes right after saying
them. Add one when the user spells a word out or it keeps being misheard. \`fixed\`: the user's fix of a word just
said (\`said\` what dictation wrote): the word goes in first, then, misheard again, what it was misheard as.

  vau dictation add Vorssaint
  vau dictation add Olimpicos --said Olympicos`,
  kind: "write",
  params: {
    word: { type: "string", description: "the word or name as it's written" },
    said: { type: "string", description: "what dictation writes instead (\"Olympicos\"): replaced by `word` as it's heard" },
    fixed: { type: "boolean", description: "the user's fix of a word just dictated, `said` what dictation wrote" },
  },
  args: ["word"],
  lock: false,
  run: async (p) => {
    let e = entryOf(p)
    if (p.fixed) {
      const w = e.word.toLowerCase(), learned = plugin.kept<string[]>("learned", []), known = dictionary().words.some((x) => x.toLowerCase() === w)
      if (learned.includes(w) && !known) return { path: note() ? `${note()!.id}.md` : null, added: null, entry: e, unlearned: true }
      if (!known) e = { word: e.word }
      if (!learned.includes(w)) plugin.keep("learned", [...learned, w].slice(-2000), { shared: true })
    }
    const r = await changeDictionary((body) => addEntry(body, e))
    return { path: r.path, added: r.did ? e : null, entry: e }
  },
  text: (r: { path: string | null; added: Entry | null; entry: Entry; unlearned?: boolean }) => (r.added ? `Added ${named(r.added)} to the dictionary (${r.path}).` :
    r.unlearned ? `${r.entry.word} was taken out of the dictionary, so it isn't learned again (vau dictation add ${r.entry.word} adds it).` : `${named(r.entry)} is in the dictionary already.`),
  did: (p) => ({ action: "edit", text: `Added ${clean(p.word)} to the dictionary` }),
})

plugin.op({
  id: "dictation.remove",
  cli: "dictation remove",
  summary: "Take a word (or a \"said: written\" line, with `said`) out of dictation's dictionary.",
  kind: "write",
  params: {
    word: { type: "string", description: "the word as it's written" },
    said: { type: "string", description: "the replacement's said words, to take that line out" },
  },
  args: ["word"],
  lock: false,
  run: async (p) => {
    const e = entryOf(p), r = await changeDictionary((body) => removeEntry(body, e))
    return { path: r.path, removed: r.did, entry: e }
  },
  text: (r: { removed: boolean; entry: Entry }) => (r.removed ? `Took ${named(r.entry)} out of the dictionary.` : `${named(r.entry)} isn't in the dictionary.`),
  did: (p) => ({ action: "edit", text: `Took ${clean(p.word)} out of the dictionary` }),
})

plugin.op({
  id: "dictation.words",
  cli: "dictation words",
  summary: "The words dictation expects and what it replaces: the dictionary's, then the vault's names and Vaultite's.",
  kind: "read",
  params: {},
  run: () => ({ path: note() ? `${note()!.id}.md` : null, dictionary: readEntries(String(note()?.body ?? "")), replacements: replacements(), expected: terms() }),
  text: (r: { path: string | null; dictionary: Entry[]; replacements: [string, string][]; expected: string[] }) => [
    r.path ? `Dictionary (${r.path}): ${r.dictionary.length ? r.dictionary.map(named).join(", ") : "empty"}` : "No dictionary yet (vau dictation add <word> makes Dictionary.md).",
    `Replaced as heard: ${r.replacements.map(([s, w]) => `${s} → ${w}`).join(", ")}`,
    `Expected (${r.expected.length}): ${r.expected.join(", ")}`,
  ].join("\n"),
})

type Landing = "in" | "front" | "origin" | "clipboard" | "cancelled" | "lost" | "live"
export type DictationItem = { id: string; t: number; text: string; kind: "dictation" | "companion"
  where: { kind: "note" | "terminal" | "field" | "app" | "companion"; path?: string; name?: string; bundle?: string }
  landing?: Landing; inbox?: boolean; why?: string
  said?: string; who?: string }
const loose = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase()
const OWNER = "Your dictations"

plugin.op({
  id: "dictation.history",
  cli: "dictation history",
  mcp: false,
  owner: OWNER,
  summary: "What the user dictated lately, newest first: each dictation's words, where they went (a note, a terminal, a field, another app) or that they never landed, and what they said to the companion.",
  help: `Kept about 30 days by the desktop app on this machine (its app data, never the vault or another machine), unless
Keep dictations is off (the setting \`history\`). Talk key asks come from the companion's own log. \`here\` false: no Mac app
serves this vault here, so only the companion's asks show.

  vau dictation history
  vau dictation history --q "milk" --limit 20`,
  kind: "read",
  lock: false,
  params: {
    q: { type: "string", description: "only those whose words (or where they went) have every word of this, any case or accent" },
    limit: { type: "number", description: "how many, newest first (default 200)" },
    companion: { type: "boolean", description: "false: leave out what was said to the companion" },
  },
  run: async (p) => {
    const q = typeof p.q === "string" ? p.q.trim().slice(0, 200) : "", limit = Math.max(1, Math.min(1000, Number(p.limit) || 200))
    const got = (inDesktop() ? await plugin.desktop("dictations:list", { q, limit }).catch(() => null) : null) as { items?: DictationItem[]; total?: number; here?: boolean } | null
    const words = loose(q).split(/\s+/).filter(Boolean)
    const asks = p.companion === false ? [] : (await plugin.ask<{ t: number; text: string; where: string; said: string; who?: string }[]>("voice:asks", [], 30))
      .filter((a) => { const hay = loose(`${a.text} ${a.where}`); return words.every((w) => hay.includes(w)) })
      .map((a): DictationItem => ({ id: `c-${a.t}`, t: a.t, text: a.text, kind: "companion", where: { kind: "companion", ...(a.where ? { name: a.where } : {}) }, ...(a.said ? { said: a.said } : {}), ...(a.who ? { who: a.who } : {}) }))
    const mine = (got?.items ?? []).map((x) => ({ ...x, kind: "dictation" as const }))
    const items = [...mine, ...asks].sort((a, b) => b.t - a.t).slice(0, limit)
    return { here: got?.here === true, keep: plugin.settings().history !== false, items, total: (got?.total ?? 0) + asks.length }
  },
  text: (r: { here: boolean; keep: boolean; items: DictationItem[] }) => [
    !r.here ? "Dictations are kept on each Mac, by its Vaultite app: none serves this vault here." : !r.keep ? "Keep dictations is off: new ones aren't kept." : "",
    ...r.items.map((x) => `${new Date(x.t).toISOString().slice(0, 16).replace("T", " ")} ${x.kind === "companion" ? "to the companion" : landingSaid(x)}: ${x.text.replace(/\s+/g, " ").slice(0, 300)}`),
    r.items.length ? "" : "Nothing dictated lately.",
  ].filter(Boolean).join("\n"),
})

export function landingSaid(x: Pick<DictationItem, "where" | "landing" | "inbox" | "why">) {
  const w = x.where, at = w.kind === "note" ? (w.path ?? "a note").replace(/\.md$/, "") : w.kind === "terminal" ? (w.name ?? "a terminal") : w.kind === "field" ? (w.name ?? "a field") : (w.name ?? "another app")
  if (x.landing === "clipboard") return x.inbox ? "copied, and in the inbox" : "copied"
  if (x.landing === "cancelled") return `cancelled, never typed in ${at}`
  if (x.landing === "lost") return `never landed (${x.why === "closed" ? "the app closed" : x.why === "failed" ? "dictation failed" : "nowhere to type"})`
  if (x.landing === "live") return `listening, into ${at}`
  return `into ${at}`
}

plugin.op({
  id: "dictation.forget",
  cli: "dictation forget",
  mcp: false,
  owner: OWNER,
  summary: "Take one dictation out of the Dictations list (by its id, dictation history); the companion's asks stay in its log.",
  kind: "write",
  lock: false,
  params: { id: { type: "string", description: "the dictation's id" } },
  args: ["id"],
  run: async (p) => {
    const id = typeof p.id === "string" ? p.id : ""
    if (!/^d-[\w-]+$/.test(id)) throw new OpError("say which dictation with `id` (a d-… one, from dictation history)")
    if (!inDesktop()) throw new OpError("no Mac app serves this vault here: dictations are kept on each Mac", 409)
    await plugin.desktop("dictations:forget", { id })
    return { forgotten: id }
  },
  text: () => "Took it out of the Dictations list.",
  did: () => ({ action: "edit", text: "Took a dictation out of the list" }),
})

plugin.op({
  id: "dictation.clear",
  cli: "dictation clear",
  mcp: false,
  owner: OWNER,
  summary: "Clear the Dictations list on this machine: every dictation's words the desktop app kept go (the companion's asks stay in its log).",
  kind: "write",
  lock: false,
  params: {},
  run: async () => {
    const r = inDesktop() ? await plugin.desktop("dictations:clear").catch(() => null) : null
    if (!r) throw new OpError("no Mac app serves this vault here: dictations are kept on each Mac, so clear them there", 409)
    return { cleared: true }
  },
  text: () => "Cleared the dictations kept on this Mac.",
  did: () => ({ action: "settings", text: "Cleared the Dictations list" }),
})
