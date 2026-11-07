// Soniox's key is this machine's (data/config.json, `dictation.soniox`), never the vault's: the desktop app asks for it
// to dictate (electron/dictation.ts) and for the companion's voice (companion/voice.ts), and streams to Soniox itself.
import { OpError, Plugin } from "../../../core/plugins.ts"
import { Kind } from "../../../core/vault.ts"
import { addEntry, type Entry, hintOf, readDictionary, readEntries, removeEntry } from "./words.ts"

export const plugin = new Plugin(import.meta.url)

// (tests point these at a stand-in)
const WS = () => process.env.VAULTITE_SONIOX_URL || "wss://stt-rt.soniox.com/transcribe-websocket"
const API = () => process.env.VAULTITE_SONIOX_API || "https://api.soniox.com"
const MODEL = "stt-rt-v6"
export const SET_KEY = `vau secret "Soniox API key" | vau dictation key`

const stored = () => (plugin.secrets()[plugin.id] ?? {}) as { soniox?: unknown }
const keyHere = () => { const k = stored().soniox; return typeof k === "string" && k.trim() ? k.trim() : "" }

/** Words a recognizer gets wrong unless told (Vaultite's own, the agents'), always expected. */
const VOCABULARY = ["Vaultite", "vau", "Claude", "Claude Code", "Codex", "Sonnet", "Opus", "Agent SDK"]
/** What's always written for what's said, before the dictionary's. */
const REPLACEMENTS: [string, string][] = [["at Claude", "@claude"]]
/** How many of the vault's note names, newest first, go to the recognizer with them. */
const NOTE_NAMES = 40

// ---------- the dictionary: the user's words, learned from their fixes or added (Dictionary.md, words.ts)

plugin.kind(new Kind({
  type: "dictionary", collection: "dictionary", file: "Dictionary.md",
  parse: (_fm, body) => [{ body }, []],
  render: (d) => [{}, typeof d.body === "string" ? d.body : ""],
}))
const note = () => plugin.vault.get("dictionary", "dictionary")
const dictionary = () => readDictionary(String(note()?.body ?? ""))
plugin.state(() => ({ dictionary: { note: note() ? `${note()!.id}.md` : null, size: readEntries(String(note()?.body ?? "")).length } }))

/** What's written for what's said: Vaultite's, then the dictionary's. */
export const replacements = (): [string, string][] => [...REPLACEMENTS, ...dictionary().replacements]

const shown = (e: { rel: string; archived: boolean; fm?: Record<string, unknown> | null }) => e.rel.endsWith(".md") && !e.rel.startsWith(".") && !e.archived && !e.fm?.private && e.fm?.companion !== "private"
const stem = (rel: string) => rel.split("/").pop()!.slice(0, -3)
/** The words dictation expects: the dictionary's, Vaultite's, what plugins add ("dictation:terms": the companion's
 *  names), the people's and projects' names, and the names of the notes changed last (not dates, not archived or private). */
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

/** Whether Soniox hears dictation here, with its key; `why` when the engine asked for is Soniox but there's no key.
 *  Either way, the words it should expect (`terms`). */
plugin.route("GET", "dictation/cloud", async (req) => {
  await plugin.ownerOnly(req, "Dictation's key")
  const s = plugin.settings()
  const engine = s.engine ?? "auto"
  if (plugin.isOff()) return {}
  const expect = { terms: terms(), replacements: replacements() }
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
    // (a key Soniox refuses isn't kept; unreachable, it's kept unchecked)
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
/** The dictionary changed by `change`, saved when it did: made (Dictionary.md) when there's none yet. */
async function changeDictionary(change: (body: string) => { body: string; did: boolean }) {
  const old = note(), r = change(String(old?.body ?? ""))
  const saved = r.did ? await plugin.vault.save("dictionary", { body: r.body }, old?.id ?? null) : old
  return { path: saved ? `${saved.id}.md` : null, did: r.did }
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
      // (a fix teaches the word; the same word misheard again, what it's misheard as. One the user took out (Undo, by
      // hand) isn't learned again, as Wispr Flow does)
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
