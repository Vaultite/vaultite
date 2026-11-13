import { useEffect, useRef, useState } from "react"
import { AlarmClockOff, ArrowDown, ArrowUp, BellOff, Check, CheckCheck, Clock, FolderInput, Inbox as InboxIcon, Mail, MailOpen, MessageSquareReply, Pin, RotateCcw } from "lucide-react"
import { AmbientButton, backDetail, definePlugin, getStore, onTabLayoutChange, notify, openFile, Panel, stampMs, systemNotify, useStore, viewOnScreen, type Store } from "@vaultite"
import { focusedTarget, follow, GATE_DETAIL, getEvents, heldNow, markRead, markUnread, onFresh, pinEvents, openEvent, SESSION_DETAIL, subscribeEvents, targetOf, useEvents, viewOf } from "./events"
import { SessionSheet, sessionTitle } from "./Session"
import { ReplyBlock } from "./Reply"
import { DecisionsBlock } from "./DecisionRows"
import { byKey, doneByKey, fileTo, keysOnThreads, press, stepSheet, GateSheet, keysOnInbox, pinByKey, readByKey, replyByKey, snoozeByKey, stepRow, gateTitle, InboxBlock, InboxButton, InboxPage, InboxPanel, InboxRailIcon, ItemBar, markDone, openInbox, SNOOZE_DETAIL, snoozeItems, snoozeKeys, SnoozeSheet, tabButtonsOf, toReview, useBack, useCount } from "./Inbox"
import { snoozed, snoozeMs } from "./snooze"
import { settings, type Settings } from "./settings"
import type { InboxEvent, InboxItem } from "./types"

const watching = (e: InboxEvent) => (e.kind === "session" || e.kind === "waiting") && document.visibilityState === "visible" &&
  ([targetOf(e), viewOf(e)].includes(focusedTarget()) || viewOnScreen(targetOf(e) ?? ""))

function toastText(e: InboxEvent) {
  const first = e.gate ? "" : e.preview || (e.body?.split("\n").map((l) => l.replace(/^[-*>#\s]+/, "").trim()).find(Boolean) ?? "")
  if (!first) return e.title
  return first.length > 140 ? `${e.title}: ${first.slice(0, 139).trimEnd()}…` : `${e.title}: ${first}`
}

function announce(e: InboxEvent, s: Settings) {
  if (getEvents().events.find((x) => x.id === e.id)?.read) return
  const to = targetOf(e)
  const toast = () => {
    if (s.toasts === false || watching(e) || getEvents().events.find((x) => x.id === e.id)?.read) return
    notify(toastText(e), { id: `inbox-${e.id}`, kind: e.kind === "error" ? "error" : undefined, action: to ? { label: "Open", run: () => openEvent(e) } : undefined })
  }
  if (e.kind === "session" || e.kind === "waiting") setTimeout(toast, 800); else toast()
  if (s.notifications !== false && !document.hasFocus()) systemNotify(e.title, e.preview || e.body || "")?.then((clicked) => { if (clicked) openEvent(e) })
}

const latestAt = (r: InboxItem) => {
  const at = r.updated || r.created
  return at ? stampMs(at) || 0 : 0
}

function Background({ store }: { store: Store }) {
  useEffect(() => void settings.ready(), [])
  useEffect(() => follow(), [])
  useEffect(() => onFresh((e) => announce(e, settings.get())), [])
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
        What your agents need you to decide, in one place. Each question an agent asks is its own item, its options as
        buttons and the default it takes if you don't answer: the ones it waits on come first, with a toast and a push to
        your phone; the ones where it went with the default already wait quietly, and Accept all defaults takes them all.
        What agents finish goes in the morning brief, one line each; their progress shows on their own rows. Results to
        read later, like research or a clipped page, land in the Inbox folder too.
      </p>
    </Panel>
  )
}

function mock(): Partial<Store> {
  const at = (min: number) => new Date(Date.now() - min * 60000).toISOString().slice(0, 19).replace("T", " ")
  return {
    inbox: [
      { id: "Inbox/Deploy account", title: "Deploy account", status: "new", from: "Claude Code", source: "", created: at(12), body: "",
        question: "Which account should tonight's deploy use?", options: ["Work", "Personal"], default: "Personal", blocking: true },
      { id: "Inbox/Quieter island", title: "Quieter island", status: "new", from: "Codex", source: "", created: at(95), body: "The spinner shows only on hover now.",
        question: "Keep the quieter island by the notch?", options: ["Keep", "Go back"], default: "Keep", blocking: false },
      { id: "Inbox/Plant care apps compared", title: "Plant care apps compared", status: "new", from: "Claude", source: "", created: at(40), body: "" },
      { id: "Inbox/A field guide to tiling window managers", title: "A field guide to tiling window managers", status: "new", from: "Web clipper",
        source: "https://example.com/tiling", created: at(180), body: "" },
    ],
  }
}

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

function useMinute(on: boolean) {
  const [, tick] = useState(0)
  useEffect(() => { if (!on) return; const t = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(t) }, [on])
}

export default definePlugin({
  ambient: { new: { title: "Inbox", sort: 30, render: () => <InboxNew /> } },
  background: ({ store }) => <Background store={store} />,
  header: { inbox: { sort: 50, phoneBar: true, render: (ctx) => <InboxButton {...ctx} /> } },
  sidebar: {
    inbox: { title: "Inbox", heading: false, needsHeading: true, sort: 20, hidden: true, ai: true, view: "inbox", flyout: { icon: InboxRailIcon }, render: (ctx) => <InboxPanel {...ctx} /> },
  },
  views: { inbox: { icon: InboxIcon, title: () => "Inbox", render: ({ store, focused }) => <InboxPage store={store} focused={focused} /> } },
  details: {
    [GATE_DETAIL]: { title: (_s, [id]) => gateTitle(id), render: (_s, [id]) => <GateSheet id={id} /> },
    [SESSION_DETAIL]: { title: (_s, [id]) => sessionTitle(id), render: (_s, [id]) => <SessionSheet id={id} /> },
    [SNOOZE_DETAIL]: { title: () => "Snooze until", render: (_s, keys) => <SnoozeSheet keys={keys} /> },
  },
  blocks: { inbox: ({ store, options }) => <InboxBlock store={store} options={options} />, reply: (ctx) => <ReplyBlock {...ctx} />, decisions: (ctx) => <DecisionsBlock {...ctx} /> },
  files: { types: ["inbox"], folders: ["Inbox"], icon: InboxIcon, tint: "var(--inbox)" },
  tabButtons: tabButtonsOf,
  fileBar: { item: { title: "Inbox item", sort: 52, render: (file) => <ItemBar file={file} /> } },
  fileMenu: (path) => {
    const r = resultAt(path)
    if (!r) return []
    return [
      r.status === "done"
        ? { label: "Mark as new", icon: RotateCcw, section: "actions", run: () => markDone(r, false) }
        : { label: "Settle", icon: Check, section: "actions", run: () => markDone(r) },
      { label: "File to…", icon: FolderInput, section: "actions", run: () => fileTo(r) },
      ...(r.status === "done" ? [] : snoozed(r.snoozed)
        ? [{ label: "Wake", icon: AlarmClockOff, section: "actions", run: () => snoozeKeys([`r:${r.id}`], null) }]
        : [{ label: "Snooze", icon: Clock, section: "actions", run: () => {}, items: snoozeItems([`r:${r.id}`]) }]),
    ]
  },
  commands: [
    { id: "inbox:open", name: "Open inbox", keys: ["G I"], run: openInbox },
    { id: "inbox:next", name: "Move to the next inbox row", keys: ["J"], when: keysOnThreads, run: byKey(() => stepRow(1), (_, id) => stepSheet(id, 1)), icon: ArrowDown },
    { id: "inbox:previous", name: "Move to the previous inbox row", keys: ["K"], when: keysOnThreads, run: byKey(() => stepRow(-1), (_, id) => stepSheet(id, -1)), icon: ArrowUp },
    { id: "inbox:settle", name: "Settle the inbox row", keys: ["E"], when: keysOnThreads, run: byKey(doneByKey, (s) => press(s, "[data-session-done]")), icon: Check },
    { id: "inbox:snooze", name: "Snooze the inbox row", keys: ["B"], when: keysOnInbox, run: snoozeByKey, icon: Clock },
    { id: "inbox:reply", name: "Reply to the inbox row's session", keys: ["R"], when: keysOnThreads,
      run: byKey(replyByKey, (s) => s.querySelector<HTMLTextAreaElement>("textarea[data-reply]")?.focus()), icon: MessageSquareReply },
    { id: "inbox:pin", name: "Pin or unpin the inbox row", keys: ["P"], when: keysOnThreads, run: byKey(pinByKey, (_, id) => { const e = getEvents().events.find((x) => x.id === id); if (e && e.state !== "done") pinEvents([id], !e.pinned) }), icon: Pin },
    { id: "inbox:mark-read", name: "Mark the inbox row read", keys: ["Shift+I"], when: keysOnInbox, run: () => readByKey(true), icon: MailOpen },
    { id: "inbox:mark-unread", name: "Mark the inbox row unread", keys: ["Shift+U"], when: keysOnThreads, run: byKey(() => readByKey(false), (_, id) => { markUnread([id]); backDetail() }), icon: Mail },
    { id: "inbox:read", name: "Mark inbox events read", when: () => getEvents().unread > 0, run: () => markRead(), icon: CheckCheck },
  ],
  mock,
  preview: () => <Preview />,
})
