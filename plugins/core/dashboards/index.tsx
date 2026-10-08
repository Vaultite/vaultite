import { ArrowUpCircle, LayoutDashboard } from "lucide-react"
import { dateText, definePlugin, PageHeader, type PageCtx } from "@vaultite"
import { Dashboard } from "./Dashboard"
import { UpdateBar, UpdateView } from "./Update"

// Dashboards: a `type: dashboard` file is a page of blocks while read; editing it edits the file. Off, it's a
// Markdown file with its blocks one under another.

/** `subtitle:` with "{date}" as today's date ("Thursday 1 October"). */
const subtitleOf = (fm: Record<string, unknown>) => typeof fm.subtitle === "string" && fm.subtitle
  ? fm.subtitle.replace("{date}", dateText(new Date(), { weekday: "long", day: "numeric", month: "long" })) : undefined

function Header({ title, fm, place, path }: PageCtx) {
  const sub = subtitleOf(fm)
  // In a tab the page's name and subtitle are its title; in a sheet the file's title is there already.
  if (place === "page") return <><PageHeader title={title} subtitle={sub} /><UpdateBar path={path} /></>
  return <>{sub && <p className="mt-0.5 text-[15px] text-muted-foreground">{sub}</p>}<UpdateBar path={path} /></>
}

export default definePlugin({
  icon: LayoutDashboard,
  files: {
    types: ["dashboard"], icon: LayoutDashboard,
    page: { header: (ctx) => <Header {...ctx} />, render: (ctx) => <Dashboard ctx={ctx} className={ctx.place === "sheet" ? "mt-4" : undefined} /> },
  },
  // A tab at view:page-update/<vault path>: the page against its plugin's newer version (Update.tsx).
  views: {
    "page-update": {
      icon: ArrowUpCircle,
      title: (path) => `${path.split("/").pop()!.replace(/\.md$/i, "")}: update`,
      render: ({ arg }) => <UpdateView key={arg} path={arg} />,
    },
  },
  // What a dashboard looks like: Today's, with made-up data.
  preview: "today",
})
