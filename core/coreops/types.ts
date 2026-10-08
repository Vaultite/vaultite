// file.type (`vau type`): a file is a kind's by its `type:` alone, never by its folder (core/vault.ts kindFor), so files
// brought in without one (an Obsidian vault's People/) get it here: one frontmatter line each, listed first.
import type { App } from "../app.ts"
import { unarchived } from "../fileprops.ts"
import { type Op, OpError } from "../ops.ts"
import { dirOf, type Kind, setPropertyText } from "../vault.ts"
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

export function typeOps(app: App): Op[] {
  return [{
    id: "file.type",
    cli: "type",
    summary: "Give Markdown files without a `type:` one (a folder brought in from Obsidian): lists them, writes with apply.",
    help: `A file is a person, a log, a book... by its \`type:\` alone, wherever it is: a file without one is a plain note,
even in People/. This finds such files and adds the line \`type: <kind>\` to each (nothing else changes). Without a
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
            const text = setPropertyText(before, "type", g.type)
            if (text === null) { failed.push({ path, why: "its frontmatter can't be changed line by line" }); continue }
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
  }]
}
