import { AlertTriangle } from "lucide-react"
import { definePlugin, getStore, openFile, openView, pageOf } from "@vaultite"
import { ErrorsList, ErrorsView } from "./Errors"
import { mockLive } from "./mock"
import { Report } from "./Report"

export default definePlugin({
  icons: { "alert-triangle": AlertTriangle },
  blocks: {
    errors: (ctx) => <ErrorsList options={ctx.options} />,
  },
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
