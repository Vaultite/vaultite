import { useEffect, useSyncExternalStore } from "react"
import { Cloud, Send } from "lucide-react"
import { activeFile, choose, currentFile, definePlugin, devicePref, isViewOpen, offerPanel, openView, panelSide, notify, notifyError, readFile, splitFm, stem, type CloudAccount } from "@vaultite"
import { getCloud, hasCloud, newSession, openSession, pickedNow, pickedOf, repoOf, settings, shownAccounts, STATUS, statusOf, subscribeCloud } from "./cloud"
import { CloudList, CloudPanel } from "./CloudPanel"
import { CloudView } from "./CloudPage"
import { useCloudRuns } from "./runs"

const isNote = (p: string) => /\.md$/i.test(p) && !p.startsWith(".")
const here = () => { const f = currentFile() || activeFile()?.path || ""; return isNote(f) ? f : "" }
const reading = () => hasCloud() && settings.get().read === true
const PANEL = "cloud-sessions:cloud"

function pickAccount(then: (a: CloudAccount | undefined) => void) {
  const s = getCloud(), shown = shownAccounts(s, settings.get().hidden), picked = pickedOf(shown, pickedNow().get())
  if (picked || shown.length <= 1) return then(picked ?? shown[0])
  choose({ title: "New cloud session", placeholder: "Which account?", items: shown.map((a) => ({ id: a.id, label: a.label, icon: Cloud })),
    onPick: (it) => then(shown.find((a) => a.id === it.id)) })
}

// claude.ai takes the prompt in its address: no longer than its servers take
const MAX_PROMPT = 6000
async function sendNote(path: string) {
  try {
    const { body } = splitFm((await readFile(path)).text)
    let prompt = `# ${stem(path)}\n\n${body.trim()}`
    if (prompt.length > MAX_PROMPT) { prompt = prompt.slice(0, MAX_PROMPT); notify("The note was cut to fit claude.ai's prompt box") }
    pickAccount((a) => newSession(a, prompt))
  } catch (e) { notifyError(e, "Couldn't read the note") }
}

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


export default definePlugin({
  background: () => <Watch />,
  views: { cloud: { icon: Cloud, title: () => "Cloud sessions", render: () => <CloudView /> } },
  sidebar: { cloud: { title: "Cloud", names: ["cloud", "cloud sessions", "claude code on the web"], heading: false, needsHeading: true, sort: 31, view: "cloud", render: (ctx) => <CloudPanel {...ctx} /> } },
  newTab: { cloud: { title: "Cloud sessions", sort: 6, hidden: true, render: () => <CloudList /> } },
  commands: [
    { id: "cloud-sessions:new", name: "New cloud session", when: reading, icon: Cloud, run: () => pickAccount((a) => newSession(a)) },
    { id: "cloud-sessions:open-list", name: "Open cloud sessions in a tab", when: hasCloud, icon: Cloud, run: () => openView("view:cloud", { newTab: !isViewOpen("view:cloud") }) },
    { id: "cloud-sessions:send-note", name: "Send note to a new cloud session", when: () => reading() && !!here(), icon: Send, run: () => void sendNote(here()) },
  ],
  fileMenu: (path) => (isNote(path) && reading() ? [{ label: "Send to a new cloud session", icon: Send, section: "actions", run: () => void sendNote(path) }] : []),
  searchLive: {
    subscribe: subscribeCloud,
    docs: () => {
      const s = getCloud()
      return s.sessions.map((c) => {
        const account = s.accounts.find((a) => a.id === c.account), r = repoOf(c)
        return { id: `cloud-${c.id}`, title: c.title, kind: "Cloud session", icon: Cloud, tint: "var(--orange)",
          meta: [account?.label, r && r.repo.split("/").pop(), STATUS[statusOf(c)]].filter(Boolean).join(" · "),
          run: (newTab: boolean) => openSession(c, newTab), text: [account?.label, ...(c.repos ?? []).flatMap((x) => [x.repo, x.branch]), c.summary].filter(Boolean).join(" "),
          recent: c.updated, weight: 6 }
      })
    },
  },
  agentRuns: useCloudRuns,
})

