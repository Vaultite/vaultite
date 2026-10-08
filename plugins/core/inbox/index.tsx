// The Inbox's frontend: a toast (and the Mac's notification while the window is behind) for each new event, unless it's
// about what the user is looking at; the header button steps aside while the panel is in a sidebar.
import { useEffect, useRef } from "react"
import { Check, CheckCheck, FolderInput, Inbox as InboxIcon, RotateCcw } from "lucide-react"
import { AmbientButton, definePlugin, fmtDay, fmtTime, get, getStore, iso, onTabLayoutChange, notify, openFile, Panel, systemNotify, useStore, useVaultChange, type Store } from "@vaultite"
import { focusedTarget, follow, getEvents, markRead, onFresh, openEvent, subscribeEvents, targetOf } from "./events"
import { ReplyBlock } from "./Reply"
import { fileTo, InboxBlock, InboxButton, InboxPage, InboxPanel, InboxRailIcon, markDone, openInbox, toReview, useCount } from "./Inbox"
import { setSettings, useSettings, type Settings } from "./settings"
import type { InboxEvent, InboxItem } from "./types"

const SETTINGS = ".vaultite/plugins/inbox/data.json"

/** The user is looking at what an agent's news is about (finished, waiting): its terminal or session is the focused
 *  tab, in a window that's in front. (Not a message meant to be seen, `vau notify`'s: info, error.) */
const watching = (e: InboxEvent) => (e.kind === "done" || e.kind === "waiting") && document.visibilityState === "visible" && document.hasFocus() &&
  targetOf(e) === focusedTarget()

function announce(e: InboxEvent, s: Settings) {
  if (getEvents().events.find((x) => x.id === e.id)?.read) return
  const to = targetOf(e)
  if (s.toasts !== false) {
    notify(e.body ? `${e.title}: ${e.body}` : e.title, {
      id: `inbox-${e.id}`, kind: e.kind === "error" ? "error" : undefined,
      action: to ? { label: "Open", run: () => openEvent(e) } : undefined,
    })
  }
  if (s.notifications !== false && !document.hasFocus()) systemNotify(e.title, e.body ?? "")?.then((clicked) => { if (clicked) openEvent(e) })
}

/** When a result last had news (its thread's latest report, else when it came: UTC, "2026-10-01 18:00:00") as ms. */
const latestAt = (r: InboxItem) => {
  const at = r.updated || r.created
  return at ? Date.parse(`${at.replace(" ", "T")}${/Z|[+-]\d\d:?\d\d$/.test(at) ? "" : "Z"}`) : 0
}
/** When a result last had news, local: "Today, 14:32", "Oct 6, 23:46". */
function cameAt(r: InboxItem) {
  const t = latestAt(r)
  if (!t) return null
  const d = new Date(t)
  return <span title={d.toLocaleString()}>{fmtDay(iso(d))}, {fmtTime(d.toISOString())}</span>
}

function Background({ store }: { store: Store }) {
  const settings = useSettings()
  const ref = useRef(settings)
  useEffect(() => { ref.current = settings }, [settings])
  const load = () => { get<Settings>("config/plugin/inbox").then(setSettings, () => {}) }
  useEffect(load, [])
  useVaultChange(load, (p) => p === SETTINGS)
  useEffect(() => follow(), [])
  useEffect(() => onFresh((e) => announce(e, ref.current)), [])
  // A result that just arrived (an agent's inbox_add, a clip, a file written there): said once, like an event. Not the
  // ones there when the app loads, nor one coming back (Undo).
  const known = useRef<Set<string> | null>(null)
  const review = toReview(store)
  useEffect(() => {
    const first = known.current === null
    const seen = known.current ?? new Set<string>()
    for (const r of review) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      if (first || Date.now() - latestAt(r) > 10 * 60_000) continue
      if (ref.current.toasts !== false) notify(`In your inbox: ${r.title}`, { id: `inbox-${r.id}`, action: { label: "Open", run: () => openFile(`${r.id}.md`) } })
      if (ref.current.notifications !== false && !document.hasFocus()) {
        systemNotify("In your inbox", r.title)?.then((clicked) => { if (clicked) openFile(`${r.id}.md`) })
      }
    }
    known.current = seen
  }, [review])
  // What the user is looking at is read: an event whose terminal (or file) is the focused tab, in a window in front.
  useEffect(() => {
    const check = () => {
      const hit = getEvents().events.filter((e) => !e.read && watching(e))
      if (hit.length) markRead(hit.map((e) => e.id))
    }
    const offs = [onTabLayoutChange(check), subscribeEvents(check)]
    addEventListener("focus", check)
    document.addEventListener("visibilitychange", check)
    return () => { offs.forEach((f) => f()); removeEventListener("focus", check); document.removeEventListener("visibilitychange", check) }
  }, [])
  return null
}

const resultAt = (path: string): InboxItem | undefined => getStore()?.inbox?.find((r) => `${r.id}.md` === path)

function Preview() {
  return (
    <Panel title="Inbox" icon={InboxIcon} tint="var(--inbox)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        What your agents tell you, in one place. When Claude Code or another coding agent finishes or waits for an answer, a toast
        says so (and a system notification, while the app is in the background), with a click to its terminal. Results to read
        later, like an agent's research or a clipped page, land in the Inbox folder, to mark done (into Inbox/.archive/) or file away.
      </p>
    </Panel>
  )
}

function mock(): Partial<Store> {
  const at = (min: number) => new Date(Date.now() - min * 60000).toISOString().slice(0, 19).replace("T", " ")
  return {
    inbox: [
      { id: "Inbox/Plant care apps compared", title: "Plant care apps compared", status: "new", from: "Claude", source: "", created: at(40), body: "" },
      { id: "Inbox/A field guide to tiling window managers", title: "A field guide to tiling window managers", status: "new", from: "Web clipper",
        source: "https://example.com/tiling", created: at(180), body: "" },
    ],
  }
}

/** The status bar's count of what's new, when there's any. */
function InboxNew() {
  const n = useCount(useStore().store ?? ({} as Store))
  return n ? <AmbientButton icon={InboxIcon} text={n} tip={`Inbox, ${n} new`} tint="var(--inbox)" onClick={openInbox} /> : null
}

export default definePlugin({
  ambient: { new: { title: "Inbox", sort: 30, render: () => <InboxNew /> } },
  background: ({ store }) => <Background store={store} />,
  header: { inbox: { sort: 50, phoneBar: true, render: (ctx) => <InboxButton {...ctx} /> } },
  sidebar: {
    inbox: { title: "Inbox", heading: false, sort: 20, hidden: true, view: "inbox", flyout: { icon: InboxRailIcon }, render: (ctx) => <InboxPanel {...ctx} /> },
  },
  views: { inbox: { icon: InboxIcon, title: () => "Inbox", render: ({ store, focused }) => <InboxPage store={store} focused={focused} /> } },
  blocks: { inbox: ({ store, options }) => <InboxBlock store={store} options={options} />, reply: (ctx) => <ReplyBlock {...ctx} /> },
  files: { types: ["inbox"], folders: ["Inbox"], icon: InboxIcon, tint: "var(--inbox)",
    kicker: ({ store, path }) => { const r = store.inbox?.find((x) => `${x.id}.md` === path); return r ? [r.status === "done" ? "Done" : "To review", r.from && `from ${r.from}`].filter(Boolean).join(" · ") : "Inbox" },
    aside: ({ store, path }) => { const r = store.inbox?.find((x) => `${x.id}.md` === path); return r ? cameAt(r) : null } },
  fileMenu: (path) => {
    const r = resultAt(path)
    if (!r) return []
    return [
      r.status === "done"
        ? { label: "Mark as new", icon: RotateCcw, section: "actions", run: () => markDone(r, false) }
        : { label: "Done", icon: Check, section: "actions", run: () => markDone(r) },
      { label: "File to…", icon: FolderInput, section: "actions", run: () => fileTo(r) },
    ]
  },
  commands: [
    { id: "inbox:open", name: "Open inbox", run: openInbox },
    { id: "inbox:read", name: "Mark inbox events read", when: () => getEvents().unread > 0, run: () => markRead(), icon: CheckCheck },
  ],
  mock,
  preview: () => <Preview />,
})
