import { Database, Table2 } from "lucide-react"
import { besideActive, currentFile, definePlugin, freeName, getStore, kindFolder, newNoteFolder, openNew, post, reload, type FileFormat } from "@vaultite"
import { BaseFence, BaseFile } from "./BaseView"

async function newDatabase(from: string) {
  const s = getStore()
  const folder = kindFolder(from) ? newNoteFolder(s, currentFile()) : from
  const base = from ? `${from.split("/").pop()} database` : "Database"
  const name = s ? freeName(s.files, folder, base) : base
  const body = "```base\n" + baseText(from, from ? from.split("/").pop() : "Table") + "```\n"
  const f = await post<{ path: string }>("file", { path: `${folder ? `${folder}/` : ""}${name}.md`, text: body, unique: true })
  await reload()
  return f.path
}

const baseText = (folder: string, name = "Table") =>
  `${folder ? `filters:\n  and:\n    - file.inFolder(${JSON.stringify(folder)})\n` : ""}views:\n  - type: table\n    name: ${/^\w[\w .-]*$/.test(name) ? name : JSON.stringify(name)}\n`

const whereNew = () => besideActive("")

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
})

