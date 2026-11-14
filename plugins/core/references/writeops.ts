import { z } from "zod"
import { htmlToMarkdown, OpError, type Plugin } from "../../../core/plugins.ts"
import type { OpCtx } from "../../../core/ops.ts"
import { bareDoi } from "./csl.ts"
import { markdownOf } from "./format.ts"
import { identify, lookUp, LookupError } from "./identifiers.ts"
import { type Entry, lookup } from "./library.ts"
import { DEFAULT_FOLDER, DEFAULT_TEMPLATE, fileNameFor, fillTemplate, noteFrontmatter } from "./literature.ts"
import { makeKey } from "./parse/keys.ts"
import type { References } from "./refs.ts"
import { shownEntries } from "./answers.ts"
import { statusOf, statusText } from "./status.ts"
import { annotationsOf } from "./zotero/annotations.ts"

const Made = z.looseObject({ path: z.string() })

export function literatureFolder(refs: References): string {
  const set = refs.host.settings().folder.trim().replace(/^\/+|\/+$/g, "")
  if (set) return set
  const count = new Map<string, number>()
  for (const { rel } of refs.host.notes()) { const dir = rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ""; count.set(dir, (count.get(dir) ?? 0) + 1) }
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] ?? DEFAULT_FOLDER
}

async function annotations(refs: References, e: Entry) {
  if (!e.zotero) return ""
  try { return await annotationsOf(refs.host.zotero.conn(e.zotero.web, refs.host.webKey()), e.zotero, (h) => htmlToMarkdown(h)) } catch { return "" }
}

function templateText(refs: References) {
  const t = refs.host.settings().template.trim()
  if (!t) return DEFAULT_TEMPLATE
  const rel = /\.md$/i.test(t) ? t : `${t}.md`
  const text = refs.host.textOf(rel)
  return text === null ? DEFAULT_TEMPLATE : text.replace(/^---\n[\s\S]*?\n---\n?/, "")
}

export async function literatureNote(refs: References, ctx: OpCtx, key: string, own = false): Promise<{ path: string; created: boolean }> {
  const lib = refs.library()
  const had = lib.notes.get(key) ?? lib.notes.get(lib.aliases.get(key) ?? "")
  if (had) return { path: had, created: false }
  const e = lookup(lib, key)
  if (!e) throw new OpError(`@${key} isn't in the library: references.search finds keys, references.add adds one by DOI, arXiv id or ISBN`, 404)
  const { shown } = await shownEntries(refs, [e.key])
  const body = fillTemplate(templateText(refs), e, { bibliography: shown[0] ? markdownOf(shown[0].html) : "", annotations: await annotations(refs, e) })
  const path = `${literatureFolder(refs)}/${fileNameFor(e.key)}.md`.replace(/^\//, "")
  const made = Made.parse(await ctx.api("POST", "file", { path, text: `${noteFrontmatter(e, own)}\n${body}`, unique: true }))
  return { path: made.path, created: true }
}

function noteOp(plugin: Plugin, refs: References) {
  plugin.op({
    id: "references.note",
    cli: "references note",
    summary: "The literature note for a reference: the one there is, else a new one (type: reference, its citekey) in the literature notes' folder, from the user's template, with Zotero's notes and PDF annotations.",
    kind: "write",
    params: { key: { type: "string", required: true, description: "the citekey (with or without @)" } },
    args: ["key"],
    run: async (p, ctx) => literatureNote(refs, ctx, p.key.replace(/^\[?-?@|\]$/g, "").trim()),
    text: (r) => (r.created ? `Made the literature note ${r.path}.` : `Its literature note is ${r.path}.`),
    did: (p) => ({ action: "create", text: `Literature note for @${p.key.replace(/^@/, "")}` }),
  })
}

function addOp(plugin: Plugin, refs: References) {
  plugin.op({
    id: "references.add",
    cli: "references add",
    summary: "Add a reference to the library by its DOI, arXiv id or ISBN (looked up at doi.org or Open Library): a reference note holding its details, cited by the key it answers.",
    help: `For a work in no reference manager. Already in the library (the same DOI): its key, nothing added. Only on the
user's asking: it reaches doi.org, or Open Library for a book.

  vau references add 10.1145/227181.227186
  vau references add arXiv:1706.03762
  vau references add 978-1542866507`,
    kind: "write",
    params: { identifier: { type: "string", required: true, description: "a DOI (or doi.org link), an arXiv id or link, or an ISBN" } },
    args: ["identifier"],
    run: async (p, ctx) => {
      const id = identify(p.identifier)
      if (!id) throw new OpError("that isn't a DOI, an arXiv id or an ISBN")
      const lib = refs.library()
      const doi = id.kind === "doi" ? id.id.toLowerCase() : ""
      const same = doi ? [...lib.entries.values()].find((e) => bareDoi(e.item.DOI ?? "").toLowerCase() === doi) : undefined
      if (same) return { key: same.key, path: lib.notes.get(same.key) ?? null, already: true, title: same.item.title ?? "" }
      const item = await lookUp(id).catch((e) => { throw new OpError(e instanceof LookupError ? `Couldn't look it up: ${e.message}` : "Couldn't look it up", e instanceof LookupError ? e.status : 502) })
      const key = makeKey(item, new Set([...lib.entries.keys(), ...lib.aliases.keys(), ...lib.notes.keys()]))
      const e: Entry = { key, item: { ...item, id: key }, origin: "note", label: "" }
      const text = `${noteFrontmatter(e, true)}\n${fillTemplate(DEFAULT_TEMPLATE, e, { bibliography: "", annotations: "" })}`
      const path = `${literatureFolder(refs)}/${fileNameFor(key)}.md`
      const made = Made.parse(await ctx.api("POST", "file", { path, text, unique: true }))
      return { key, path: made.path, already: false, title: item.title ?? "" }
    },
    text: (r) => (r.already ? `Already in the library as @${r.key}${r.path ? ` (${r.path})` : ""}.` : `Added @${r.key} (${r.title}) as ${r.path}: cite it as [@${r.key}].`),
    did: (p) => ({ action: "create", text: `Added a reference (${p.identifier.trim().slice(0, 80)})` }),
  })
}

function statusOp(plugin: Plugin, refs: References) {
  plugin.op({
    id: "references.status",
    cli: "references status",
    summary: "Where the library comes from and how each source is: bibliography files (with what couldn't be read), Zotero on this computer and on zotero.org, reference notes; the style and language.",
    kind: "read",
    params: { sync: { type: "boolean", description: "read Zotero again first" } },
    run: async (p) => {
      if (p.sync) await refs.host.zotero.refresh(refs.zoteroOptions(), true)
      return statusOf(refs)
    },
    text: statusText,
    did: (p) => ({ action: "run", text: p.sync ? "Synced the reference library" : "Looked at the reference library" }),
  })
}

function zoteroKeyOp(plugin: Plugin, refs: References) {
  plugin.op({
    id: "references.zotero-key",
    cli: "references zotero-key",
    mcp: false,
    owner: "the Zotero key",
    summary: "Set this machine's Zotero web API key (read-only is enough): the library on zotero.org is cited from then, for a server that isn't the computer Zotero runs on.",
    help: `Kept in this machine's data/config.json, never in the vault; checked with zotero.org first. Pipe it in, so it never
lands in a transcript. With nothing piped, says whether one is set.

  vau secret "Zotero API key" | vau references zotero-key
  vau references zotero-key --remove`,
    kind: "write",
    params: {
      key: { type: "string", stdin: true, description: "the key from zotero.org/settings/keys (piped in when left out)" },
      remove: { type: "boolean", description: "remove the key" },
    },
    lock: false,
    run: async ({ key, remove }, ctx) => {
      if (ctx.who.client === "mcp") throw new OpError("not over MCP: keys stay on the user's machines (vau references zotero-key, in a terminal)", 403)
      if (remove) { plugin.saveSecrets(null); refs.host.zotero.forget(true); return { set: false, removed: true } }
      const k = (key ?? "").trim()
      if (!k) return { set: !!refs.host.webKey() }
      if (!/^[A-Za-z0-9]{16,64}$/.test(k)) throw new OpError("that isn't a Zotero API key (letters and digits, from zotero.org/settings/keys)")
      plugin.saveSecrets({ zoteroKey: k })
      await refs.host.zotero.refresh(refs.zoteroOptions(), true)
      const web = refs.host.zotero.states.get("web")
      if (web?.state === "refused") { plugin.saveSecrets(null); throw new OpError("zotero.org refused this key: make one with read access to the library", 400) }
      return { set: true, checked: web?.state === "ready" }
    },
    text: (r: { set: boolean; removed?: boolean; checked?: boolean }) => (r.removed ? "Removed the Zotero key." : r.checked === undefined ? (r.set ? "A Zotero key is set." : "No Zotero key here.")
      : `Set the Zotero key${r.checked ? "" : " (zotero.org didn't answer, so it isn't checked yet)"}.`),
    did: (p) => ({ action: "settings", text: p.remove ? "Removed the Zotero key" : p.key ? "Set the Zotero key" : "Checked for a Zotero key" }),
  })
}

export function writeOps(plugin: Plugin, refs: References) {
  noteOp(plugin, refs)
  addOp(plugin, refs)
  statusOp(plugin, refs)
  zoteroKeyOp(plugin, refs)
}
