import { EditorView, ViewPlugin } from "@codemirror/view"
import { addDropTarget, type DragItem, type DropId } from "@/core/drag"
import { dropInto, markDrop, pointAt, type DropSpot } from "./filedrop"

export const takesDrops = (view: EditorView) => view.state.facet(EditorView.editable) && !!view.dom.parentElement?.hasAttribute("data-file-drop")

export function draggedFiles(item: DragItem, isFile: (path: string) => boolean): string[] {
  if (item.tab || item.pane || item.group || item.folder) return []
  const paths = item.paths?.length ? item.paths : item.path ? [item.path] : []
  return paths.every(isFile) ? paths : []
}

let made = 0
export function linkDrops(get: () => { isFile: (path: string) => boolean; link: (path: string) => string } | undefined) {
  return ViewPlugin.define((view) => {
    const id: DropId<DropSpot> = `editor-links:${++made}`
    const files = (item: DragItem) => { const g = get(); return g ? draggedFiles(item, g.isFile) : [] }
    const off = addDropTarget(id, {
      at: (item, x, y, el) => {
        if (!el || !view.contentDOM.contains(el) || !takesDrops(view) || !files(item).length) return null
        const spot = pointAt(view, { x, y })
        markDrop(view, spot)
        return { data: spot }
      },
      drop: (item, spot) => {
        markDrop(view, null)
        const g = get()
        if (g) void dropInto(view, spot, Promise.resolve(files(item).map(g.link).join("\n")))
      },
      end: () => markDrop(view, null),
    })
    const mark = () => view.contentDOM.toggleAttribute("data-drops", takesDrops(view))
    mark()
    return { update: mark, destroy: off }
  })
}
