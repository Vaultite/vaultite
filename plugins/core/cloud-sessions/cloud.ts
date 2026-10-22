// Claude Code on the web's sessions, read by the desktop app with the Browser's logins (electron/web.ts): one state for
// the app, asked again when the profiles, the user's yes or the hidden accounts change. None but in the desktop app.
import { isViewOpen, notify, openView, pluginSettings, subscribeScoped, webPages, workspaceList, workspaces,
  type CloudAccount, type CloudSession, type CloudState } from "@vaultite"
import { argOf, containerById, containerOfProfile, containers, profileIn } from "@plugins/web-viewer/containers"
import { profileFor, settings as browser, settingsRead } from "@plugins/web-viewer/state"

export type Settings = {
  /** The user's yes to reading their sessions (unset: asked, once some profile is signed in to claude.ai). */
  read?: boolean
  /** Accounts not shown nor read, by label (a login's email, a team's name). */
  hidden?: string[]
}
export const settings = pluginSettings<Settings>("cloud-sessions")

const NONE: CloudState = { signedIn: false, accounts: [], sessions: [] }
let now = NONE
const listeners = new Set<() => void>()
const put = (s: CloudState) => { now = s; listeners.forEach((f) => f()) }
// (builds from before accounts answer and tell only the sessions)
const stateOf = (x: Partial<CloudState> & { sessions: CloudSession[] }): CloudState =>
  ({ signedIn: x.signedIn ?? x.sessions.length > 0, accounts: x.accounts ?? [], sessions: x.sessions, base: x.base })

/** Every profile a page can have: the first workspace's (everyone's, with shared logins), each other workspace's,
 *  each container's. */
function profiles() {
  const ns = [1, ...workspaceList().map((w) => w.n)]
  return [...new Set([...ns.map(profileFor), ...containers().map((c) => profileIn(c.id))])]
}

let asked = ""
function ask() {
  const s = settings.get()
  const want = { profiles: profiles(), read: s.read === true, hidden: s.hidden ?? [] }
  const key = JSON.stringify(want)
  if (key === asked) return
  asked = key
  void webPages!.cloud!(want).then((x) => put(stateOf(Array.isArray(x) ? { sessions: x } : x)), () => { asked = "" })
}

let started = false
export function subscribeCloud(fn: () => void) {
  listeners.add(fn)
  if (!started && webPages?.cloud) {
    started = true
    webPages.on((m) => { if (m.type === "cloud") put(stateOf(m)) })
    // (the profiles depend on the Browser's settings: asked once they're read)
    void Promise.all([settings.ready(), settingsRead()]).then(() => {
      ask()
      settings.onChange(ask)
      browser.onChange(ask)
      subscribeScoped(ask)
    })
  }
  return () => { listeners.delete(fn) }
}
export const getCloud = () => now
export const hasCloud = () => !!webPages?.cloud

/** The accounts shown: every one read, but the hidden ones. */
export const shownAccounts = (s: CloudState, hidden: string[] | undefined) => s.accounts.filter((a) => !hidden?.includes(a.label))
export const accountOf = (s: CloudState, c: CloudSession) => s.accounts.find((a) => a.id === c.account)

export function setHidden(label: string, hide: boolean) {
  const was = settings.get().hidden ?? []
  return settings.set({ hidden: hide ? [...new Set([...was, label])] : was.filter((l) => l !== label) })
}

/** The ones a list shows: waiting on you, working, then idle ones touched in the last two days, at most ten; `older`:
 *  the rest, behind Show older. */
export const cloudListed = (list: CloudSession[]) => {
  const rank = { waiting: 0, running: 1, idle: 2 }
  const recent = (c: CloudSession) => c.state !== "idle" || Date.now() - c.updated < 2 * 86_400_000
  const sorted = [...list].sort((a, b) => Number(!recent(a)) - Number(!recent(b)) || rank[a.state] - rank[b.state] || b.updated - a.updated)
  const n = Math.min(10, sorted.filter(recent).length)
  return { listed: sorted.slice(0, n), older: sorted.slice(n) }
}

/** Open `url` (claude.ai) in logins among `among`: this workspace's when it's one of them, else a container's (from
 *  anywhere), else another workspace's, switched to. */
export function openIn(url: string, among: string[], opts: { newTab?: boolean } = {}) {
  const here = profileIn(null)
  const container = among.map(containerOfProfile).find((c) => !!containerById(c))
  let to: string
  if (!among.length || among.includes(here)) to = `view:web/${url}`
  else if (container) to = `view:web/${argOf(url, container)}`
  else {
    const n = workspaceList().find((w) => among.includes(profileFor(w.n)))?.n ?? (among.includes("") ? 1 : null)
    if (n === null) { notify("Couldn't find the logins that session is in"); return }
    workspaces()?.switchTo(n)
    to = `view:web/${url}`
  }
  openView(to, { newTab: opts.newTab || !isViewOpen(to) })
}

/** A session's page, in its account's logins. */
export const openSession = (c: CloudSession, newTab?: boolean) => openIn(c.url, accountOf(now, c)?.profiles ?? [c.profile], { newTab })

/** claude.ai's new session page; `prompt` waits in its box, for the user to pick the repository and send. */
export const newSessionUrl = (base: string, prompt?: string) => `${base}/code${prompt ? `?q=${encodeURIComponent(prompt)}` : ""}`
export const newSession = (a: CloudAccount | undefined, prompt?: string) => openIn(newSessionUrl(now.base ?? "https://claude.ai", prompt), a?.profiles ?? [], { newTab: true })
