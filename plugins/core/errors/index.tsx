// Errors' frontend: draws what the server keeps (Errors.tsx) and sends the app's own errors (Report.tsx).
import { AlertTriangle } from "lucide-react"
import { definePlugin, getStore, openFile, openView, pageOf } from "@vaultite"
import { ErrorsList, ErrorsView } from "./Errors"
import { mockLive } from "./mock"
import { Report } from "./Report"

export default definePlugin({
  icon: AlertTriangle,
  icons: { "alert-triangle": AlertTriangle },
  blocks: {
    // The errors, each kind once with a count (`limit: 20`, `source: app` or `server`, `title`).
    errors: (ctx) => <ErrorsList options={ctx.options} />,
  },
  // Where a new error's toast goes.
  views: { errors: { icon: AlertTriangle, title: () => "Errors", render: () => <ErrorsView /> } },
  commands: [
    {
      id: "errors:open", name: "Open errors",
      run: () => { const page = pageOf(getStore(), "errors", "Errors"); return page ? openFile(page.path) : openView("errors", { newTab: true }) },
    },
  ],
  background: () => <Report />,
  mockLive,
})
