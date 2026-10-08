import { createFile, definePlugin, freeName, get, getStore, newNoteFolder, openNew } from "@vaultite"

// Unique note creator (a Zettelkasten prefixer): a note named by when it was made, 202610031542 by
// default, in the folder its settings say (else where new notes go). A name that's taken (two in a minute) gets a number.

const pad = (n: number) => String(n).padStart(2, "0")
/** The time as a name: YYYY MM DD HH mm ss (text in [brackets] as it is). */
function uniqueName(d: Date, fmt: string) {
  const t: Record<string, string> = { YYYY: String(d.getFullYear()), MM: pad(d.getMonth() + 1), DD: pad(d.getDate()), HH: pad(d.getHours()), mm: pad(d.getMinutes()), ss: pad(d.getSeconds()) }
  return fmt.replace(/\[([^\]]*)\]|YYYY|MM|DD|HH|mm|ss/g, (m, lit) => lit ?? t[m]).replace(/[/\\:]/g, "-")
}

async function create() {
  const s = getStore()
  if (!s) return
  let o: { folder?: string; format?: string } = {}
  try { o = await get("config/plugin/unique-note") } catch { /* the defaults */ }
  const folder = (o.folder ?? "").trim().replace(/^\/+|\/+$/g, "") || newNoteFolder(s)
  const name = freeName(s.files, folder, uniqueName(new Date(), (o.format ?? "").trim() || "YYYYMMDDHHmm"))
  const f = await createFile(folder, name)
  openNew(f.path)
}

export default definePlugin({
  commands: [{ id: "unique-note:new", name: "Create new unique note", run: () => void create() }],
})
