import { currentFile, definePlugin, get, getStore, isHidden, openFile } from "@vaultite"

// Random note: a Markdown note picked at random (not the one you're on, a hidden or
// archived one, or a template), opened in the tab you're in, or a new one when its settings say so.

/** The templates folder, when Templates is on (its notes are patterns, not notes to come across). */
let templates = "Templates"
const askTemplates = () => get<{ folder: string }>("templates").then((t) => { templates = t.folder || templates }, () => {})

/** The notes it picks from. */
function notes() {
  const s = getStore()
  if (!s) return []
  const here = currentFile()
  return s.files.files.filter((f) => f.path.endsWith(".md") && f.path !== here && !f.archived && !isHidden(f.path) && !f.path.startsWith(`${templates}/`))
}

async function openRandom() {
  await askTemplates()
  const list = notes()
  if (!list.length) return
  const f = list[Math.floor(Math.random() * list.length)]
  let newTab = false
  try { newTab = (await get<{ newTab?: boolean }>("config/plugin/random-note")).newTab === true } catch { /* the default */ }
  openFile(f.path, { newTab })
}

export default definePlugin({
  commands: [{ id: "random-note:open", name: "Open random note", when: () => notes().length > 0, run: () => void openRandom() }],
})
