// The strip under a page's title when it has tabs (each its own file, core/tabs.ts). A tab shows where this one is,
// even on a page (which otherwise opens files beside it).
import { memo } from "react"
import type { Store } from "@/core/data"
import { goHere, hashOf, isDesktop } from "@/core/workspace"
import { openDetail } from "@/core/nav"
import { offPlugin } from "@/core/pages"
import { detailPath } from "@/core/define"
import { usePrefs } from "@/core/prefs"
import { Segmented } from "@/components/kit"
import { cn } from "@/lib/utils"
import { pageTabs } from "../../../core/tabs.ts"

export const PageTabs = memo(function PageTabs({ store, path, pane, className }: { store: Store; path: string; pane: boolean; className?: string }) {
  const { disabled } = usePrefs()
  const tabs = pageTabs(store.files.files, path, (f) => offPlugin(store.files.files.find((x) => x.path === f.path), disabled))
  if (!tabs.length) return null
  const show = (to: string) => {
    if (to === path) return
    if (isDesktop()) goHere(`file:${to}`)
    else if (pane) location.hash = `#${hashOf(`file:${to}`)}`
    else openDetail(detailPath("file", to))
  }
  // One line per tab, always: when they don't fit (a phone, a narrow pane) the strip scrolls sideways.
  return (
    <div className={cn("page-tabs max-w-full overflow-x-auto", className)}>
      <Segmented label="Views" value={path} onChange={show} options={tabs.map((t) => ({ value: t.path, label: t.label }))}
        className="w-fit" />
    </div>
  )
})
