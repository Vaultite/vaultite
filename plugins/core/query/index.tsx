import { Database, Table2 } from "lucide-react"
import { besideActive, currentFile, definePlugin, freeName, getStore, kindFolder, newNoteFolder, openNew, post, reload, type FileFormat } from "@vaultite"
import { QueryBlock } from "./QueryView"
import { BaseFence, BaseFile } from "./BaseView"
import type { Result, Row } from "./query"

// Database views (```block-query) and Obsidian Bases (.base files, embeds, ```base fences), drawn here; the server runs
// them. "New database" in a kind's folder goes where new notes go, since that folder holds only that kind.

async function newDatabase(from: string) {
  const s = getStore()
  const folder = kindFolder(from) ? newNoteFolder(s, currentFile()) : from
  const base = from ? `${from.split("/").pop()} database` : "Database"
  const name = s ? freeName(s.files, folder, base) : base
  const body = `\`\`\`block-query\n${from ? `title: ${from.split("/").pop()}\nfrom: ${from}/\n` : ""}view: table\n\`\`\`\n`
  const f = await post<{ path: string }>("file", { path: `${folder ? `${folder}/` : ""}${name}.md`, text: body, unique: true })
  await reload()
  return f.path
}

/** A new base's YAML: every file in `folder` (the whole vault when none), as a table. */
const baseText = (folder: string) =>
  `${folder ? `filters:\n  and:\n    - file.inFolder(${JSON.stringify(folder)})\n` : ""}views:\n  - type: table\n    name: Table\n`

/** Where a new base goes from the palette: next to the note being written, else the vault's top. */
const whereNew = () => besideActive("")

/** A new .base in `folder`, listing that folder (New base), named after it ("Recipes.base"). */
async function newBase(folder = whereNew()) {
  const s = getStore()
  const base = folder ? folder.split("/").pop()! : "Base"
  const name = s ? freeName(s.files, folder, base, ".base") : base
  const f = await post<{ path: string }>("file", { path: `${folder ? `${folder}/` : ""}${name}.base`, text: baseText(folder), unique: true })
  await reload()
  return f.path
}

const format: FileFormat = {
  exts: ["base"], icon: Database, tint: "var(--indigo)", autoHeight: true, source: "yaml",
  render: (ctx) => <BaseFile {...ctx} />,
}

export default definePlugin({
  formats: { base: format },
  fences: { base: (ctx) => <BaseFence {...ctx} /> },
  newFiles: [
    { label: "New database", icon: Table2, make: newDatabase },
    { label: "New base", icon: Database, make: (from) => newBase(from) },
  ],
  commands: [
    { id: "query:new-base", name: "New base", run: () => void newBase().then((p) => openNew(p)) },
  ],
  slash: () => [{
    id: "query:base", title: "Base", section: "Database", keywords: "base bases database table query obsidian", detail: "A base, inline",
    line: true,
    run: (put) => put("```base\n" + baseText(besideActive("")) + "```\n"),
  }],
  blocks: {
    query: (ctx) => <QueryBlock {...ctx} />,
  },
  mockLive: () => ({ query: mockResult() }),
})

/** Made-up answers for the Plugins sheet's preview. */
function mockResult(): Result {
  const row = (name: string, relation: string, location: string, every: number): Row =>
    ({ path: `People/${name}.md`, title: name, values: { file: name, relation, location, every_days: every } })
  return {
    title: "Friends", view: "table", total: 3, shown: 3, sort: [{ key: "file", desc: false }],
    columns: [{ key: "file", label: "Name" }, { key: "relation", label: "Relation" }, { key: "location", label: "Location" }, { key: "every_days", label: "Every days" }],
    groups: [{ name: null, rows: [row("Alice Park", "friend", "Austin, TX", 30), row("Bob Lee", "friend", "Denver, CO", 14), row("Lee Park", "mentor", "Boston, MA", 60)] }],
  }
}
