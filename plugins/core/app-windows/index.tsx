// App windows: other Mac apps' windows in desktop app tabs (`view:app/<bundle id>[:<window>]`; electron/apps.ts), one
// window a tab, kept right behind the vault window; Holes leaves the tab see-through and lets clicks through.
import { lazy, Suspense, useEffect } from "react"
import { AppWindow, X } from "lucide-react"
import { appWindows, choose, closeView, definePlugin, get, isViewOpen, notifyError, openView, Panel, useVaultChange } from "@vaultite"
import { Holes, throughEnded } from "./Holes"
import { AppIcon, appIcon } from "./icons"
import { appTabs, gone, learnNames, moved, nameOf, parse, setSettings, setWindowTitle, getSettings, SETTINGS_DIR, tabTitle, type Settings } from "./state"

const AppTab = lazy(() => import("./AppTab"))

/** `arg`: an app (any of its windows not in a tab) or one window of it (`<bundle>:<window>`): its tab if it has one. */
const openApp = (arg: string) => openView(`app/${arg}`, { newTab: !isViewOpen(`view:app/${arg}`) })

/** Pick an app's window (those already in a tab first, then the running apps', each window apart), or an app to open,
 *  and show it in a tab (or go to its tab). */
async function pickApp() {
  try {
    const { running, installed } = await appWindows!.list()
    learnNames([...installed, ...running])
    const open = new Set(running.map((a) => a.bundle)), tabbed = new Set(appTabs())
    const windows = running.flatMap((a) => a.windows?.length
      ? a.windows.map((w) => ({ id: `${a.bundle}:${w.wid}`, label: a.windows!.length > 1 && w.title ? `${a.name}: ${w.title}` : a.name, detail: "Open", bundle: a.bundle }))
      : [{ id: a.bundle, label: a.name, detail: "Open", bundle: a.bundle }])
    const items = [
      ...windows.filter((w) => tabbed.has(w.id)).map((w) => ({ ...w, detail: "In a tab" })),
      ...windows.filter((w) => !tabbed.has(w.id)),
      ...installed.filter((a) => !open.has(a.bundle)).sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ id: a.bundle, label: a.name, bundle: a.bundle })),
    ].map(({ bundle, ...it }) => ({ ...it, icon: <AppIcon bundle={bundle} className="size-5" /> }))
    choose({ title: "Open app in a tab", placeholder: "An app", items, onPick: (it) => openApp(it.id) })
  } catch (e) { notifyError(e, "Couldn't list the apps") }
}

function Background() {
  const read = () => { get<Settings>("config/plugin/app-windows").then((s) => setSettings(s && typeof s === "object" ? s : {}), () => {}) }
  useEffect(read, [])
  useVaultChange(read, (p) => p.startsWith(`${SETTINGS_DIR}/`))
  useEffect(() => appWindows?.on((m) => {
    if (m.type === "gone") gone(m.wid)
    else if (m.type === "here") moved(m.wid, m.here)
    else if (m.type === "title") setWindowTitle(m.wid, m.title)
    else if (m.type === "through") throughEnded()
    // (its app came in front with it, a link opened in it say: its tab shown, as the app is)
    else if (m.type === "front") { const arg = appTabs().find((a) => parse(a).wid === m.wid); if (arg) openApp(arg) }
    // (a new window of an app in a tab: Brave's ⌘N, a link opened in a new window)
    else if (m.type === "window" && getSettings().newWindows !== false) { setWindowTitle(m.wid, m.title); openApp(`${m.bundle}:${m.wid}`) }
  }), [])
  // (the tabs' titles: the apps' own names)
  useEffect(() => { void appWindows?.list().then((r) => learnNames([...r.installed, ...r.running]), () => {}) }, [])
  return <Holes />
}

function Preview() {
  return (
    <Panel title="App windows" icon={AppWindow} tint="var(--app-windows)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Other Mac apps in a tab of the desktop app, next to your notes. The app's own window is kept right behind the tab,
        so it works as it always does; closing the tab gives it back where it was.
      </p>
    </Panel>
  )
}

export default definePlugin({
  views: {
    app: {
      icon: AppWindow,
      iconFor: (arg) => appIcon(parse(arg).bundle),
      title: tabTitle,
      full: true,
      keepsTab: true,
      // (the window it holds is the tab's own state: a tab without one takes one)
      argState: true,
      render: ({ arg, focused, setArg }) => <Suspense fallback={null}><AppTab arg={arg} focused={focused} setArg={setArg} /></Suspense>,
      onClose: (arg) => { const { wid } = parse(arg); if (wid) void appWindows?.release(wid) },
      // (closing the tab leaves the window to the app, but one made for the tab; this closes it, as its close button does)
      tabMenu: (arg) => {
        const { bundle, wid } = parse(arg), api = appWindows
        if (!wid || !api?.close) return []
        return [{ label: `Close ${nameOf(bundle)} window`, icon: X, danger: true, run: () => { void api.close!(wid); closeView(`app/${arg}`) } }]
      },
    },
  },
  commands: [
    { id: "app-windows:open", name: "Open app in a tab…", desktop: true, when: () => !!appWindows, run: () => void pickApp(), icon: AppWindow },
  ],
  background: Background,
  preview: () => <Preview />,
})
