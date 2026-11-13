import { Folder, FolderClosed, FolderTree } from "lucide-react"
import { definePlugin, folderBar, folderName, FolderPage, folderTabMenu, FilesPage, FilesPanel, FilesSettings, filesSettingsSearch, isViewOpen, openView, treeShownItems } from "@vaultite"

export default definePlugin({
  sidebar: { files: { title: "File explorer", names: ["file tree", "tree", "explorer"], heading: false, sort: 35, tall: true, view: "files", flyout: { icon: FolderTree, width: 280 },
    menu: treeShownItems, render: (ctx) => <FilesPanel {...ctx} /> } },
  views: {
    files: { icon: FolderClosed, title: () => "Files", tabMenu: () => treeShownItems(), render: ({ store }) => <FilesPage store={store} /> },
    folder: { icon: Folder, title: folderName, pathArg: true, pinAs: () => null, tabMenu: (arg) => folderTabMenu(arg),
      bar: ({ arg }) => folderBar(arg), render: ({ store, arg }) => <FolderPage key={arg} store={store} path={arg} /> },
  },
  settingsPanel: () => <FilesSettings />,
  settingsSearch: filesSettingsSearch,
  commands: [
    { id: "files:open-tab", name: "Open files in a tab", run: () => openView("files", { newTab: !isViewOpen("files") }) },
  ],
})
