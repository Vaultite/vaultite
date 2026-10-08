import { FolderClosed, FolderTree } from "lucide-react"
import { definePlugin, FilesPage, FilesPanel, FilesSettings, filesSettingsSearch, isViewOpen, openView, treeShownItems } from "@vaultite"

// The file tree panel and view:files (only the explorer: files are the core's), taking the height left under the
// Terminals; one icon in the rail. Its settings are the vault's files.json; its right-click menus show or hide hidden
// and archived files.
export default definePlugin({
  icon: FolderClosed,
  sidebar: { files: { title: "File explorer", names: ["file tree", "tree", "explorer"], heading: false, sort: 35, tall: true, view: "files", flyout: { icon: FolderTree, width: 280 },
    menu: treeShownItems, render: (ctx) => <FilesPanel {...ctx} /> } },
  views: {
    files: { icon: FolderClosed, title: () => "Files", tabMenu: () => treeShownItems(), render: ({ store }) => <FilesPage store={store} /> },
  },
  settingsPanel: () => <FilesSettings />,
  settingsSearch: filesSettingsSearch,
  commands: [
    { id: "files:open-tab", name: "Open files in a tab", run: () => openView("files", { newTab: !isViewOpen("files") }) },
  ],
})
