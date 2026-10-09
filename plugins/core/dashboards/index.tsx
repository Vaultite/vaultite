import { Copy, LayoutDashboard } from "lucide-react"
import { dateText, definePlugin, inPagesDir, PageHeader, type PageCtx } from "@vaultite"
import { Dashboard } from "./Dashboard"
import { BuiltInBar, copyToVault } from "./BuiltIn"
import { CopiesOffer } from "./Copies"

// Dashboards: a `type: dashboard` file is a page of blocks while read; editing it edits the file. Off, it's a
// Markdown file with its blocks one under another.

/** `subtitle:` with "{date}" as today's date ("Thursday 1 October"). */
const subtitleOf = (fm: Record<string, unknown>) => typeof fm.subtitle === "string" && fm.subtitle
  ? fm.subtitle.replace("{date}", dateText(new Date(), { weekday: "long", day: "numeric", month: "long" })) : undefined

function Header({ title, fm, place, path }: PageCtx) {
  const sub = subtitleOf(fm)
  // In a tab the page's name and subtitle are its title; in a sheet the file's title is there already.
  if (place === "page") return <><PageHeader title={title} subtitle={sub} /><BuiltInBar path={path} plugin={fm.plugin} /></>
  return <>{sub && <p className="mt-0.5 text-[15px] text-muted-foreground">{sub}</p>}<BuiltInBar path={path} plugin={fm.plugin} /></>
}

export default definePlugin({
  files: {
    types: ["dashboard"], icon: LayoutDashboard,
    page: { header: (ctx) => <Header {...ctx} />, render: (ctx) => <Dashboard ctx={ctx} className={ctx.place === "sheet" ? "mt-4" : undefined} /> },
  },
  // A plugin's built-in page becomes the user's file (BuiltIn.tsx).
  fileMenu: (path) => (inPagesDir(path) ? [{ label: "Copy to my vault", icon: Copy, section: "change", run: () => copyToVault(path) }] : []),
  // Once: offer to remove copies of plugins' pages the user never changed (Copies.tsx).
  background: () => <CopiesOffer />,
  // What a dashboard looks like: Today's, with made-up data.
  preview: "today",
})
