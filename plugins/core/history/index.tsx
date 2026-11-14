import { History } from "lucide-react"
import { currentFile, definePlugin, isHidden, openView } from "@vaultite"
import { HistoryView } from "./HistoryView"

const openHistory = (path: string) => openView(`history/${path}`)

export default definePlugin({
  views: {
    history: {
      icon: History,
      title: (path) => `${path.split("/").pop()!.replace(/\.md$/i, "")} history`,
      pinAs: (path) => path || null,
      render: ({ arg }) => <HistoryView key={arg} path={arg} />,
    },
  },
  fileMenu: (path) => (isHidden(path) ? [] : [{ label: "Open version history", icon: History, section: "more", run: () => openHistory(path) }]),
  commands: [
    { id: "history:open", name: "Open version history for the current file", when: () => !!currentFile() && !isHidden(currentFile()), run: () => openHistory(currentFile()) },
  ],
})
