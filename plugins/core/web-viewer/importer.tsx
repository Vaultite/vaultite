import { User } from "lucide-react"
import { choose, notify, notifyError, op, openFile, plural } from "@vaultite"
import { importBookmarks, importHistory, importSources, type ImportSource } from "./history"
import { profile } from "./state"

let found: ImportSource[] = []
export const browsersHere = () => found
export const findBrowsers = () => importSources().then((s) => { found = s }, () => { found = [] })

export async function askImport(browser?: string) {
  await findBrowsers()
  const list = browser ? found.filter((s) => s.browser === browser) : found
  if (!list.length) return notify(browser ? `${browser === "brave" ? "Brave" : "Chrome"} isn't on this computer` : "No other browser to import from on this computer")
  if (list.length > 1) {
    return choose({ title: "Import from a browser", placeholder: "Browser", items: list.map((s) => ({ id: s.browser, label: s.name })), onPick: (it) => void askImport(it.id) })
  }
  const s = list[0]
  if (s.profiles.length === 1) return void run(s, s.profiles[0].dir)
  choose({
    title: `Import from ${s.name}`, heading: `Import history and bookmarks from ${s.name}'s profile`, placeholder: "Profile",
    items: s.profiles.map((p) => ({ id: p.dir, label: p.name, detail: p.name === p.dir ? undefined : p.dir, icon: User })),
    onPick: (it) => void run(s, it.id),
  })
}

async function run(s: ImportSource, dir: string) {
  const p = s.profiles.find((x) => x.dir === dir)
  if (!p) return
  const id = "web-import"
  notify(`Importing from ${s.name}…`, { id, duration: 60_000 })
  try {
    const visits = p.history ? (await importHistory(s.browser, dir, profile())).added : 0
    const marks = p.bookmarks ? await importBookmarks(s.browser, dir) : []
    const r = marks.length ? await op<{ path: string | null; added: number }>("bookmarks.add", { links: marks }) : null
    const what = [visits || !r?.added ? plural(visits, "visit") : "", r?.added ? plural(r.added, "bookmark") : ""].filter(Boolean).join(" and ")
    const path = r?.path
    notify(`Imported ${what} from ${s.name}`, { id, action: path ? { label: "Open bookmarks", run: () => openFile(path) } : undefined })
  } catch (e) { notifyError(e, `Couldn't import from ${s.name}`, { id }) }
}
