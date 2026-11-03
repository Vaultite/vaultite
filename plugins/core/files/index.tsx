import { Folder, FolderClosed, FolderTree } from "lucide-react"
import { definePlugin, folderBar, folderName, FolderPage, folderTabMenu, FilesPage, FilesPanel, FilesSettings, filesSettingsSearch, isViewOpen, openView, treeShownItems } from "@vaultite"

// The file tree panel and view:files (only the explorer: files are the core's), taking the height under Terminals, and
// a folder's page (view:folder/<path>). Its settings are the vault's files.json; its menus show or hide hidden and archived files.
export default definePlugin({
  sidebar: { files: { title: "File explorer", names: ["file tree", "tree", "explorer"], heading: false, sort: 35, tall: true, view: "files", flyout: { icon: FolderTree, width: 280 },
    menu: treeShownItems, render: (ctx) => <FilesPanel {...ctx} /> } },
  views: {
    files: { icon: FolderClosed, title: () => "Files", tabMenu: () => treeShownItems(), render: ({ store }) => <FilesPage store={store} /> },
    // (pinned, it's the folder itself: Pinned's viewPin)
    folder: { icon: Folder, title: folderName, pathArg: true, pinAs: () => null, tabMenu: () => folderTabMenu(),
      bar: ({ arg }) => folderBar(arg), render: ({ store, arg }) => <FolderPage key={arg} store={store} path={arg} /> },
  },
  settingsPanel: () => <FilesSettings />,
  settingsSearch: filesSettingsSearch,
  commands: [
    { id: "files:open-tab", name: "Open files in a tab", run: () => openView("files", { newTab: !isViewOpen("files") }) },
  ],
})
