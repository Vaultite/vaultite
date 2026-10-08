import { History } from "lucide-react"
import { currentFile, definePlugin, isHidden, openView, Panel } from "@vaultite"
import { HistoryView } from "./HistoryView"

const openHistory = (path: string) => openView(`history/${path}`)

export default definePlugin({
  icon: History,
  // A tab at view:history/<vault path>: that file's earlier versions.
  views: {
    history: {
      icon: History,
      title: (path) => `${path.split("/").pop()!.replace(/\.md$/i, "")} history`,
      render: ({ arg }) => <HistoryView key={arg} path={arg} />,
    },
  },
  fileMenu: (path) => (isHidden(path) ? [] : [{ label: "Open version history", icon: History, section: "more", run: () => openHistory(path) }]),
  commands: [
    { id: "history:open", name: "Open version history for the current file", when: () => !!currentFile() && !isHidden(currentFile()), run: () => openHistory(currentFile()) },
  ],
  preview: () => (
    <Panel title="File history" icon={History} tint="var(--gray)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Every few minutes while a text file changes, its previous version is kept on this machine (not in the vault) for a
        week. Open a file's version history from its menu or the command palette to compare a version with the file now,
        copy it, or restore it.
      </p>
    </Panel>
  ),
})
