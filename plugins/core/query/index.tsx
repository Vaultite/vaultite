import { Database } from "lucide-react"
import { besideActive, definePlugin, freeName, getStore, openNew, post, reload, type FileFormat } from "@vaultite"
import { BaseFence, BaseFile } from "./BaseView"

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
    { label: "New base", icon: Database, make: (from) => newBase(from) },
  ],
  commands: [
    { id: "query:new-base", name: "New base", run: () => newBase().then((p) => openNew(p)) },
  ],
  slash: () => [{
    id: "query:base", title: "Base", section: "Database", keywords: "base bases database table query obsidian", detail: "A base, inline",
    line: true, icon: Database, description: "A table of notes and their properties.", sample: "```base\n" + baseText("") + "```",
    run: (put) => put("```base\n" + baseText(besideActive("")) + "```\n"),
  }],
})

