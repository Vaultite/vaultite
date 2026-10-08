import { FileText, Pin, PinOff } from "lucide-react"
import {
  currentEditor, currentFile, definePlugin, getTabLayout, iconOf, isDoc, isViewOpen, openFile, openView, PIN_SEARCH, stem, tintOf, useCommands, useFocusedFile,
  usePane, useWorkspaceVersion, type Store, type TabLayout,
} from "@vaultite"
import { PinCurrent, PinnedPages } from "./Pinned"
import { PinnedSettings } from "./SettingsPanel"
import { isPinned, pinItems, pinnable, pinNoted, shownPinned } from "./types"

// Pinned: all of pinning in the app (panel, Pin/Unpin, Open commands, a device's first tab, a phone's tiles). Off,
// nothing is pinned or shown; the lists stay in the vault for when it's on again.

/** The heading the cursor is under in the note being edited, as a pin ("Notes/Idea.md#Plan"), or null. */
function headingHere() {
  const ed = currentEditor()
  if (!ed || ed.kind !== "markdown" || !ed.path || !pinnable(ed.path)) return null
  const doc = ed.view.state.doc
  let fence = false
  const found: string[] = []
  // The last heading above the cursor, outside code fences and the frontmatter.
  for (let n = doc.lineAt(ed.start?.(ed.view.state) ?? 0).number; n <= doc.lineAt(ed.view.state.selection.main.head).number; n++) {
    const t = doc.line(n).text
    if (/^\s*(```|~~~)/.test(t)) fence = !fence
    const m = !fence && /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(t)
    if (m) found.push(m[1])
  }
  return found.length ? `${ed.path}#${found[found.length - 1]}` : null
}

/** The focused pane's active tab's target. */
function activeTarget(w: TabLayout) {
  const walk = (n: TabLayout["root"]): string | null => {
    if ("kids" in n) { for (const k of n.kids) { const t = walk(k); if (t !== null) return t } return null }
    return n.id === w.focus ? n.tabs.find((t) => t.id === n.active)?.to ?? null : null
  }
  return walk(w.root)
}
/** The search on screen (a search tab with a query), as a pin ("search:<query>"), or null. */
function searchHere() {
  const to = activeTarget(getTabLayout()) ?? ""
  const q = to.startsWith("view:search/") ? to.slice("view:search/".length).trim() : ""
  return q ? PIN_SEARCH + q : null
}

// The same list as a tab (view:pages: drag the panel's heading onto a pane, or the command).
function PinnedView({ store }: { store: Store }) {
  // Pages open beside this tab: in the pane of the file focused last when that's another pane (like Links).
  const focused = useFocusedFile()
  const own = usePane().group
  return (
    <div data-pages-view>
      <p className="mb-3 text-[13px] text-muted-foreground max-md:text-[15px]">The sidebar's pages, in its order.<span className="max-md:hidden"> Drag one to reorder it, or onto a pane to open it there.</span></p>
      {/* The panel's list, a size up (`data-size-up`). */}
      <div className="size-up-bleed"><div data-size-up>
        <PinnedPages store={store} open file={focused.path} tab="" pane={focused.group && focused.group !== own ? focused.group : undefined} />
      </div></div>
    </div>
  )
}

/** "Open Today", "Open People"...: one command per pinned page, while it shows (registered from the background). */
function PageCommands({ store }: { store: Store }) {
  useWorkspaceVersion() // the list is the current workspace's
  const pages = shownPinned(store)
  useCommands(() => pages.map(({ key: p, file }) => ({ id: `page:file/${encodeURIComponent(p)}`, name: `Open ${stem(p)}`, run: () => openFile(p), icon: iconOf(file) ?? FileText })),
    [pages.map((p) => `${p.key}\t${p.file.icon ?? ""}`).join("\n")])
  return null
}

/** A phone's new tab: the pinned pages first, as tiles (the sidebar's, a tap away from +). Sized in the page's units
 *  (it's drawn a size up: NewTab), spread evenly with the first icon under the heading's text and the last at the same
 *  inset from the right: each column is an icon (9 units) and room either side, and the grid reaches out to the edges
 *  by that room less the inset (1.5 units, SidebarRow's), so (W - 2·inset - n·icon) / (2n - 2) a side. A name stays
 *  within the icon and its inset either side (the column reaches past the page's edge), on up to two lines. */
function Tiles({ store }: { store: Store }) {
  const pages = shownPinned(store)
  if (!pages.length) return null
  return (
    <div data-new-tab-pages className="grid grid-cols-4 gap-y-2 py-1 mx-[calc(var(--spacing)*1.5_-_(100%_-_var(--spacing)*39)/6)]
      min-[600px]:grid-cols-6 min-[600px]:mx-[calc(var(--spacing)*1.5_-_(100%_-_var(--spacing)*57)/10)]">
      {pages.map(({ key, file }) => {
        const Icon = iconOf(file) ?? FileText
        return (
          <a key={key} href={`#file/${encodeURIComponent(key)}`} className="flex min-w-0 flex-col items-center gap-1 active:opacity-60">
            <span className="grid size-9 place-items-center rounded-[11px] bg-card shadow-sm ring-[0.5px] ring-border">
              <Icon className="size-[20px]" strokeWidth={1.9} style={{ color: tintOf(file.tint) ?? "var(--primary)" }} />
            </span>
            <span className="line-clamp-2 w-[calc(var(--spacing)*12)] max-w-full text-center text-[10px] leading-[13px] break-words">{stem(key)}</span>
          </a>
        )
      })}
    </div>
  )
}

export default definePlugin({
  icon: Pin,
  sidebar: { pages: { title: "Pinned pages", heading: "Pinned", sort: 10, view: "pages", render: (ctx) => <PinnedPages {...ctx} />,
    actions: ({ file }) => <PinCurrent file={file} /> } },
  views: {
    pages: { icon: Pin, title: () => "Pinned pages", render: ({ store }) => <PinnedView store={store} /> },
  },
  commands: [
    { id: "pages:open-tab", name: "Open pinned pages in a tab", run: () => openView("pages", { newTab: !isViewOpen("pages") }) },
    // In the sidebar's list: the current workspace's, with Workspaces on.
    { id: "file:pin", name: "Pin current file to the sidebar", desktop: true, when: () => pinnable(currentFile()) && !isPinned(currentFile()), run: () => pinNoted(currentFile(), true) },
    { id: "file:unpin", name: "Unpin current file from the sidebar", desktop: true, when: () => !!currentFile() && isPinned(currentFile()), run: () => pinNoted(currentFile(), false), icon: PinOff },
    // Bookmarks: the heading the cursor is under, the search on screen.
    { id: "file:pin-heading", name: "Pin current heading to the sidebar", desktop: true, when: () => { const h = headingHere(); return !!h && !isPinned(h) }, run: () => pinNoted(headingHere()!, true) },
    { id: "search:pin", name: "Pin current search to the sidebar", desktop: true, when: () => { const q = searchHere(); return !!q && !isPinned(q) }, run: () => pinNoted(searchHere()!, true) },
  ],
  // A note, JSON, an artifact or a table can be a page: Pin or Unpin in its menus (the tree's, its tab's, the phone's …),
  // in the current workspace's list with Workspaces on.
  fileMenu: (path) => (pinnable(path) && isDoc(path) ? pinItems(path) : []),
  // The pinned pages, found first (search's highest weight) and listed with the suggestions.
  search: (store) => shownPinned(store).map(({ key, file }) => ({
    id: `page-${key}`, title: stem(key), meta: "Page", kind: "Page", icon: iconOf(file) ?? FileText, tint: tintOf(file.tint) ?? "var(--primary)",
    file: key, text: key, recent: 0, weight: 12,
  })),
  // A new device opens on the first pinned page.
  home: (store) => { const first = shownPinned(store)[0]; return first ? `file:${first.key}` : null },
  // The pinned pages as tiles, at the top of a blank tab on phones (dragged by their heading, as the other sections).
  newTab: { tiles: { title: "Pinned pages", sort: 0, only: "phone", heading: "Pinned", render: ({ store }) => <Tiles store={store} /> } },
  settingsPanel: ({ store }) => <PinnedSettings store={store} />,
  settingsSearch: [{ label: "Pinned pages", description: "which pages the sidebar pins, in order" }],
  background: ({ store }) => <PageCommands store={store} />,
})
