// Provenance: `origin`, a label never a lock: new notes get the agent value or (with `label_user`) the human one; other
// files keep theirs in files.json, their bytes never changed (an AI's mark already in them is read: xmp.ts).
import fs from "node:fs"
import { OpError, Plugin, vaultPath } from "../../../core/plugins.ts"
import { isHiddenPath, readText, setPropertyText, type Vault, type Writer } from "../../../core/vault.ts"
import { saysAi } from "./xmp.ts"

export const plugin = new Plugin(import.meta.url)

/** The values when its settings have none, most yours first. */
export const DEFAULT_VALUES = [
  { value: "human", label: "Human", icon: "user", tint: "green", hint: "You wrote it" },
  { value: "reviewed", label: "Reviewed", icon: "user-check", tint: "blue", hint: "AI, read by you" },
  { value: "mixed", label: "Mixed", icon: "blend", tint: "teal", hint: "You and AI both wrote it" },
  { value: "ai", label: "AI", icon: "bot", tint: "purple", hint: "Not reviewed" },
]

/** Its settings' values (as written: the app reads them leniently), else the defaults. */
export const values = () => {
  const v = plugin.settings().values
  return Array.isArray(v) && v.length ? v : DEFAULT_VALUES
}
/** The values as written in files. */
const valueNames = () => values().map((v: unknown) => String(v && typeof v === "object" ? (v as { value?: unknown }).value ?? "" : v)).filter(Boolean)

/** The value agents' files get: the `agent` setting, ai when it isn't set. */
const aiValue = () => {
  const a = plugin.settings().agent
  return typeof a === "string" && a.trim() ? a.trim() : "ai"
}

/** What agents' new notes are labelled: the `agent` setting (ai when it isn't set), or nothing with `label_agents` off. */
const agentValue = () => (plugin.settings().label_agents === false ? "" : aiValue())

/** Whether the user's own new notes are labelled (`label_user`, off unless set). */
const labelsUser = () => plugin.settings().label_user === true

plugin.state(() => ({ provenance: { values: values(), defaults: DEFAULT_VALUES, labelUser: labelsUser() } }))

/** Not the user: anyone but the app (`app/<device>`) and the vau CLI typed by hand (`cli` naming no coding agent). */
export const byAgent = (w: Writer | null) => !!w && !w.client?.startsWith("app/") && !(w.client === "cli" && !w.agent)

/** What the user's new notes are labelled: the first value (human by default), or nothing with `label_user` off. */
const userValue = () => {
  if (!labelsUser()) return ""
  const v = values()[0]
  return typeof v?.value === "string" ? v.value : ""
}

/** What the user said or wrote, made by another plugin's backend (Inbox's voice notes): the label to give it. */
plugin.provide("provenance:user", userValue)
/** And what an agent's are labelled (an AI app's note for the inbox). */
plugin.provide("provenance:agent", agentValue)

plugin.onCreate((path, fm, writer) => {
  if (!writer || path.startsWith(".")) return
  // Notes: a note, or a file no kind owns and whose frontmatter names no type (a plain note); not templates.
  const kind = plugin.vault.kindFor(path, fm) // (its `type`, wherever it is)
  const type = kind ? kind.type : typeof fm.type === "string" && fm.type.trim() ? fm.type : null
  if (type !== null && type !== "note") return
  const templates = String(plugin.peer("templates")?.settings().folder ?? "Templates").replace(/^\/+|\/+$/g, "")
  if (templates && path.startsWith(templates + "/")) return
  const label = byAgent(writer) ? agentValue() : userValue()
  return label ? { origin: label } : undefined
})

// ---------- other files: the list

const FILES = "files" // .vaultite/plugins/provenance/files.json: { "<vault path>": "<value>" }
type List = Record<string, string>

/** The labels of files that aren't Markdown, by path. */
const listed = () => plugin.settings({}, FILES) as List

/** Change the list (read from disk, so nothing another write made is lost); written only when it changed, sorted. */
function relist(change: (list: List) => void) {
  const cur = (plugin.readSettings(FILES) ?? {}) as List, next = { ...cur }
  change(next)
  if (JSON.stringify(next) === JSON.stringify(cur)) return
  const keys = Object.keys(next).sort()
  plugin.saveSettings(keys.length ? Object.fromEntries(keys.map((k) => [k, next[k]])) : null, FILES)
}

const isNote = (rel: string) => /\.md$/i.test(rel)
const under = (rel: string, dir: string) => rel === dir || rel.startsWith(`${dir}/`)

// A new file an agent or the user makes through the API (an upload, an SVG): labelled like a new note, in the list
// (its bytes as they came). One whose bytes already say an AI made it reads that way.
plugin.onCreateFile((rel, file, writer) => {
  if (!writer || isHiddenPath(rel)) return
  const agent = byAgent(writer)
  // (its head and tail, as scan reads them: an upload can be any size)
  const says = () => file.size <= HEAD + TAIL ? saysAi(file.head(file.size)) : saysAi(file.head(HEAD), file.tail(TAIL))
  const label = agent ? agentValue() : says() ? "" : userValue()
  try {
    relist((l) => { if (label) l[rel] = label; else delete l[rel] })
  } catch (e) { console.error(`provenance: couldn't label ${rel}: ${(e as Error).message}`) }
})

// Labels follow their files: moved, into the trash and back; a file deleted for good loses its (onSync).
plugin.onMove((from, to, trashed) => {
  const dest = to ?? trashed ?? null
  const follow = (keys: string[], put: (k: string, at: string | null) => void) => {
    for (const k of keys) if (under(k, from)) put(k, dest === null ? null : dest + k.slice(from.length))
  }
  relist((l) => follow(Object.keys(l), (k, at) => { const v = l[k]; delete l[k]; if (at) l[at] = v }))
  const s = seen()
  follow([...s.keys()], (k, at) => { const v = s.get(k)!; s.delete(k); if (at) s.set(at, v) })
})

// ---------- other files: what their bytes say (an image from ChatGPT or Gemini carries IPTC's label, or C2PA's)

/** The files whose bytes can say it: images and videos. */
const SCANNED = /\.(png|jpe?g|webp|gif|heic|heif|avif|tiff?|svg|mp4|m4v|mov)$/i
/** How much of a file is read: its head and its tail (where XMP and C2PA sit), never a whole video. */
const HEAD = 512 << 10, TAIL = 256 << 10

/** Files read so far: path -> [its stat when read, whether it says AI]; kept in its cache, so each is read once. */
let read: Map<string, [string, boolean]> | null = null
let readVersion = 0
function seen() {
  if (!read) {
    const files = plugin.readCache()?.files
    read = new Map(files && typeof files === "object" ? Object.entries(files as Record<string, string>).map(([k, v]) => {
      const [stamp, ai] = String(v).split(" ")
      return [k, [stamp, ai === "1"]] as [string, [string, boolean]]
    }) : [])
  }
  return read
}
const stampOf = (vault: Vault, rel: string) => { const st = vault.others.get(rel); return st ? `${st.size}:${st.ns}` : null }

/** Whether a file's bytes say an AI made it; null when it can't be read now (`local`: one iCloud keeps only in the
 *  cloud isn't brought down for this). */
async function scan(abs: string, local: boolean): Promise<boolean | null> {
  let fh: fs.promises.FileHandle | undefined
  try {
    const st = await fs.promises.stat(abs)
    if (local && st.blocks === 0 && st.size > 0) return null
    fh = await fs.promises.open(abs, "r")
    if (st.size <= HEAD + TAIL) return saysAi((await fh.read(Buffer.alloc(st.size), 0, st.size, 0)).buffer)
    const head = (await fh.read(Buffer.alloc(HEAD), 0, HEAD, 0)).buffer
    return saysAi(head, (await fh.read(Buffer.alloc(TAIL), 0, TAIL, st.size - TAIL)).buffer)
  } catch {
    return null
  } finally {
    await fh?.close()
  }
}

/** What the bytes of a file that isn't a note say: read now when they weren't since it last changed. */
async function fileSays(vault: Vault, rel: string, local = false) {
  const stamp = stampOf(vault, rel)
  if (!stamp || !SCANNED.test(rel)) return false
  const had = seen().get(rel)
  if (had?.[0] === stamp) return had[1]
  const ai = await scan(vault.abs(rel), local)
  if (ai === null) return null
  seen().set(rel, [stamp, ai])
  readVersion++
  return ai
}

/** Write what was read to its cache (files gone dropped, unless part of the vault is missing for now). */
function keep(vault: Vault) {
  const s = seen()
  if (!vault.waiting()) for (const k of [...s.keys()]) if (!vault.others.has(k)) s.delete(k)
  plugin.writeCache({ files: Object.fromEntries([...s].map(([k, [stamp, ai]]) => [k, `${stamp} ${ai ? 1 : 0}`])) })
}

// New and changed files are read in the background, off any request, so database views can filter on what they say.
let todo = new Set<string>(), busy = false, lastVersion = -1
async function readAll(vault: Vault) {
  busy = true
  let n = 0
  try {
    for (const rel of todo) {
      todo.delete(rel)
      const before = readVersion
      await fileSays(vault, rel, true)
      if (readVersion !== before && ++n % 200 === 0) keep(vault)
    }
  } catch (e) {
    console.error("provenance: reading files:", e)
  } finally {
    busy = false
    if (n) try { keep(vault) } catch (e) { console.error("provenance:", e) }
  }
}

// What's labelled in the trash (the index doesn't see it), read again when the list changes.
let inTrash: string[] = [], trashVersion = -1
plugin.onSync((vault) => {
  // What was in the trash and is gone for good loses its label.
  if (vault.settingsVersion !== trashVersion) {
    trashVersion = vault.settingsVersion
    inTrash = Object.keys(listed()).filter((k) => k.startsWith(".trash/"))
  }
  const gone = (k: string) => k.startsWith(".trash/") && !fs.existsSync(vault.abs(k))
  if (inTrash.some(gone)) try { relist((l) => { for (const k of Object.keys(l)) if (gone(k)) delete l[k] }) } catch { /* next time */ }
  if (vault.version === lastVersion) return
  lastVersion = vault.version
  const s = seen()
  for (const rel of vault.others.keys()) if (SCANNED.test(rel) && s.get(rel)?.[0] !== stampOf(vault, rel)) todo.add(rel)
  if (todo.size && !busy) void readAll(vault)
})

plugin.onUnload(() => { todo = new Set() })

/** Other files' `origin` for database views over every file (a .base): the list's, else what the bytes say. */
plugin.provide("file-props", () => {
  const vault = plugin.vault, l = listed(), s = seen(), ai = aiValue()
  return {
    version: `${vault.settingsVersion}:${readVersion}`,
    of: (rel: string) => {
      if (l[rel]) return { origin: l[rel] }
      const had = s.get(rel)
      return had?.[1] && had[0] === stampOf(vault, rel) ? { origin: ai } : {}
    },
  }
})

// ---------- any file's label, read and set (the app's chip on files that aren't notes, vau origin, MCP's call)

type Origin = { path: string; origin: string | null; from: "frontmatter" | "list" | "file" | null }

/** A file's label and where it comes from: a note's frontmatter, the list, or (for an unlabelled one) its bytes. */
async function originOf(vault: Vault, rel: string): Promise<Origin> {
  if (isNote(rel)) {
    const v = vault.entries.get(rel)?.fm.origin
    const has = v !== undefined && v !== null && v !== ""
    return { path: rel, origin: has ? String(v) : null, from: has ? "frontmatter" : null }
  }
  const l = listed()[rel]
  if (l) return { path: rel, origin: l, from: "list" }
  const before = readVersion
  const ai = await fileSays(vault, rel)
  if (readVersion !== before) try { keep(vault) } catch { /* kept next time */ }
  return ai ? { path: rel, origin: aiValue(), from: "file" } : { path: rel, origin: null, from: null }
}

/** A file in the vault that can be labelled: there, not a folder, not hidden. */
function labelled(vault: Vault, path: unknown) {
  const rel = vaultPath(path, true, vault)
  if (fs.statSync(vault.abs(rel)).isDirectory()) throw new OpError(`${rel} is a folder: label the files in it`)
  if (isHiddenPath(rel)) throw new OpError(`${rel} is hidden: it can't be labelled`)
  return rel
}

plugin.route("GET", "provenance/origin", (req) => originOf(plugin.vault, labelled(plugin.vault, req.query.path)))

const PATH = { type: "string", format: "path", required: true, description: "the file (a path, or a name as the user says it)" } as const
const said = (r: Origin) => (r.origin
  ? `${r.path}: origin ${r.origin}${r.from === "file" ? " (not labelled: its bytes say an AI made it)" : ""}.`
  : `${r.path}: unlabeled.`)

plugin.op({
  id: "provenance.get",
  cli: "origin",
  summary: "Who made a file (its origin: human, reviewed, mixed, ai): a note, an image, a PDF, any file.",
  help: `A note's origin is its frontmatter key; any other file's (images, videos, PDFs) is in Provenance's list
(.vaultite/plugins/provenance/files.json), and one not in it whose bytes carry the IPTC label for AI-made media
(ChatGPT's and Gemini's images do) reads as the agents' value, ai. from says which: frontmatter, list or file.

  vau origin Attachments/Chart.png
  vau origin "Notes/Garden plan.md"`,
  kind: "read",
  params: { path: PATH },
  args: ["path"],
  run: async ({ path }, ctx) => originOf(ctx.vault, labelled(ctx.vault, path)),
  text: (r) => said(r),
})

plugin.op({
  id: "provenance.set",
  cli: "origin set",
  summary: "Label who made a file (origin): a note's frontmatter key, any other file's entry in Provenance's list (its bytes never change).",
  help: `The value is one of Provenance's values (human, reviewed, mixed, ai by default); none removes the label. An agent
labels only with the agents' value (ai), and only what it made: human, reviewed and mixed are the user's to give, in
the app or with vau typed by hand.

  vau origin set Attachments/Chart.png ai
  vau origin set "Photos/Beach.jpg" human
  vau origin set Attachments/Chart.png`,
  kind: "write",
  params: { path: PATH, origin: { type: "string", description: "one of the values (human, reviewed, mixed, ai); none removes the label" } },
  args: ["path", "origin"],
  run: async ({ path, origin }, ctx) => {
    const rel = labelled(ctx.vault, path)
    const given = String(origin ?? "").trim()
    const value = given ? valueNames().find((v) => v.toLowerCase() === given.toLowerCase()) : ""
    if (value === undefined) throw new OpError(`origin is one of ${valueNames().join(", ")}, or none to remove the label`)
    if (byAgent(ctx.who) && value !== aiValue()) {
      throw new OpError(`an agent labels files only ${aiValue()}: ${value ? `${value} is` : "removing a label is"} the user's to do, in the app or with vau typed by hand`, 403)
    }
    if (isNote(rel)) {
      const text = readText(ctx.vault.abs(rel)), next = setPropertyText(text, "origin", value || undefined)
      if (next === null) throw new OpError(`${rel}'s frontmatter can't be changed line by line: edit it by hand`)
      if (next !== text) await ctx.api("PUT", "file", { path: rel, text: next, base: text })
    } else {
      relist((l) => { if (value) l[rel] = value; else delete l[rel] })
    }
    return await originOf(ctx.vault, rel)
  },
  text: (r) => said(r),
})
