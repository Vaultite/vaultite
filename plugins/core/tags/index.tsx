import { Hash } from "lucide-react"
import { definePlugin, detailPath, openView } from "@vaultite"
import { TagDetail, TagsPanel, TagsView, tagTree, TINT } from "./Tags"

// Tags: the Tags panel, a tag's sheet, and tags in the quick switcher. Which files have which tags is
// the core's.
export default definePlugin({
  icon: Hash,
  // Not in the sidebar until shown from its right-click menu (`hidden`); a flyout in the rail; a tab (view:tags).
  sidebar: { tags: { title: "Tags", heading: false, sort: 50, hidden: true, view: "tags", flyout: { icon: Hash }, render: (ctx) => <TagsPanel {...ctx} /> } },
  views: { tags: { icon: Hash, title: () => "Tags", render: ({ store }) => <TagsView store={store} /> } },
  commands: [{ id: "tags:open-tab", name: "Open tags in a tab", run: () => openView("tags", { newTab: true }) }],
  details: {
    tag: { render: (s, [tag]) => <TagDetail store={s} tag={tag ?? ""} />, title: (_, [tag]) => `#${tag ?? ""}` },
  },
  search: (s) => {
    const out: { full: string; count: number }[] = []
    const walk = (ns: ReturnType<typeof tagTree>) => ns.forEach((n) => { out.push(n); walk(n.kids) })
    walk(tagTree(s))
    return out.map((n) => ({
      id: `tag:${n.full}`, title: `#${n.full}`, meta: `${n.count} file${n.count === 1 ? "" : "s"}`, kind: "Tag", icon: Hash, tint: TINT,
      // Found by its name, not by the files that have it (a word in a path would find every tag of the file).
      detail: detailPath("tag", n.full), text: "", recent: 0,
    }))
  },
})
