import { Activity, CalendarDays, SquareTerminal } from "lucide-react"
import { currentFile, definePlugin, getStore, openFile, openView, pageOf, sidebarMode, toggleSidebarMode } from "@vaultite"
import { FeedBlock, FeedView } from "./Feed"
import { mockLive } from "./mock"
import { ActivityPanel } from "./Panel"
import { RECAP_TINT, RecapBlock, RecapPage, RecapStats } from "./Recaps"
import { PerfApp, PerfRoutes, PerfServer } from "./Perf"
import { Report } from "./Report"
import { chooseSession, sessionsHere, SessionsChip } from "./Sessions"
import { SummaryBlock } from "./Summary"

const FEED = "activity:feed"

export default definePlugin({
  blocks: {
    activity: (ctx) => <FeedBlock store={ctx.store} path={ctx.path} options={ctx.options} />,
    recap: (ctx) => <RecapBlock store={ctx.store} path={ctx.path} options={ctx.options} />,
    "recap-stats": (ctx) => <RecapStats store={ctx.store} options={ctx.options} />,
    "activity-summary": (ctx) => <SummaryBlock store={ctx.store} options={ctx.options} />,
    "perf-server": (ctx) => <PerfServer options={ctx.options} />,
    "perf-routes": (ctx) => <PerfRoutes options={ctx.options} />,
    "perf-app": (ctx) => <PerfApp options={ctx.options} />,
  },
  files: {
    types: ["recap"], folders: ["Recaps"], icon: CalendarDays, tint: RECAP_TINT,
    page: { render: (ctx) => <RecapPage {...ctx} />, series: true },
  },
  sidebar: {
    feed: { title: "Activity", names: ["activity"], heading: false, needsHeading: true, sort: 32, hidden: true, view: "activity", flyout: { icon: Activity }, render: (ctx) => <ActivityPanel {...ctx} /> },
  },
  fileBar: { sessions: { title: "Sessions here", sort: 46, render: (file) => (sessionsHere(file.path) ? <SessionsChip file={file} /> : null) } },
  views: { activity: { icon: Activity, title: () => "Activity", render: ({ store }) => <FeedView store={store} /> } },
  commands: [
    {
      id: "activity:open", name: "Open activity",
      run: () => { const page = pageOf(getStore(), "activity", "Activity"); return page ? openFile(page.path) : openView("activity", { newTab: true }) },
    },
    { id: "activity:sidebar", name: "Show activity in the sidebar", desktop: true, run: () => toggleSidebarMode(FEED),
      icon: Activity, nameWhenOn: "Show panels in the sidebar", on: () => sidebarMode() === FEED },
    { id: "activity:sessions", name: "Sessions that changed this file", icon: SquareTerminal, when: () => sessionsHere(currentFile()), run: chooseSession },
  ],
  background: () => <Report />,
  mockLive,
})
