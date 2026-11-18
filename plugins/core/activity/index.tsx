import { lazy, Suspense } from "react"
import { Activity, CalendarDays, SquareTerminal } from "lucide-react"
import { currentFile, definePlugin, getStore, openFile, openView, pageOf, sidebarMode, toggleSidebarMode } from "@vaultite"
import { mockLive } from "./mock"
import { Report } from "./Report"
import { chooseSession, sessionsHere, SessionsChip } from "./Sessions"

const FeedBlock = lazy(() => import("./Feed").then((m) => ({ default: m.FeedBlock })))
const FeedView = lazy(() => import("./Feed").then((m) => ({ default: m.FeedView })))
const ActivityPanel = lazy(() => import("./Panel").then((m) => ({ default: m.ActivityPanel })))
const RecapBlock = lazy(() => import("./Recaps").then((m) => ({ default: m.RecapBlock })))
const RecapPage = lazy(() => import("./Recaps").then((m) => ({ default: m.RecapPage })))
const RecapStats = lazy(() => import("./Recaps").then((m) => ({ default: m.RecapStats })))
const PerfServer = lazy(() => import("./Perf").then((m) => ({ default: m.PerfServer })))
const PerfRoutes = lazy(() => import("./Perf").then((m) => ({ default: m.PerfRoutes })))
const PerfApp = lazy(() => import("./Perf").then((m) => ({ default: m.PerfApp })))
const SummaryBlock = lazy(() => import("./Summary").then((m) => ({ default: m.SummaryBlock })))

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
    types: ["recap"], folders: ["Recaps"], icon: CalendarDays, tint: "var(--activity)",
    page: { render: (ctx) => <Suspense fallback={null}><RecapPage {...ctx} /></Suspense>, series: true },
  },
  sidebar: {
    feed: { title: "Activity", names: ["activity"], heading: false, needsHeading: true, sort: 32, hidden: true, view: "activity", flyout: { icon: Activity }, render: (ctx) => <Suspense fallback={null}><ActivityPanel {...ctx} /></Suspense> },
  },
  fileBar: { sessions: { title: "Sessions here", sort: 46, render: (file) => (sessionsHere(file.path) ? <SessionsChip file={file} /> : null) } },
  views: { activity: { icon: Activity, title: () => "Activity", render: ({ store }) => <Suspense fallback={null}><FeedView store={store} /></Suspense> } },
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
