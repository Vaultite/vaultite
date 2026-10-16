// file.type (`vau type`): a file is a kind's by its `type:` alone (core/vault.ts kindFor), so files brought in without
// one (an Obsidian vault's People/) get it here. file.migrate (`vau migrate`): older files brought up to date.
import type { App } from "../app.ts"
import { unplaced, withKindBlocks } from "../blocks.ts"
import { unarchived } from "../fileprops.ts"
import { type Op, OpError } from "../ops.ts"
import { dirOf, type Entry, type Kind, readText, stemOf, writeAtomic } from "../vault.ts"
import { FM, setPropertyText } from "../frontmatter.ts"
import { type Any, enc } from "./common.ts"

type Group = { folder: string; type: string; files: string[] }

/** The kind a folder's name says (People/, Personal/People/; Logs/Gym/ for a kind whose files are in subfolders). */
const kindNamed = (kinds: Kind[], dir: string) => {
  const parts = unarchived(`${dir}/x`).split("/").slice(0, -1)
  return kinds.find((k) => k.folder && (k.recursive ? parts.includes(k.folder) : parts.at(-1) === k.folder)) ?? null
}

/** Markdown files with no kind and no `type:` (templates and hidden files left out), grouped by folder with the kind to
 *  give them: `kind`'s, else the one their folder is named like (none: not listed). Only under `folder` when given. */
export function untyped(app: App, folder = "", kind: Kind | null = null): Group[] {
  const v = app.vault, plain = v.plain().map((d) => d.replace(/^\/+|\/+$/g, "")).filter(Boolean)
  const under = folder.replace(/^\/+|\/+$/g, "")
  const groups = new Map<string, Group>()
  for (const e of v.entries.values()) {
    const rel = e.rel
    if (e.kind || e.broken || !rel.endsWith(".md") || (typeof e.fm.type === "string" && e.fm.type.trim())) continue
    if (rel.split("/").some((p) => p.startsWith(".") && p !== ".archive") || plain.some((d) => rel.startsWith(d + "/"))) continue
    if (under && !rel.startsWith(under + "/")) continue
    const dir = dirOf(rel), k = kind ?? kindNamed(v.kinds, dir)
    if (!k || k.file) continue
    const key = `${dir}\0${k.type}`
    const g = groups.get(key) ?? { folder: dir, type: k.type, files: [] }
    g.files.push(rel)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => a.folder.localeCompare(b.folder)).map((g) => ({ ...g, files: g.files.sort() }))
}

/** A file's text with the fences of its kind's blocks it doesn't place on its body's top, or null when it has them. */
export function fenced(text: string, view: string[]): string | null {
  const head = FM.exec(text)?.[0] ?? ""
  const body = withKindBlocks(view, text.slice(head.length))
  return body === null ? null : head + (head ? (head.endsWith("\n") ? "\n" : "\n\n") : "") + body
}

const listOf = (v: unknown) => (Array.isArray(v) ? v : v === null || v === undefined || v === "" ? [] : [v]).map(String)

/** A file's `title:` and `name:` that its name doesn't say nor its aliases have: links found it by them before, now only
 *  by its name and aliases. Not where its kind names files its own way (a log: date and title). */
function lostNames(e: Entry): string[] {
  if (e.kind?.spec.filename) return []
  const have = new Set([stemOf(e.rel), ...listOf(e.fm.aliases)].map((x) => x.toLowerCase())), out: string[] = []
  for (const k of ["title", "name"]) {
    const v = e.fm[k]
    if ((typeof v !== "string" && typeof v !== "number") || !String(v).trim() || have.has(String(v).toLowerCase())) continue
    have.add(String(v).toLowerCase())
    out.push(String(v))
  }
  return out
}

export function typeOps(app: App): Op[] {
  return [{
    id: "file.type",
    cli: "type",
    summary: "Give Markdown files without a `type:` one (a folder brought in from another app): lists them, writes with apply.",
    help: `A file is a person, a log, a book... by its \`type:\` alone, wherever it is: a file without one is a plain note,
even in People/. This finds such files and adds the line \`type: <kind>\` to each, and its kind's blocks' fences on
top (a person's \`\`\`block-person) where it doesn't have them. Without a
folder, every folder named like a kind's usual one (People/, Personal/People/, Logs/Gym/) that holds files without a
type; with one, the files under it, given --kind's type (else the kind the folder is named like). It only lists them
until --apply.

  vau type                                 what's untyped, folder by folder
  vau type People --apply                  People/'s files become people
  vau type "Imported/Friends" --kind person --apply`,
    kind: "write",
    params: {
      folder: { type: "string", description: "only the files under this folder (subfolders too)" },
      kind: { type: "string", description: "the kind to give them, by type or collection (person, people); default: the kind the folder is named like" },
      apply: { type: "boolean", default: false, description: "write the line; without it, only list what would change" },
    },
    args: ["folder"],
    run: async ({ folder, kind, apply }, ctx) => {
      let k: Kind | null = null
      if (kind) {
        const low = String(kind).trim().toLowerCase()
        k = app.vault.kinds.find((x) => x.type === low || x.collection === low) ?? null
        if (!k) throw new OpError(`no kind '${kind}'. Kinds: ${app.vault.kinds.map((x) => x.type).join(", ")}`, 404)
        if (k.file) throw new OpError(`${k.type} is kept in one file (${k.file}), not given to many`)
      }
      const dir = String(folder ?? "").replace(/^\/+|\/+$/g, "")
      if (dir && !k && !kindNamed(app.vault.kinds, dir)) throw new OpError(`${dir}/ isn't named like a kind's folder: say which with kind (person, note, log...)`)
      const groups = untyped(app, dir, k)
      const failed: { path: string; why: string }[] = []
      let written = 0
      if (apply) {
        for (const g of groups) {
          for (const path of g.files) {
            const before = String(((await ctx.api("GET", `file?path=${enc(path)}`)) as Any)?.text ?? "")
            const typed = setPropertyText(before, "type", g.type)
            if (typed === null) { failed.push({ path, why: "its frontmatter can't be changed line by line" }); continue }
            // (and its kind's blocks, as a new file of that kind has them)
            const k = app.vault.kinds.find((x) => x.type === g.type)
            const text = (k && fenced(typed, k.blocksFor({ ...app.vault.entries.get(path)?.fm, type: g.type }))) ?? typed
            try { await ctx.api("PUT", "file", { path, text, base: before }); written++ } catch (e) { failed.push({ path, why: (e as Error).message }) }
          }
        }
      }
      return { apply: !!apply, groups, written, failed }
    },
    text: (r: Any) => {
      const n = r.groups.reduce((a: number, g: Group) => a + g.files.length, 0)
      if (!n) return "Every Markdown file there has a type (or isn't in a folder named like a kind's)."
      const list = r.groups.map((g: Group) => `${g.folder || "(top)"}/: type: ${g.type}\n${g.files.map((f) => `- ${f}`).join("\n")}`).join("\n\n")
      if (!r.apply) return `${n} file${n === 1 ? "" : "s"} without a type, so plain notes for now:\n\n${list}\n\nWith --apply each gets its line.`
      const bad = r.failed.map((f: Any) => `- ${f.path}: ${f.why}`).join("\n")
      return `Gave ${r.written} file${r.written === 1 ? "" : "s"} a type.${bad ? `\n\nNot changed:\n${bad}` : ""}`
    },
  }, {
    id: "file.migrate",
    cli: "migrate",
    summary: "Bring files from before up to date (kinds' blocks as fences, titles as aliases): lists them, writes with apply.",
    help: `What the app reads changed; files written before may need a line or two, which this adds (nothing else changes;
running it again finds nothing):
- A kind's blocks (a person's profile, a project's card, a log's fields) are drawn only where the file has their fence:
  a typed file without one gets \`\`\`block-<name> on top of its text.
- Links find a file by its name and its \`aliases\`, no longer by \`title:\` or \`name:\`: a file whose title or name its
  file name doesn't say gets it added to \`aliases\` (not a log's: its name is its date and title).
It only lists them until --apply; with a folder, only the files under it.

  vau migrate
  vau migrate --apply
  vau migrate People --apply`,
    kind: "write",
    params: {
      folder: { type: "string", description: "only the files under this folder (subfolders too)" },
      apply: { type: "boolean", default: false, description: "write the changes; without it, only list them" },
    },
    args: ["folder"],
    run: async ({ folder, apply }) => {
      const under = String(folder ?? "").replace(/^\/+|\/+$/g, "")
      const files: { path: string; blocks: string[]; aliases: string[] }[] = [], failed: { path: string; why: string }[] = []
      for (const e of [...app.vault.entries.values()].sort((a, b) => (a.rel < b.rel ? -1 : 1))) {
        if (e.broken || e.rel.split("/").some((p) => p.startsWith(".") && p !== ".archive") || (under && !e.rel.startsWith(under + "/"))) continue
        let raw: string
        try { raw = readText(app.vault.abs(e.rel)) } catch { continue }
        const view = e.kind?.blocksFor(e.fm) ?? [], lost = lostNames(e)
        const blocks = unplaced(view, raw.slice(FM.exec(raw)?.[0].length ?? 0))
        let text = fenced(raw, view) ?? raw
        if (lost.length) {
          const next = setPropertyText(text, "aliases", [...listOf(e.fm.aliases), ...lost])
          if (next === null) { failed.push({ path: e.rel, why: "its frontmatter can't be changed line by line" }); continue }
          text = next
        }
        if (text === raw) continue
        files.push({ path: e.rel, blocks, aliases: lost })
        // (as it is: not through PUT /api/file, whose fill would add a note's id and dates too)
        if (apply) writeAtomic(app.vault.abs(e.rel), text)
      }
      if (apply && files.length) await app.vault.sync()
      return { apply: !!apply, files, failed }
    },
    text: (r: Any) => {
      const bad = r.failed.map((f: Any) => `- ${f.path}: ${f.why}`).join("\n")
      if (!r.files.length) return `Every file is up to date.${bad ? `\n\nNot changed:\n${bad}` : ""}`
      const n = r.files.length, rows = r.files.map((f: Any) => `- ${f.path}: ${[f.blocks.length ? `blocks ${f.blocks.join(", ")}` : "",
        f.aliases.length ? `aliases ${f.aliases.join(", ")}` : ""].filter(Boolean).join("; ")}`).join("\n")
      return `${r.apply ? "Changed" : "Would change"} ${n} file${n === 1 ? "" : "s"}:\n${rows}${r.apply ? "" : "\n\nWith --apply they're written."}${bad ? `\n\nNot changed:\n${bad}` : ""}`
    },
  }]
}
