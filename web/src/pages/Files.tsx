// Files in a tab (view:files): the sidebar's tree; on phones taller rows under a New note button.
import { FilePlus } from "lucide-react"
import type { Store } from "@/core/data"
import { isDesktop, useFocusedFile } from "@/core/workspace"
import { usePane } from "@/core/pane"
import { FileTree, useFileActions } from "@/components/FileTree"
import { Panel } from "@/components/kit"

export function Files({ store }: { store: Store }) {
  const { newNote } = useFileActions(store)
  const count = store.files.files.length + store.files.others.length
  const subtitle = `${count} files in your vault`
  // A tab opens files beside itself: in the pane of the file focused last when that's another pane (like Links).
  const focused = useFocusedFile()
  const own = usePane().group
  if (isDesktop()) {
    return (
      <div data-files-view className="-mx-1.5">
        <FileTree store={store} active={focused.path} title={subtitle} pane={focused.group && focused.group !== own ? focused.group : undefined} />
      </div>
    )
  }
  return (
    <>
      <div data-files-view className="-mt-2 mb-3 flex items-end justify-between gap-3">
        <p className="pb-2 text-[15px] text-muted-foreground">{subtitle}</p>
        <button type="button" onClick={() => newNote()} aria-label="New note"
          className="mb-1 flex h-9 shrink-0 cursor-pointer items-center gap-1.5 rounded-full bg-muted px-3.5 text-[15px] font-medium text-primary active:opacity-60">
          <FilePlus className="size-[18px]" strokeWidth={2.25} />New note
        </button>
      </div>
      <Panel className="px-2 py-1.5">
        <FileTree store={store} compact={false} header={false} />
      </Panel>
    </>
  )
}
