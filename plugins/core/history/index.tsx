import { lazy, Suspense } from "react"
import { History } from "lucide-react"
import { Arriving, currentFile, definePlugin, isHidden, openView } from "@vaultite"
import { EditedChip } from "./Edited"

const HistoryView = lazy(() => import("./HistoryView").then((m) => ({ default: m.HistoryView })))
const openHistory = (path: string) => openView(`history/${path}`)
const onFile = () => !!currentFile() && !isHidden(currentFile()) && !currentFile().startsWith("/")

export default definePlugin({
  views: {
    history: {
      icon: History,
      title: (path) => `${path.split("/").pop()!.replace(/\.md$/i, "")} history`,
      pinAs: (path) => path || null,
      render: ({ arg }) => <Suspense fallback={<Arriving />}><HistoryView key={arg} path={arg} /></Suspense>,
    },
  },
  fileBar: { edited: { title: "Last edited by an agent", sort: 51, render: (file) => (isHidden(file.path) || file.path.startsWith("/") ? null : <EditedChip file={file} />) } },
  fileMenu: (path) => (isHidden(path) ? [] : [{ label: "Open version history", icon: History, section: "more", run: () => openHistory(path) }]),
  commands: [
    { id: "history:open", name: "Open version history for the current file", label: "Version history", when: onFile, run: () => openHistory(currentFile()) },
  ],
})
