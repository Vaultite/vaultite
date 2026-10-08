// Templates: start a note from one or insert one, placeholders filled in the settings' formats. A new
// note goes where files of its `type` live, else beside the open file, else where new notes go.
import { CalendarDays, Clock, FilePlus2, FileStack } from "lucide-react"
import {
  activeFile, besideActive, choose, createFile, definePlugin, folderOf, formatDate, freeName, get, getStore, newNoteFolder, notify, notifyError,
  op, openNew, post, readFile, splitFm, stem, type Store,
} from "@vaultite"
import { fillVars, FORMATS, mergeFm } from "./fill"

let folder = "Templates"
let formats = FORMATS
let asked = 0
/** The settings (asked again at most every 10 s). */
async function settings() {
  if (Date.now() - asked > 10_000) {
    asked = Date.now()
    try {
      const s = await get<{ folder: string; dateFormat?: string; timeFormat?: string }>("templates")
      folder = s.folder || folder
      formats = { date: s.dateFormat || FORMATS.date, time: s.timeFormat || FORMATS.time }
    } catch { /* keep the last ones */ }
  }
  return { folder, formats }
}
/** The templates folder. */
const templatesFolder = async () => (await settings()).folder

/** Type the date or time now at the cursor, in the settings' format. */
async function insertNow(what: "date" | "time") {
  const { formats: f } = await settings()
  activeFile()?.insert(formatDate(new Date(), f[what]))
}
const listOf = (s: Store, dir: string) =>
  s.files.files.filter((f) => f.path.startsWith(`${dir}/`) && f.path.endsWith(".md")).sort((a, b) => a.path.localeCompare(b.path))

const EXAMPLES: [string, string][] = [
  ["Journal", "---\ntype: note\ntags: [Journal]\n---\n\n## {{date:dddd D MMMM}}\n\n\n## Grateful for\n\n- \n"],
  ["Meeting", "---\ntype: note\nkind: note\ntags: [Meeting]\n---\n\n**When**: {{date}} {{time}}\n**With**: \n\n## Notes\n\n- \n\n## Next steps\n\n- [ ] \n"],
  ["Person", "---\ntype: person\nrelation: friend\ncontext: \n---\n\n## Timeline\n\n- {{date}} · note · Met\n"],
]

async function makeExamples() {
  const dir = await templatesFolder()
  const made: string[] = []
  for (const [name, text] of EXAMPLES) { try { made.push((await createFile(dir, name, text)).path) } catch { /* taken */ } }
  void pickTemplate("new", made)
}

/** Where a new note from this template goes: the folder most files of its `type` are in (the files' type is the core's,
 *  core/fileprops.ts). */
function folderFor(s: Store, template: string, dir: string) {
  const type = /^type:[ \t]*["']?([\w-]+)/m.exec(splitFm(template).fm)?.[1]
  if (type) {
    const count = new Map<string, number>()
    for (const f of s.files.files) if (f.type === type && !f.archived && !f.path.startsWith(`${dir}/`)) count.set(folderOf(f.path), (count.get(folderOf(f.path)) ?? 0) + 1)
    const best = [...count].sort((a, b) => b[1] - a[1])[0]
    if (best) return best[0]
  }
  return besideActive(null, (p) => p.startsWith(`${dir}/`)) ?? newNoteFolder(s)
}

/** The text as other plugins expand it further (the server's `template:expand`: Templater's `<% %>`), and the note's
 *  path, which they may change; null when the user cancelled. */
async function expand(text: string, template: string, path: string, mode: "new" | "insert") {
  try {
    const r = await post<{ text: string; path?: string; notice?: string } | null>("templates/expand", { text, template, path, mode })
    if (r?.notice) notify(r.notice)
    return r && { text: r.text, path: r.path || path }
  } catch (e) {
    notifyError(e, "Couldn't fill in the template")
    return { text, path }
  }
}

async function newFrom(path: string) {
  const s = getStore()
  if (!s) return
  const dir = await templatesFolder()
  const { text } = await readFile(path)
  const where = folderFor(s, text, dir)
  const name = freeName(s.files, where, "Untitled")
  const r = await expand(fillVars(text, name, formatDate, new Date(), (await settings()).formats), path, `${where ? `${where}/` : ""}${name}.md`, "new")
  if (!r) return
  const { fm, body } = splitFm(r.text)
  const f = await createFile(folderOf(r.path), stem(r.path), mergeFm("", fm) + body)
  openNew(f.path)
}

/** Put a template into the file being edited: its body at the cursor, its new frontmatter keys added. */
async function insertInto(path: string, put?: (text: string) => void) {
  const f = activeFile()
  if (!f) return
  const { text } = await readFile(path)
  const r = await expand(fillVars(text, stem(f.path), formatDate, new Date(), (await settings()).formats), path, f.path, "insert")
  if (!r) return
  const t = splitFm(r.text)
  const cur = splitFm(f.text())
  const fm = t.fm ? mergeFm(cur.fm, t.fm) : cur.fm
  if (fm !== cur.fm) f.setText(fm + cur.body)
  const body = t.body.replace(/^\n+/, "")
  if (put) put(body)
  else f.insert(body)
  if (r.path !== f.path) { await f.settle(); await op("file.move", { from: f.path, to: r.path }) }
}

/** `made`: templates just written, which the store may not have yet. */
async function pickTemplate(how: "new" | "insert", made: string[] = []) {
  const s = getStore()
  if (!s) return
  const dir = await templatesFolder()
  const list = [...new Set([...listOf(s, dir).map((f) => f.path), ...made])].sort().map((path) => ({ path }))
  choose({
    title: how === "new" ? "New note from template" : "Insert template",
    placeholder: list.length ? (how === "new" ? "New note from template…" : "Insert template…") : `No templates in ${dir}/ yet`,
    items: list.map((f) => ({ id: f.path, label: stem(f.path).replace(/^.*\//, ""), detail: folderOf(f.path) === dir ? undefined : folderOf(f.path).slice(dir.length + 1) })),
    onPick: (it) => void (how === "new" ? newFrom(it.id) : insertInto(it.id)),
    empty: list.length ? undefined : (
      <div className="px-3 py-6 text-center text-[15px] text-muted-foreground">
        <p>Templates are notes in the {dir} folder.</p>
        <button type="button" onClick={() => { choose(null); void makeExamples() }}
          className="mt-3 cursor-pointer rounded-[8px] bg-foreground/[0.07] px-3 py-1.5 text-[14px] text-foreground hover:bg-foreground/[0.11]">
          Add three examples
        </button>
      </div>
    ),
  })
}

export default definePlugin({
  icon: FileStack,
  commands: [
    { id: "templates:new", name: "New note from template", run: () => void pickTemplate("new"), icon: FilePlus2 },
    { id: "templates:insert", name: "Insert template", when: () => !!activeFile(), run: () => void pickTemplate("insert") },
    { id: "templates:insert-current-date", name: "Insert current date", when: () => !!activeFile(), run: () => void insertNow("date"), icon: CalendarDays },
    { id: "templates:insert-current-time", name: "Insert current time", when: () => !!activeFile(), run: () => void insertNow("time"), icon: Clock },
  ],
  slash: (s) => {
    void templatesFolder()
    return listOf(s, folder).map((f) => ({
      id: `template:${f.path}`, title: stem(f.path), section: "Templates", keywords: "template", detail: "Template",
      run: (put) => insertInto(f.path, put),
    }))
  },
})
