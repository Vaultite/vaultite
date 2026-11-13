import { createFile, definePlugin, freeName, getStore, newNoteFolder, openNew, pluginSettings } from "@vaultite"

const pad = (n: number) => String(n).padStart(2, "0")
function uniqueName(d: Date, fmt: string) {
  const t: Record<string, string> = { YYYY: String(d.getFullYear()), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) }
  return fmt.replace(/\[([^\]]*)\]|YYYY|MM|DD|HH|mm|ss/g, (m, lit) => lit ?? t[m]).replace(/[/\\:]/g, "-")
}

const settings = pluginSettings<{ folder?: string; format?: string }>("unique-note")

async function create() {
  const s = getStore()
  if (!s) return
  await settings.ready()
  const o = settings.get()
  const folder = (o.folder ?? "").trim().replace(/^\/+|\/+$/g, "") || newNoteFolder(s)
  const name = freeName(s.files, folder, uniqueName(new Date(), (o.format ?? "").trim() || "YYYYMMDDHHmm"))
  const f = await createFile(folder, name)
  openNew(f.path)
}

export default definePlugin({
  commands: [{ id: "unique-note:new", name: "Create new unique note", run: () => void create() }],
})
