// app.version: what this server runs and what its updates (core/selfupdate.ts, or the desktop app's) are doing; given a
// commit, whether it's live, waiting for it when asked. Another machine's through this one.
import { type Machine, MACHINE_CLIENT } from "../plugins.ts"
import { defineOp, type Op, OpError, type OpCtx, restarting } from "../ops.ts"
import { desktopCall, inDesktop } from "../desktopapp.ts"
import { z } from "zod"
import { AppUpdates, isHere, type Process, Relayed, type UpdateStatus, type Verdict, type Version } from "../contracts/version.ts"
import { ambiguousCommit, contains, isHash, type PartRuns, processes, resolveCommit, type Running, running, runsOf } from "../running.ts"
import { updateStatus } from "../update/updater.ts"
import { redRoute } from "../update/git.ts"
import { API_VERSION, APP_VERSION } from "../version.ts"

const short = (sha: unknown) => String(sha).slice(0, 7)
type Part = NonNullable<Verdict["behind"]>["part"]
type By = NonNullable<Verdict["behind"]>["by"]
const partOf = (id: string | undefined): Part => (id === "web" || id === "desktop" || id === "helper" ? id : "server")
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** How often a wait looks again (each look is a few git commands). */
const LOOK_MS = 3000

/** Is `given` (`full`: null when this checkout lacks it) live: taken by the updates (`taken`), and each part its change
 *  reaches runs it or after it (`parts`)? `failed`: whether the update that failed has it. */
export function verdict(o: { given: string; full: string | null; parts: PartRuns[]; taken: boolean; failed: boolean; updates: UpdateStatus
  app: AppUpdates | "unknown" | null }): Verdict {
  const { updates: u, app } = o, name = o.full ? short(o.full) : o.given, commit = o.full ?? o.given
  const lagging = o.parts.filter((p) => p.runs === "older" || p.runs === "unknown")
  const said = (p: PartRuns) => p.label.replace(/^\w/, (c) => c.toLowerCase())
  if (o.full && o.taken && !lagging.length) {
    const how = o.parts.map((p) => `${said(p)} runs ${p.commit === o.full ? "it" : `${short(p.commit)}, which ${p.runs === "it" ? "has it" : "it doesn't change"}`}`)
    return { commit, live: true, final: true, outcome: "live", why: `${name} is live here: ${how.join("; ")}` }
  }
  const not = (final: boolean, why: string): Verdict => ({ commit, live: false, final, outcome: final ? "never" : "pending", why: `${name} ${final ? "won't be live here" : "isn't live here yet"}: ${why}` })
  const behind = (v: Verdict, part: Part, by: By): Verdict => ({ ...v, behind: { part, by } })
  const fromApp = (pre = "", part: Part = "desktop") => {
    if (!app) return behind(not(true, `${pre}this server doesn't update itself (not a service install following a branch, nor in the desktop app)`), part, "never")
    if (app === "unknown") return not(true, `${pre}the desktop app runs it and didn't say how it updates (an older app)`)
    if (!app.available || app.mode === "off") return behind(not(true, `${pre}the desktop app's updates are off`), part, "never")
    if (app.mode === "notify") return behind(not(true, `${pre}the desktop app ${app.ready ? `has ${short(app.ready)} ready` : "offers updates"}: it runs once someone restarts the app`), part, "restart")
    return behind(not(false, `${pre}the desktop app updates by itself${app.doing ? `: ${app.doing}` : app.ready ? `: ${short(app.ready)} ready, restarting when nobody's using it` : ""}`), part, "itself")
  }
  // (only the desktop app's own processes behind: theirs are the desktop app's updates, even beside a service's)
  const app_ = lagging.filter((p) => p.id === "desktop" || p.id === "helper")
  if (o.full && o.taken && app_.length === lagging.length) {
    const p = app_[0]
    return fromApp(`${said(p)} ${p.runs === "older" ? `runs ${short(p.commit)}, before it, and it changes ${p.file}` : `may not run it (${p.why})`}; `, p.id === "helper" ? "helper" : "desktop")
  }
  if (u.branch) {
    // (what an agent left in the checkout doesn't go away by itself; before it has the commit, the next look decides)
    if (u.blocked && (o.full || u.blocked.by === "branch")) return not(true, `its checkout blocks the updates: ${u.why}`)
    if (u.state === "failed" && o.failed) return not(true, `its update failed: ${u.error?.message ?? u.why}`)
    const red = o.full && u.state === "waiting" && u.ci ? redRoute(u.ci, o.full) : null
    if (red) return { ...not(true, `CI failed on ${red === o.full ? "it" : `${short(red)}, the newest commit with it, and passed on none between`}: it goes live with a fix CI passes`), red }
    if (!o.full) return behind(not(false, `this checkout doesn't have it yet (it fetches ${u.branch} each time its updates look: ${u.state}, ${u.why})`), "server", "itself")
    const older = lagging.find((p) => p.runs === "older" && o.taken)
    return behind(not(false, `updates ${u.state}: ${u.why}${older ? ` (${said(older)} runs ${short(older.commit)}, before it, and it changes ${older.file})` : ""}`), partOf(older?.id), "itself")
  }
  return fromApp()
}

/** The parts a commit may reach here: this server's code (the commit it started on), the web app it serves, and the
 *  desktop app's processes when there's one. */
const partsOf = (now: Running, app: AppUpdates | "unknown" | null) =>
  [{ id: "server", commit: now.startedOn }, { id: "web", commit: now.web.commit ?? now.startedOn }, ...processList(now.startedOn, app).slice(1)]

/** Whether `given` is live here now. */
async function look(given: string): Promise<Verdict> {
  const [full, now, u, app] = await Promise.all([resolveCommit(given), running(), updateStatus(), appUpdates()])
  if (!full) return verdict({ given, full, parts: [], taken: false, failed: false, updates: u, app })
  // (the commit the updates run: a web-only update moves it too)
  const took = u.running ?? (app && app !== "unknown" ? app.store?.running : undefined)
  const [parts, taken, failed] = await Promise.all([runsOf(full, partsOf(now, app)), took ? contains(took, full) : false,
    u.error?.commit ? contains(u.error.commit, full) : false])
  return verdict({ given, full, parts, taken: !!taken || parts.some((p) => p.runs === "it"), failed: !!failed, updates: u, app })
}

/** Wait (`timeout` s at most) till it's live, or can't be by itself; `before`, the seconds a wait this one goes on
 *  from already took (vau sends it again when the server's restart cut it). */
export async function waitFor(given: string, timeout: number, before = 0, lookNow: (given: string) => Promise<Verdict> = look): Promise<Verdict> {
  const began = Date.now()
  for (;;) {
    const v = await lookNow(given), now = Math.round((Date.now() - began) / 1000), waited = before + now
    if (v.live || v.final) return { ...v, waited }
    if (now >= timeout) return { ...v, outcome: "timeout", waited, why: v.why.replace(/ isn't live here yet: /, ` still isn't live here after ${waited} s of waiting (timed out): `) }
    await sleep(Math.min(LOOK_MS, (timeout - now) * 1000))
  }
}


const Refusal = z.object({ error: z.string() })

/** Another machine's answer to app.version, through this server; a wait outlasts its restarts (an update's). */
type Asked = { commit?: string; wait?: true; timeout?: number; waited?: number }
async function elsewhere(ctx: OpCtx, id: string, body: Asked): Promise<Version | null> {
  if (ctx.who.client?.startsWith("machine/")) throw new OpError("a call passed on from another machine runs where it's sent", 409)
  const all = await ctx.api("GET", "machines").catch(() => []) as Machine[]
  const m = all.find((x) => x.id === id)
  if (!m) throw new OpError(`no machine '${id}' (\`machine\`: Machines lists them)`, 404)
  if (m.self) return null
  if (!m.url) throw new OpError(`${m.label} doesn't run Vaultite's server, only lets its files be read (\`machine\`)`, 409)
  const began = Date.now(), before = Number(body.waited ?? 0), timeout = Number(body.timeout ?? 900)
  let down: number | null = null, said = ""
  for (;;) {
    const spent = Math.round((Date.now() - began) / 1000), left = Math.max(0, timeout - spent)
    const r = await fetch(`${m.url}/api/ops/app.version`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify(body.wait ? { ...body, timeout: left, waited: before + spent } : body), signal: AbortSignal.timeout((left + 30) * 1000) }).catch(() => null)
    const out: unknown = r ? await r.json().catch(() => null) : null
    if (r && !restarting(r.status, out)) {
      if (!r.ok) throw new OpError(`${m.label} refused it: ${Refusal.safeParse(out).data?.error || `it answered ${r.status}`}`, r.status)
      const v = Relayed.omit({ machine: true }).safeParse(out)
      if (!v.success) throw new OpError(`${m.label} answered something that isn't its version: ${v.error.issues[0]?.message}`, 502)
      return { ...v.data, machine: m.id }
    }
    // (restarting into an update, most likely: asked again till the wait's time is up)
    down ??= Date.now()
    said = r ? `answered ${r.status} (its proxy: the server behind it is down)` : "didn't answer"
    if (!body.wait || Date.now() + 5000 > began + timeout * 1000) {
      const why = `${m.label} ${said} for ${Math.round((Date.now() - down) / 1000)} s${body.wait ? `, till the wait's ${timeout} s were up` : ""}`
      if (!body.commit) throw new OpError(why, 502)
      return { machine: m.id, live: { commit: body.commit, live: false, final: false, outcome: "unreachable", waited: before + Math.round((Date.now() - began) / 1000),
        why: `${short(body.commit)}: can't tell if it's live on ${m.label}: ${why}` } }
    }
    await sleep(5000)
  }
}

export function versionOps(): Op[] {
  return [defineOp({
    id: "app.version",
    cli: "version",
    summary: "What this server runs: Vaultite's version, the plugin API's, its commit and branch, and its updates' state.",
    help: `commit: the commit it runs (a web-only update's too: it runs without a restart), its subject and date.
updates: a service install following a branch (vau service install --updates main) updates itself: its state
(current, waiting and why, updating, failed), when it last looked, the last update and a failed one (in vau errors too).
app: the desktop app this server runs in or is attached to updates itself (and its server) in its mode: automatic,
notify (the default: offers Restart to update) or off (only from its menu); ready is a build waiting for a restart.
processes: this server, and the desktop app (and its menu-bar helper) when there's one: the commit each started on, and
whether a file it runs (its imports, followed: core/update/closure.ts) changed since in this checkout (stale), the first
such file and how it's reached. In a checkout only.

Is my commit live? Give it (a hash, short or full; in a checkout of the app, HEAD or a branch too): live says whether
its updates took it and every part its change reaches (the server, the web app, the desktop app) runs it or a commit
after it (a web-only commit needs no restart), and why not. With wait it waits until it is, or until the updates say why it
won't be (a failed update, CI red on it, updates off, a checkout with uncommitted changes, commits not on the branch
or another branch checked out: it names them), timeout seconds at most: no loop of your own needed. A restart
meanwhile (an update's) is ridden out, the time spent counted once. The last line is the verdict (live: outcome live,
never, timeout, or unreachable when the server stayed down), and the exit is 1 unless it's live. A branch's commits land on main squashed: give main's (git log origin/main). Open pages take a
new build by themselves (at once when hidden; visible, they offer Reload). machine: another machine's (Machines).

  vau version
  vau version 1a2b3c4
  vau version 1a2b3c4 --wait --timeout 1200
  vau version HEAD --wait --machine studio`,
    kind: "read",
    params: {
      commit: { type: "string", description: "a commit's hash, short or full (vau turns HEAD or a branch into one where it runs): whether it's live here (taken, and each part it changes runs it or after it)" },
      wait: { type: "boolean", description: "with commit: wait until it's live, or until the updates say why it won't be" },
      timeout: { type: "number", minimum: 0, maximum: 3600, default: 900, description: "with wait: seconds to wait at most" },
      waited: { type: "number", minimum: 0, default: 0, description: "with wait: seconds it already waited before this call (vau sends a wait again when the server's restart cut it)" },
      machine: { type: "string", description: "another of the Machines, by its id (studio): its version, asked through this server" },
    },
    args: ["commit"],
    run: async ({ commit, wait, timeout, waited, machine }, ctx): Promise<Version> => {
      const given = typeof commit === "string" ? commit.trim() : ""
      if (wait && !given) throw new OpError("wait for which commit? give it (`commit`)")
      // (an older vau sends HEAD or a branch as typed: this server would read it in its own checkout)
      if (given && !isHash(given)) throw new OpError(`\`commit\` is a commit's hash, full or short, not a name like ${given}: names are read where you are, so give its hash (git rev-parse ${given}), or use a current vau, which does`)
      if (given && !machine && await ambiguousCommit(given)) throw new OpError(`\`commit\` ${given} names more than one commit here: give more of its hash`)
      if (machine) {
        const there = await elsewhere(ctx, String(machine), { ...(given ? { commit: given } : {}), ...(wait ? { wait: true, timeout, waited } : {}) })
        if (there) return there
      }
      const live = given ? (wait ? await waitFor(given, Number(timeout ?? 900), Number(waited ?? 0)) : await look(given)) : undefined
      const { startedOn, ...now } = await running(), app = await appUpdates()
      return { ...(live ? { live } : {}), version: APP_VERSION, api: API_VERSION, ...now, pid: process.pid, started: Date.now() - Math.round(process.uptime() * 1000),
        updates: updateStatus(), app, processes: await processes(processList(startedOn, app)) }
    },
    // (the verdict last: an agent's output cut to its end, or its exit code lost to a pipe, still says it)
    text: (r) => !isHere(r) ? r.live?.why ?? "" : [
      `Vaultite ${r.version} (plugin API ${r.api})${r.commit ? `, ${short(r.commit)}${r.branch ? ` on ${r.branch}` : ""}` : ""}${r.machine ? ` on ${r.machine}` : ""}`,
      ...worktreeLine(r.app),
      ...(r.subject ? [`Commit: ${r.subject}${r.at ? ` (${new Date(r.at).toISOString()})` : ""}`] : []),
      // (out of step: a checkout pulled and built but not restarted, or restarted but not built)
      ...(r.web?.commit && r.commit && r.web.commit !== r.commit ? [`Web app: built from ${short(r.web.commit)}, not ${short(r.commit)}`] : []),
      ...(r.processes ?? []).map(processLine),
      `Updates: ${updatesLine(r.updates, r.app)}`,
      ...(r.updates.last ? [`Last update: ${short(r.updates.last.from)} to ${short(r.updates.last.to)}, ${new Date(r.updates.last.at).toISOString()}${r.updates.last.elsewhere?.length ? ` (CI red on it elsewhere: ${r.updates.last.elsewhere.join(", ")})` : ""}`] : []),
      ...(r.updates.error ? [`Failed: ${r.updates.error.message}`] : []),
      ...(r.live ? [r.live.why] : [])].join("\n"),
  })]
}

/** The processes this server knows the commits of: itself (the one it started on), and the desktop app it's in or
 *  attached to, with its menu-bar helper on a Mac (the app says its commit; the keepers don't say theirs). */
export const processList = (startedOn: string | null, app: AppUpdates | "unknown" | null) => [{ id: "server", commit: startedOn },
  ...(app && app !== "unknown" ? [{ id: "desktop", commit: app.commit ?? null }, ...((app.helper ?? process.platform === "darwin") ? [{ id: "helper", commit: app.helperCommit ?? app.commit ?? null }] : [])] : [])]

const worktreeLine = (app: AppUpdates | "unknown" | null) => {
  const w = app && app !== "unknown" ? app.worktree : undefined
  return w ? [`Worktree: ${w.worktree}, ${w.branch}@${short(w.commit)}${w.dirty ? ", with changes not committed" : ""}`] : []
}

/** A process's line: its commit, and whether what it runs changed since. */
const processLine = (p: Process) => `${p.label}: ${p.commit ? `started on ${short(p.commit)}` : "commit unknown"}, ${p.stale === null ? `can't say if it runs the newest code (${p.why})`
  : p.stale ? `runs older code: ${p.first} changed since${p.why ? ` (${p.why})` : p.chain && p.chain.length > 1 ? ` (${p.chain.join(" > ")})` : ""}` : "nothing it runs changed since"}`

/** The desktop app's updates, when it runs this server or is attached to it (null: none; unknown: it didn't say). */
const appUpdates = (): Promise<AppUpdates | "unknown" | null> => !inDesktop() ? Promise.resolve(null)
  : desktopCall("app:updates", [], 5000).then((a) => { const r = AppUpdates.safeParse(a); return r.success ? r.data : "unknown" }, () => "unknown" as const)

function updatesLine(u: UpdateStatus, app: AppUpdates | "unknown" | null) {
  if (u.branch) return `following ${u.branch}, ${u.state}: ${u.why}`
  if (!app) return "off (not a service install following a branch, nor in the desktop app)"
  if (app === "unknown") return "the desktop app's, which didn't say how they are (an older app)"
  if (!app.available) return "off (this desktop app's build doesn't update itself)"
  if (app.mode === "off") return "off in the desktop app (it looks only when asked, from its menu)"
  const ready = app.ready ? `: ${app.ready.slice(0, 7)} ready, ${app.how === "relaunch" ? "relaunch to run it (a couple of seconds)" : "restart to update"}` : ""
  const store = app.store ? `; through its code store: ${app.store.state}, ${app.store.why}` : ""
  const root = app.root?.fellBack ? `; it fell back from ${app.root.fellBack.commit?.slice(0, 7) ?? "a root"} (${app.root.fellBack.why})` : ""
  return `by the desktop app, ${app.mode}, from ${app.from}${app.doing ? `: ${app.doing}` : ready}${store}${root}`
}
