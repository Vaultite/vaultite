import { Hash } from "lucide-react"
import { definePlugin, detailPath, openView, plural } from "@vaultite"
import { TagDetail, TagsPanel, TagsView, tagTree, TINT } from "./Tags"

export default definePlugin({
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
      id: `tag:${n.full}`, title: `#${n.full}`, meta: `${plural(n.count, "file")}`, kind: "Tag", icon: Hash, tint: TINT,
      detail: detailPath("tag", n.full), text: "", recent: 0,
    }))
  },
})
