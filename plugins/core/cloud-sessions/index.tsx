import { useEffect, useSyncExternalStore } from "react"
import { Cloud, Send } from "lucide-react"
import { activeFile, choose, currentFile, definePlugin, devicePref, isViewOpen, offerPanel, openView, panelSide, notify, notifyError, Panel, readFile, splitFm, stem, type CloudAccount } from "@vaultite"
import { getCloud, hasCloud, newSession, openSession, settings, shownAccounts, subscribeCloud } from "./cloud"
import { CloudList, CloudPanel, CloudView } from "./CloudPanel"

const isNote = (p: string) => /\.md$/i.test(p) && !p.startsWith(".")
const here = () => { const f = currentFile() || activeFile()?.path || ""; return isNote(f) ? f : "" }
const reading = () => hasCloud() && settings.get().read === true
const PANEL = "cloud-sessions:cloud"

/** The account to start in: the one shown, else the user's pick in the palette (null: dismissed). */
function pickAccount(then: (a: CloudAccount | undefined) => void) {
  const s = getCloud(), shown = shownAccounts(s, settings.get().hidden)
  if (shown.length <= 1) return then(shown[0])
  choose({ title: "New cloud session", placeholder: "Which account?", items: shown.map((a) => ({ id: a.id, label: a.label, icon: Cloud })),
    onPick: (it) => then(shown.find((a) => a.id === it.id)) })
}

// (claude.ai takes the prompt in its address: a long note is cut to fit what its servers take)
const MAX_PROMPT = 6000
/** A new session on claude.ai with a note as its prompt, waiting in the box: the user picks the repository and sends. */
async function sendNote(path: string) {
  try {
    const { body } = splitFm((await readFile(path)).text)
    let prompt = `# ${stem(path)}\n\n${body.trim()}`
    if (prompt.length > MAX_PROMPT) { prompt = prompt.slice(0, MAX_PROMPT); notify("The note was cut to fit claude.ai's prompt box") }
    pickAccount((a) => newSession(a, prompt))
  } catch (e) { notifyError(e, "Couldn't read the note") }
}

// The panel offered once (a sidebar setup saved before it existed doesn't list it), beside Terminals, when it first
// has something to show; hidden after, it stays hidden.
const offered = devicePref<boolean>("cloud-sessions:offered", false)
function Watch() {
  const s = useSyncExternalStore(subscribeCloud, getCloud)
  const read = settings.use().read
  useEffect(() => {
    if (!s.signedIn || read === false || offered.get()) return
    offered.set(true)
    if (!panelSide(PANEL)) offerPanel(PANEL, panelSide("terminal:sessions") ?? "left")
  }, [s.signedIn, read])
  return null
}

function Preview() {
  return (
    <Panel title="Cloud sessions" icon={Cloud} tint="var(--orange)">
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Claude Code on the web's sessions in the sidebar, live: a dot while one works, bold when it waits for you, and the
        Inbox tells you when one finishes or needs you. Every claude.ai account the Browser is signed in to shows, each
        under its name, and a click opens a session in the logins it belongs to, from any workspace. Start a new one with
        +, or send a note as a new session's prompt.
      </p>
    </Panel>
  )
}

export default definePlugin({
  // (asked from the start, sidebar shown or not: the sessions' news reaches the Inbox as `session` events)
  background: () => <Watch />,
  // The panel as a tab (drag its heading onto a pane, or the command).
  views: { cloud: { icon: Cloud, title: () => "Cloud sessions", render: () => <CloudView /> } },
  sidebar: { cloud: { title: "Cloud", names: ["cloud", "cloud sessions", "claude code on the web"], heading: false, sort: 31, view: "cloud", render: (ctx) => <CloudPanel {...ctx} /> } },
  newTab: { cloud: { title: "Cloud sessions", sort: 6, hidden: true, render: () => <CloudList /> } },
  commands: [
    { id: "cloud-sessions:new", name: "New cloud session", when: reading, icon: Cloud, run: () => pickAccount((a) => newSession(a)) },
    { id: "cloud-sessions:open-list", name: "Open cloud sessions in a tab", when: hasCloud, icon: Cloud, run: () => openView("view:cloud", { newTab: !isViewOpen("view:cloud") }) },
    { id: "cloud-sessions:send-note", name: "Send note to a new cloud session", when: () => reading() && !!here(), icon: Send, run: () => void sendNote(here()) },
  ],
  fileMenu: (path) => (isNote(path) && reading() ? [{ label: "Send to a new cloud session", icon: Send, section: "actions", run: () => void sendNote(path) }] : []),
  // Every session in the quick switcher and the search tab, by its title and account; picking one opens it.
  searchLive: {
    subscribe: subscribeCloud,
    docs: () => {
      const s = getCloud()
      return s.sessions.map((c) => {
        const account = s.accounts.find((a) => a.id === c.account)
        const state = c.state === "running" ? "Working" : c.state === "waiting" ? "Waiting for you" : "Idle"
        return { id: `cloud-${c.id}`, title: c.title, kind: "Cloud session", icon: Cloud, tint: "var(--orange)", meta: [account?.label, state].filter(Boolean).join(" · "),
          run: (newTab: boolean) => openSession(c, newTab), text: account?.label ?? "", recent: c.updated, weight: 6 }
      })
    },
  },
  preview: () => <Preview />,
})

