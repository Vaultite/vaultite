// Vim: Vim's keys in the whole app (the editor, reading views, lists, the canvas), Space as the leader and Ctrl+W for
// panes, as commands the palette lists and hotkeys.json rebinds. Off until turned on, like any vault plugin.
import { useEffect } from "react"
import { addKeys, definePlugin, get, useVaultChange, type PluginCommand, type Store } from "@vaultite"
import { vimExtension } from "./editor"
import * as app from "./app"
import * as lists from "./lists"
import { setExStore } from "./ex"
import { appKeys, leaderOn, setSettings, SETTINGS_DIR, useDeviceOn, useSettings, type Settings } from "./state"
import { reloadVimrc } from "./vimrc"
import { ModeChip, VimSettings } from "./ui"

// ---------- outside the editor: its own commands ----------
const on = () => appKeys()
const cmd = (id: string, name: string, keys: string[], run: () => void): PluginCommand => ({ id: `vim:${id}`, name, keys, when: on, run })

const commands: PluginCommand[] = [
  cmd("down", "Scroll or move down", ["J"], () => { if (!lists.down()) app.scroll("line", 1) }),
  cmd("up", "Scroll or move up", ["K"], () => { if (!lists.up()) app.scroll("line", -1) }),
  cmd("left", "Scroll or move left", ["H"], () => { if (!lists.left()) app.scrollSide(-1) }),
  cmd("right", "Scroll or move right", ["L"], () => { if (!lists.right()) app.scrollSide(1) }),
  cmd("half-down", "Scroll half a page down", ["D", "Ctrl+D"], () => app.scroll("half", 1)),
  cmd("half-up", "Scroll half a page up", ["U", "Ctrl+U"], () => app.scroll("half", -1)),
  cmd("page-down", "Scroll a page down", ["Ctrl+F"], () => app.scroll("page", 1)),
  cmd("page-up", "Scroll a page up", ["Ctrl+B"], () => app.scroll("page", -1)),
  cmd("top", "Go to the top", ["G G"], () => { if (!lists.top()) app.scrollEdge(true) }),
  cmd("bottom", "Go to the bottom", ["Shift+G"], () => { if (!lists.bottom()) app.scrollEdge(false) }),
  cmd("heading-next", "Go to the next heading", ["] ]"], () => app.heading(1)),
  cmd("heading-previous", "Go to the previous heading", ["[ ["], () => app.heading(-1)),
  cmd("hints", "Show link hints", ["F"], () => app.hints(false)),
  cmd("hints-tab", "Show link hints to open in a new tab", ["Shift+F"], () => app.hints(true)),
  cmd("find", "Find in the page", ["/"], () => app.find()),
  cmd("find-next", "Go to the next match", ["N"], () => app.findNext(1)),
  cmd("find-previous", "Go to the previous match", ["Shift+N"], () => app.findNext(-1)),
  cmd("ex", "Open the Vim command line", ["Shift+;"], () => app.exLine()),
  cmd("edit-here", "Edit where you're reading", ["I"], () => app.editHere()),
  cmd("help", "Show Vim's keys", ["Shift+/"], () => app.showHelp()),
  ...lists.listCommands,
]

// ---------- keys it gives the app's commands ----------
// Space is the leader (like Spacemacs and LazyVim); others are Vimium's (o, x, H, L, gt) and Vim's (Ctrl+W h/j/k/l).
const LEADER: Record<string, string[]> = {
  "switcher:open": ["Space Space", "Space F F"],
  "palette:open": ["Space P"],
  "file:new": ["Space F N"],
  "file:rename": ["Space F R"],
  "file:move": ["Space F M"],
  "file:duplicate": ["Space F C"],
  "file:delete": ["Space F D"],
  "file:copy-path": ["Space F Y"],
  "file:copy-link": ["Space F L"],
  "file:reveal": ["Space F E"],
  "file:pin": ["Space F P"],
  "file:unpin": ["Space F P"],
  "history:open": ["Space F H"],
  "templates:insert": ["Space F T"],
  "sidebar:toggle": ["Space E"],
  "sidebar:toggle-right": ["Space Shift+E"],
  "search:open-tab": ["Space /"],
  "view:toggle": ["Space R"],
  "split:right": ["Space W V"],
  "split:down": ["Space W S"],
  "split:focus-left": ["Space W H"],
  "split:focus-down": ["Space W J"],
  "split:focus-up": ["Space W K"],
  "split:focus-right": ["Space W L"],
  "tab:close": ["Space W Q"],
  "tab:close-others": ["Space W O"],
  "tab:new": ["Space W N"],
  "terminal:open": ["Space T T"],
  "terminal:open-split": ["Space T V"],
  "terminal:open-list": ["Space T L"],
  "graph:open": ["Space G G"],
  "graph:local": ["Space G L"],
  "outline:open-split": ["Space O"],
  "backlinks:open-split": ["Space B"],
  "workspace:1": ["Space 1"], "workspace:2": ["Space 2"], "workspace:3": ["Space 3"], "workspace:4": ["Space 4"], "workspace:5": ["Space 5"],
}
const VIMIUM: Record<string, string[]> = {
  "switcher:open": ["O"],
  "tab:close": ["X", "Ctrl+W Q", "Ctrl+W C"],
  "tab:next": ["G T"],
  "tab:previous": ["G Shift+T"],
  "nav:back": ["Shift+H"],
  "nav:forward": ["Shift+L"],
  "split:right": ["Ctrl+W V"],
  "split:down": ["Ctrl+W S"],
  "split:focus-left": ["Ctrl+W H"],
  "split:focus-down": ["Ctrl+W J"],
  "split:focus-up": ["Ctrl+W K"],
  "split:focus-right": ["Ctrl+W L"],
  "tab:close-others": ["Ctrl+W O"],
}
const merge = (...maps: Record<string, string[]>[]) => {
  const out: Record<string, string[]> = {}
  for (const m of maps) for (const [id, ks] of Object.entries(m)) out[id] = [...(out[id] ?? []), ...ks]
  return out
}

/** The plugin's work in the app: its settings into state.ts, its keys onto the app's commands, the overlays. */
function Background({ store }: { store: Store }) {
  // Its settings (.vaultite/plugins/vim/data.json), again whenever its folder changes (Settings, an AI, the CLI).
  const read = () => { get<Settings>("config/plugin/vim").then(setSettings, () => {}) }
  useEffect(read, [])
  useVaultChange(() => { read(); void reloadVimrc() }, (p) => p.startsWith(`${SETTINGS_DIR}/`))
  useEffect(() => setExStore(store), [store])
  const settings = useSettings()
  const device = useDeviceOn()
  useEffect(() => {
    const keys = merge(leaderOn() ? LEADER : {}, appKeys() ? VIMIUM : {}, appKeys() ? lists.listKeys : {})
    addKeys("vim", Object.keys(keys).length ? keys : null)
    return () => addKeys("vim", null)
  }, [settings, device])
  return <app.AppLayer />
}

export default definePlugin({
  editor: (ctx) => vimExtension(ctx),
  commands,
  keyGroups: {
    "Space": "Leader", "Space F": "Files", "Space W": "Windows", "Space T": "Terminals", "Space G": "Graph",
    "Ctrl+W": "Windows", "G": "Go to",
  },
  details: { [app.KEYS_DETAIL]: { title: () => "Vim keys", render: () => <app.KeysSheet /> } },
  status: { mode: { sort: 0, render: () => <ModeChip /> } },
  background: Background,
  settingsPanel: () => <VimSettings />,
  settingsSearch: [
    { key: "outside", label: "Vim's keys outside the editor", description: "j and k scroll, f shows link hints, / finds, in reading view, pages and lists" },
    { key: "leader", label: "Space is the leader key" },
    { key: "clipboard", label: "Use the system clipboard", description: "yanks and deletes are copied" },
    { key: "device", label: "On this device", description: "Vim's keys on or off here" },
    { key: "vimrc", label: "Vimrc", description: "mappings and options for every editor" },
  ],
})
