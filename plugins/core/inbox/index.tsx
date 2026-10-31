// The Inbox's frontend: a toast (and the Mac's notification while the window is behind) for what the server says to
// tell (`nt`), unless the user is looking at it; the header button steps aside while the panel is in a sidebar.
import { useEffect, useRef, useState } from "react"
import { AlarmClockOff, BellOff, Check, CheckCheck, Clock, FolderInput, Inbox as InboxIcon, RotateCcw } from "lucide-react"
import { AmbientButton, definePlugin, getStore, onTabLayoutChange, notify, openFile, Panel, stampMs, systemNotify, useStore, viewOnScreen, type Store } from "@vaultite"
import { focusedTarget, follow, GATE_DETAIL, getEvents, heldNow, markRead, onFresh, openEvent, SESSION_DETAIL, subscribeEvents, targetOf, useEvents, viewOf } from "./events"
import { SessionSheet, sessionTitle } from "./Session"
import { ReplyBlock } from "./Reply"
import { fileTo, GateSheet, gateTitle, InboxBlock, InboxButton, InboxPage, InboxPanel, InboxRailIcon, markDone, openInbox, SNOOZE_DETAIL, snoozeItems, snoozeKeys, SnoozeSheet, toReview, useBack, useCount } from "./Inbox"
import { snoozed, snoozeMs } from "./snooze"
import { settings, type Settings } from "./settings"
import type { InboxEvent, InboxItem } from "./types"


/** The user is looking at what an agent's news is about, in a window in front: its terminal or session is the focused
 *  tab, or what it links to is on screen (a browser tab's ask). (Not a message meant to be seen: info, error.) */
const watching = (e: InboxEvent) => (e.kind === "session" || e.kind === "waiting") && document.visibilityState === "visible" && document.hasFocus() &&
  ([targetOf(e), viewOf(e)].includes(focusedTarget()) || viewOnScreen(targetOf(e) ?? ""))

/** A toast's text: the title and the body's first line, short (the whole body is in the Inbox: a session's answer, a
 *  day's learnings, a log). */
function toastText(e: InboxEvent) {
  const first = e.gate ? "" : e.preview || (e.body?.split("\n").map((l) => l.replace(/^[-*>#\s]+/, "").trim()).find(Boolean) ?? "")
  if (!first) return e.title
  return first.length > 140 ? `${e.title}: ${first.slice(0, 139).trimEnd()}…` : `${e.title}: ${first}`
}

function announce(e: InboxEvent, s: Settings) {
  if (getEvents().events.find((x) => x.id === e.id)?.read) return
  const to = targetOf(e)
  // (an agent's news a moment later: what it's about may be opening on screen, a browser ask's tab)
  const toast = () => {
    if (s.toasts === false || watching(e) || getEvents().events.find((x) => x.id === e.id)?.read) return
    notify(toastText(e), { id: `inbox-${e.id}`, kind: e.kind === "error" ? "error" : undefined, action: to ? { label: "Open", run: () => openEvent(e) } : undefined })
  }
  if (e.kind === "session" || e.kind === "waiting") setTimeout(toast, 800); else toast()
  if (s.notifications !== false && !document.hasFocus()) systemNotify(e.title, e.preview || e.body || "")?.then((clicked) => { if (clicked) openEvent(e) })
}

/** When a result last had news (its thread's latest report, else when it came) as ms. */
const latestAt = (r: InboxItem) => {
  const at = r.updated || r.created
  return at ? stampMs(at) || 0 : 0
}

function Background({ store }: { store: Store }) {
  useEffect(() => void settings.ready(), [])
  useEffect(() => follow(), [])
  useEffect(() => onFresh((e) => announce(e, settings.get())), [])
  // A result that just arrived (an agent's inbox_add, a clip) or a snoozed one whose time came: said once. Not the ones
  // there when the app loads, nor one brought back (Undo, Unsnooze), nor a report (its session's row tells it).
  const known = useRef<Set<string> | null>(null)
  const away = useRef(new Map<string, number>())
  useBack(store)
  const review = toReview(store)
  useEffect(() => {
    const first = known.current === null, held = !!heldNow()
    const seen = known.current ?? new Set<string>()
    for (const r of store.inbox ?? []) if (r.status === "new" && snoozed(r.snoozed)) { away.current.set(r.id, snoozeMs(r.snoozed)); seen.delete(r.id) }
    for (const r of review) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      const until = away.current.get(r.id)
      away.current.delete(r.id)
      if (until !== undefined && until <= Date.now() + 5000) {
        if (!held && settings.get().toasts !== false) notify(`Back in your inbox: ${r.title}`, { id: `inbox-${r.id}`, action: { label: "Open", run: () => openFile(`${r.id}.md`) } })
        continue
      }
      if (first || held || Date.now() - latestAt(r) > 10 * 60_000 || r.session || r.terminal) continue
      if (settings.get().toasts !== false) notify(`In your inbox: ${r.title}`, { id: `inbox-${r.id}`, action: { label: "Open", run: () => openFile(`${r.id}.md`) } })
      if (settings.get().notifications !== false && !document.hasFocus()) {
        systemNotify("In your inbox", r.title)?.then((clicked) => { if (clicked) openFile(`${r.id}.md`) })
      }
    }
    known.current = seen
  }, [review])
  // What the user is looking at is read (seen, not done): an event whose terminal (or file) is the focused tab, in a
  // window in front.
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
        What your agents tell you, in one place. Each session of Claude Code or another coding agent is one thread: when it
        needs you (it asks something, wants an approval, answered or reported with something to read), it's in the inbox
        with a toast (and a system notification, while the app is in the background), and stays there until you mark it
        done or reply and it finishes with nothing more for you. A turn done with nothing for you goes in quietly. Results
        to read later, like an agent's research or a clipped page, land in the Inbox folder, to mark done (into
        Inbox/.archive/) or file away.
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
  const hold = heldNow(useEvents().hold)
  useMinute(!!hold)
  if (hold) {
    const until = new Date(snoozeMs(hold.until)).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    return <AmbientButton icon={BellOff} text={n || undefined} tip={`Inbox held until ${until}${hold.label ? `, for ${hold.label}` : ""}${n ? `: ${n} new` : ""}`} onClick={openInbox} />
  }
  return n ? <AmbientButton icon={InboxIcon} text={n} tip={`Inbox, ${n} new`} tint="var(--inbox)" onClick={openInbox} /> : null
}

/** Draw again every half minute while `on` (a hold ends by its time). */
function useMinute(on: boolean) {
  const [, tick] = useState(0)
  useEffect(() => { if (!on) return; const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t) }, [on])
}

export default definePlugin({
  ambient: { new: { title: "Inbox", sort: 30, render: () => <InboxNew /> } },
  background: ({ store }) => <Background store={store} />,
  header: { inbox: { sort: 50, phoneBar: true, render: (ctx) => <InboxButton {...ctx} /> } },
  sidebar: {
    inbox: { title: "Inbox", heading: false, sort: 20, hidden: true, view: "inbox", flyout: { icon: InboxRailIcon }, render: (ctx) => <InboxPanel {...ctx} /> },
  },
  views: { inbox: { icon: InboxIcon, title: () => "Inbox", render: ({ store, focused }) => <InboxPage store={store} focused={focused} /> } },
  details: {
    [GATE_DETAIL]: { title: (_s, [id]) => gateTitle(id), render: (_s, [id]) => <GateSheet id={id} /> },
    [SESSION_DETAIL]: { title: (_s, [id]) => sessionTitle(id), render: (_s, [id]) => <SessionSheet id={id} /> },
    [SNOOZE_DETAIL]: { title: () => "Snooze until", render: (_s, keys) => <SnoozeSheet keys={keys} /> },
  },
  blocks: { inbox: ({ store, options }) => <InboxBlock store={store} options={options} />, reply: (ctx) => <ReplyBlock {...ctx} /> },
  files: { types: ["inbox"], folders: ["Inbox"], icon: InboxIcon, tint: "var(--inbox)" },
  fileMenu: (path) => {
    const r = resultAt(path)
    if (!r) return []
    return [
      r.status === "done"
        ? { label: "Mark as new", icon: RotateCcw, section: "actions", run: () => markDone(r, false) }
        : { label: "Done", icon: Check, section: "actions", run: () => markDone(r) },
      { label: "File to…", icon: FolderInput, section: "actions", run: () => fileTo(r) },
      ...(r.status === "done" ? [] : snoozed(r.snoozed)
        ? [{ label: "Unsnooze", icon: AlarmClockOff, section: "actions", run: () => snoozeKeys([`r:${r.id}`], null) }]
        : [{ label: "Snooze", icon: Clock, section: "actions", run: () => {}, items: snoozeItems([`r:${r.id}`]) }]),
    ]
  },
  commands: [
    { id: "inbox:open", name: "Open inbox", run: openInbox },
    { id: "inbox:read", name: "Mark inbox events read", when: () => getEvents().unread > 0, run: () => markRead(), icon: CheckCheck },
  ],
  mock,
  preview: () => <Preview />,
})
