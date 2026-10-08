// Activity's frontend: draws what the server records (plugin.ts, model.ts) and reports what only the app knows
// (Report.tsx).
import { Activity, CalendarDays } from "lucide-react"
import { definePlugin, fmtLongDay, getStore, openFile, openView, PageHeader, pageOf } from "@vaultite"
import { FeedBlock, FeedView } from "./Feed"
import { mockLive } from "./mock"
import { ActivityPanel } from "./Panel"
import { RECAP_TINT, RecapBlock, RecapPage, RecapStats } from "./Recaps"
import { PerfApp, PerfRoutes, PerfServer } from "./Perf"
import { Report } from "./Report"
import { SummaryBlock } from "./Summary"


export default definePlugin({
  icon: Activity,
  blocks: {
    // The feed (`limit: 30`, `actor: agent`, `path: this` for the file the block is in).
    activity: (ctx) => <FeedBlock store={ctx.store} path={ctx.path} options={ctx.options} />,
    // What you did on a day (`date:`, else the daily note's; `days: 7`), as a timeline; the weeks as a grid of days.
    recap: (ctx) => <RecapBlock store={ctx.store} path={ctx.path} options={ctx.options} />,
    "recap-stats": (ctx) => <RecapStats store={ctx.store} options={ctx.options} />,
    // The last 24 hours (`days: 7`): by you, agents and the rest; who; the files touched most.
    "activity-summary": (ctx) => <SummaryBlock store={ctx.store} options={ctx.options} />,
    // The server: uptime, memory, event loop, requests, per-minute charts (`minutes: 1440`).
    "perf-server": (ctx) => <PerfServer options={ctx.options} />,
    // Each API route's timings, and the slow requests.
    "perf-routes": (ctx) => <PerfRoutes options={ctx.options} />,
    // What each app window reports about its own speed.
    "perf-app": (ctx) => <PerfApp options={ctx.options} />,
  },
  // A day's recap (Recaps/<date>.md) read as its timeline; editing it is its Markdown.
  files: {
    types: ["recap"], folders: ["Recaps"], icon: CalendarDays, tint: RECAP_TINT,
    kicker: ({ path }) => { const d = path.split("/").pop()!.replace(/\.md$/, ""); return /^\d{4}-\d\d-\d\d$/.test(d) ? `Recap · ${fmtLongDay(d)}` : "Recap" },
    page: {
      header: ({ path, title, place }) => {
        const d = path.split("/").pop()!.replace(/\.md$/, "")
        return place === "page" ? <PageHeader title={/^\d{4}-\d\d-\d\d$/.test(d) ? fmtLongDay(d) : title} subtitle="What you did" /> : null
      },
      render: (ctx) => <RecapPage {...ctx} />,
    },
  },
  // The last few things done, one line each: hidden until the user shows it, a flyout in the rail, a tab (view:activity).
  sidebar: {
    feed: { title: "Activity", names: ["activity"], heading: false, sort: 32, hidden: true, view: "activity", flyout: { icon: Activity }, render: (ctx) => <ActivityPanel {...ctx} /> },
  },
  views: { activity: { icon: Activity, title: () => "Activity", render: ({ store }) => <FeedView store={store} /> } },
  commands: [
    {
      id: "activity:open", name: "Open activity",
      run: () => { const page = pageOf(getStore(), "activity", "Activity"); return page ? openFile(page.path) : openView("activity", { newTab: true }) },
    },
  ],
  background: () => <Report />,
  mockLive,
})
