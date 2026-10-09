// Publish's frontend: Publish / Unpublish in a note's and a folder's menu and the palette, and view:publish, the list.
// The work is the server's ops (plugin.ts): the menus only call them.
import { Globe, Upload } from "lucide-react"
import { activeFile, currentFile, definePlugin, getStore, openView, Panel, stem } from "@vaultite"
import { publish, publishChanges, PublishedView, unpublish } from "./Published"
import type { PublishState } from "./types"

const state = (): PublishState => getStore()?.publish ?? { items: [], notes: [] }
const isNote = (p: string) => /\.md$/i.test(p) && !p.split("/").some((x) => x.startsWith("."))
const here = () => { const f = currentFile() || activeFile()?.path || ""; return isNote(f) ? f : "" }
const idOf = (p: string) => p.replace(/\.md$/i, "")

/** A note's menu item: Publish, Unpublish, or (published with its folder) nothing to do here. */
function noteItem(path: string) {
  const s = state(), id = idOf(path)
  if (s.items.includes(id)) return { label: "Unpublish", icon: Globe, section: "more", run: () => void unpublish(id, stem(path)) }
  if (s.notes.includes(path)) return { label: "Published with its folder", icon: Globe, section: "more", disabled: true, run: () => {} }
  return { label: "Publish", icon: Globe, section: "more", run: () => void publish(id) }
}

function Preview() {
  return (
    <Panel title="Publish" icon={Globe}>
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Put notes and folders on the web as your own site, rendered the way they read, with links between them and their images, in
        light and dark. Publish or unpublish from a note's or folder's menu; Published lists what's on your site. Needs Vaultite Cloud
        and a Publish plan.
      </p>
    </Panel>
  )
}

export default definePlugin({
  preview: () => <Preview />,
  fileMenu: (path) => (isNote(path) ? [noteItem(path)] : []),
  folderMenu: (path) => {
    if (!path || path.split("/").some((x) => x.startsWith("."))) return []
    return state().items.includes(path)
      ? [{ label: "Unpublish folder", icon: Globe, section: "more", run: () => void unpublish(path, path.split("/").pop() ?? path) }]
      : [{ label: "Publish folder", icon: Globe, section: "more", run: () => void publish(path, true) }]
  },
  views: { publish: { icon: Globe, title: () => "Published", render: () => <PublishedView /> } },
  commands: [
    { id: "publish:note", name: "Publish this note", when: () => { const f = here(); return !!f && !state().notes.includes(f) }, run: () => void publish(idOf(here())), icon: Globe },
    { id: "publish:unpublish-note", name: "Unpublish this note", when: () => state().items.includes(idOf(here())), run: () => void unpublish(idOf(here()), stem(here())) },
    { id: "publish:sync", name: "Publish changes", when: () => state().items.length > 0, run: () => void publishChanges(), icon: Upload },
    { id: "publish:open", name: "Show published notes", run: () => openView("publish", { newTab: true }) },
  ],
})
