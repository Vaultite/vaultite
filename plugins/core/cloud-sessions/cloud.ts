// Claude Code on the web's sessions, read by the desktop app with the Browser's logins (electron/cloud.ts): one state for
// the app, asked again when the profiles, the user's yes or the hidden accounts change. None but in the desktop app.
import { askText, get, isViewOpen, notify, notifyError, op, openView, pluginSettings, removals, scopedState, subscribeScoped, webPages, workspaceList, workspaces,
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

/** The account the panel and the tab show, per workspace (null: all of them). */
export const PICKED = "cloud-sessions:account"
export const pickedNow = () => scopedState<string | null>(PICKED, null)
/** The account picked, if it's still one shown; else all of them. */
export const pickedOf = (shown: CloudAccount[], id: string | null | undefined) => shown.find((a) => a.id === id)

// ---------- where a session stands

/** It waits for you: a permission or a question while it runs, or a question it ended its turn on in the last three
 *  days (an older one was left, not waited on). */
export const needsYou = (c: CloudSession) => c.state === "waiting" || (c.state === "idle" && c.outcome === "input" && Date.now() - c.updated < 3 * 86_400_000)
export type Status = "needs" | "working" | "review" | "done"
export const statusOf = (c: CloudSession): Status => (needsYou(c) ? "needs" : c.state === "running" ? "working"
  : c.outcome === "review" && Date.now() - c.updated < 7 * 86_400_000 ? "review" : "done")
export const STATUS: Record<Status, string> = { needs: "Needs you", working: "Working", review: "Ready for review", done: "Idle" }
/** A session's dot: working, waiting on you, or an answer you haven't read. */
export const badgeOf = (c: CloudSession) => (c.state === "running" ? "working" as const : needsYou(c) ? "ask" as const : c.unread ? "unread" as const : undefined)

/** The ones a list shows: needing you, working, then idle ones touched in the last two days, at most ten; `older`: the
 *  rest, behind Show older. */
export const cloudListed = (list: CloudSession[]) => {
  const rank = { needs: 0, working: 1, review: 2, done: 2 }
  const recent = (c: CloudSession) => statusOf(c) !== "done" || Date.now() - c.updated < 2 * 86_400_000
  const sorted = [...list].sort((a, b) => Number(!recent(a)) - Number(!recent(b)) || rank[statusOf(a)] - rank[statusOf(b)] || b.updated - a.updated)
  const n = Math.min(10, sorted.filter(recent).length)
  return { listed: sorted.slice(0, n), older: sorted.slice(n) }
}

/** Its first repository and branch, for its row. */
export const repoOf = (c: CloudSession) => c.repos?.find((r) => r.branch) ?? c.repos?.[0]
export const repoName = (repo: string) => repo.split("/").pop() ?? repo
export const github = (repo: string, rest = "") => `https://github.com/${repo}${rest}`
/** Where its work is on GitHub: its pull request, else its branch's diff with a pull request to open. */
export const diffUrl = (c: CloudSession) => {
  const r = repoOf(c)
  return c.pr?.url ?? (r?.branch ? github(r.repo, `/compare/${encodeURIComponent(r.branch).replace(/%2F/g, "/")}?expand=1`) : null)
}

// ---------- opening one

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
/** A page of GitHub's, in this workspace's logins. */
export const openGitHub = (url: string) => openIn(url, [], { newTab: true })

/** claude.ai's new session page; `prompt` waits in its box, for the user to pick the repository and send. */
export const newSessionUrl = (base: string, prompt?: string) => `${base}/code${prompt ? `?q=${encodeURIComponent(prompt)}` : ""}`
export const newSession = (a: CloudAccount | undefined, prompt?: string) => openIn(newSessionUrl(now.base ?? "https://claude.ai", prompt), a?.profiles ?? [], { newTab: true })

// ---------- what's done to one: archived (with Undo), renamed, continued here

/** Sessions on their way to the archive: their rows fold away at once. */
export const leaving = removals()
export const canAct = () => !!webPages?.cloudAct

export async function archive(c: CloudSession) {
  const act = webPages?.cloudAct
  if (!act) return
  const ok = await leaving.remove(c.id, () => act("archive", c.id), "Couldn't archive it")
  if (ok) notify(`Archived “${c.title}”`, { action: { label: "Undo", run: () => void unarchive(c) } })
}
async function unarchive(c: CloudSession) {
  leaving.back([c.id])
  try { await webPages!.cloudAct!("unarchive", c.id, { account: c.account ?? "" }) } catch (e) { notifyError(e, "Couldn't bring it back") }
}

export function rename(c: CloudSession) {
  const act = webPages?.cloudAct
  if (!act) return
  askText({ title: "Rename session", placeholder: "Its name", typed: c.title, hint: "Its name on claude.ai too",
    label: (t) => `Rename to “${t}”`,
    onText: (t) => { if (t !== c.title) void act("rename", c.id, t).catch((e) => notifyError(e, "Couldn't rename it")) } })
}

/** Which claude.ai organizations a Claude Code account here is signed in to (its sessions can be continued here),
 *  asked of the server once a minute at most. */
let orgs: { at: number; list: Promise<string[]> } | null = null
export function teleportable(): Promise<string[]> {
  if (!orgs || Date.now() - orgs.at > 60_000) {
    orgs = { at: Date.now(), list: get<{ account: string; org: string }[]>("claude-code/organizations").then((l) => l.map((x) => x.org), () => []) }
  }
  return orgs.list
}

/** Continue it here: `claude --teleport` in a terminal tab, in a worktree of its repository. */
export async function teleport(c: CloudSession) {
  const r = repoOf(c)
  try {
    await op("claude-code.teleport", { session: c.id, ...(c.account ? { org: c.account } : {}), ...(r ? { repo: r.repo } : {}), ...(r?.branch ? { branch: r.branch } : {}), title: c.title })
  } catch (e) { notifyError(e, "Couldn't continue it here") }
}
