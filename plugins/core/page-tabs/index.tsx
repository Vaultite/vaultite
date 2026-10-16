import { definePlugin, detailPath, goHere, hashOf, isDesktop, offPlugin, openDetail, Segmented, useEnabled, useStore } from "@vaultite"
import { type PageTab, stripOf } from "./tabs.ts"
import "./tabs.css"

// Page tabs: a page with views is several files, the first listing the others (`tabs:`); each shows the strip under
// its title. A tab shows where this one is, even on a page (which otherwise opens files beside it).

declare module "@vaultite" {
  interface PluginState { pageTabs?: PageTab[][] }
}

function Strip({ path, place }: { path: string; place: "page" | "sheet" }) {
  const { store } = useStore()
  useEnabled() // (a tab's plugin turned on or off shows or hides it)
  const tabs = stripOf(store?.pageTabs ?? [], path, (t) => offPlugin(t))
  if (!tabs.length) return null
  const show = (to: string) => {
    if (to === path) return
    if (isDesktop()) goHere(`file:${to}`)
    else if (place === "page") location.hash = `#${hashOf(`file:${to}`)}`
    else openDetail(detailPath("file", to))
  }
  // One line per tab, always: when they don't fit (a phone, a narrow pane) the strip scrolls sideways.
  return (
    <div className="page-tabs mb-4 max-w-full overflow-x-auto">
      <Segmented label="Views" value={path} onChange={show} options={tabs.map((t) => ({ value: t.path, label: t.label }))} className="w-fit" />
    </div>
  )
}

export default definePlugin({
  noteTop: { strip: { sort: 0, render: ({ path, place }) => <Strip path={path} place={place} /> } },
})
