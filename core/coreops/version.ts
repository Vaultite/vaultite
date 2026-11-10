// app.version: what this server runs and what its updates (core/selfupdate.ts, or the desktop app's) are doing; given a
// commit, whether it's live, waiting for it when asked. Another machine's through this one.
import { type Machine, MACHINE_CLIENT } from "../plugins.ts"
import { type Op, OpError, type OpCtx } from "../ops.ts"
import { desktopCall, inDesktop } from "../desktopapp.ts"
import { contains, resolveCommit, running } from "../running.ts"
import { type UpdateStatus, updateStatus } from "../update/updater.ts"
import { API_VERSION, APP_VERSION } from "../version.ts"
import type { Any } from "./common.ts"

const short = (sha: unknown) => String(sha).slice(0, 7)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** How often a wait looks again (each look is a few git commands). */
const LOOK_MS = 3000

type AppUpdates = { mode: "automatic" | "notify" | "off"; available: boolean; from: string; ready: string | null; doing: string | null; commit?: string | null }
/** Whether a commit is live, and when not, whether that can still change by itself (`final`: it can't). */
export type Verdict = { commit: string; live: boolean; final: boolean; why: string }

/** Is `given` (`full` in full: null when this checkout doesn't have it) live in `runs`? `has`: whether `runs` has it
 *  (null: git can't say), `failed`: whether the update that failed has it. */
export function verdict(o: { given: string; full: string | null; runs: string | null; has: boolean | null; failed: boolean; updates: UpdateStatus
  app: AppUpdates | "unknown" | null }): Verdict {
  const { updates: u, app } = o, name = o.full ? short(o.full) : o.given, commit = o.full ?? o.given
  if (o.has || (o.runs && o.full === o.runs)) return { commit, live: true, final: true, why: `${name} is live here: it runs ${short(o.runs)}${o.full === o.runs ? "" : ", which has it"}` }
  const not = (final: boolean, why: string) => ({ commit, live: false, final, why: `${name} ${final ? "won't be live here" : "isn't live here yet"}: ${why}` })
  if (u.branch) {
    // (what an agent left in the checkout doesn't go away by itself; before it has the commit, the next look decides)
    if (u.blocked && (o.full || u.blocked.by === "branch")) return not(true, `its checkout blocks the updates: ${u.why}`)
    if (u.state === "failed" && o.failed) return not(true, `its update failed: ${u.error?.message ?? u.why}`)
    if (!o.full) return not(false, `this checkout doesn't have it yet (it fetches ${u.branch} each time its updates look: ${u.state}, ${u.why})`)
    return not(false, `updates ${u.state}: ${u.why}`)
  }
  if (!app) return not(true, "this server doesn't update itself (not a service install following a branch, nor in the desktop app)")
  if (app === "unknown") return not(true, "the desktop app runs it and didn't say how it updates (an older app)")
  if (!app.available || app.mode === "off") return not(true, "the desktop app's updates are off")
  if (app.mode === "notify") return not(true, `the desktop app ${app.ready ? `has ${short(app.ready)} ready` : "offers updates"}: it runs once someone restarts the app`)
  return not(false, `the desktop app updates by itself${app.doing ? `: ${app.doing}` : app.ready ? `: ${short(app.ready)} ready, restarting when nobody's using it` : ""}`)
}

/** Whether `given` is live here now. */
async function look(given: string): Promise<Verdict> {
  const [full, runs, u, app] = await Promise.all([resolveCommit(given), running(), updateStatus(), appUpdates()])
  const has = full && runs.commit ? await contains(runs.commit, full) : null
  const failed = !!full && !!u.error?.commit && !!(await contains(u.error.commit, full))
  return verdict({ given, full, runs: runs.commit, has, failed, updates: u, app })
}

/** Wait (`timeout` s at most) till it's live, or can't be by itself. */
async function waitFor(given: string, timeout: number): Promise<Verdict & { waited: number }> {
  const began = Date.now()
  for (;;) {
    const v = await look(given), waited = Math.round((Date.now() - began) / 1000)
    if (v.live || v.final || waited >= timeout) return { ...v, waited, ...(!v.live && !v.final ? { why: `${v.why} (waited ${waited} s)` } : {}) }
    await sleep(Math.min(LOOK_MS, (timeout - waited) * 1000))
  }
}

/** Another machine's answer to app.version, through this server; a wait outlasts its restarts (an update's). */
async function elsewhere(ctx: OpCtx, id: string, body: Any): Promise<Any> {
  if (ctx.who.client?.startsWith("machine/")) throw new OpError("a call passed on from another machine runs where it's sent", 409)
  const all = await ctx.api("GET", "machines").catch(() => []) as Machine[]
  const m = all.find((x) => x.id === id)
  if (!m) throw new OpError(`no machine '${id}' (\`machine\`: Machines lists them)`, 404)
  if (m.self) return null
  if (!m.url) throw new OpError(`${m.label} doesn't run Vaultite's server, only lets its files be read (\`machine\`)`, 409)
  const until = Date.now() + (body.wait ? Number(body.timeout ?? 900) * 1000 : 0)
  for (;;) {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000))
    const r = await fetch(`${m.url}/api/ops/app.version`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify(body.wait ? { ...body, timeout: left } : body), signal: AbortSignal.timeout((left + 30) * 1000) }).catch(() => null)
    if (r) {
      const out = await r.json().catch(() => ({})) as Any
      if (!r.ok) throw new OpError(`${m.label}: ${out.error || `answered ${r.status}`}`, r.status)
      return { ...out, machine: m.id }
    }
    if (Date.now() + 5000 > until) throw new OpError(`${m.label} doesn't answer`, 502)
    await sleep(5000) // (restarting into an update, most likely)
  }
}

export function versionOps(): Op[] {
  return [{
    id: "app.version",
    cli: "version",
    summary: "What this server runs: Vaultite's version, the plugin API's, its commit and branch, and its updates' state.",
    help: `commit: the commit it runs (a web-only update's too: it runs without a restart), its subject and date.
updates: a service install following a branch (vau service install --updates main) updates itself: its state
(current, waiting and why, updating, failed), when it last looked, the last update and a failed one (in vau errors too).
app: the desktop app this server runs in or is attached to updates itself (and its server) in its mode: automatic,
notify (the default: offers Restart to update) or off (only from its menu); ready is a build waiting for a restart.

Is my commit live? Give it (a hash, short or full; in a checkout of the app, HEAD or a branch too): live says whether
this server runs it or a commit after it, and why not. With wait it waits until it is, or until the updates say why it
won't be (a failed update, updates off, a checkout with uncommitted changes, commits not on the branch or another branch
checked out: it names them), timeout seconds at most: no loop of your own needed. Exit 1 when it isn't
live, with the reason. A branch's commits land on main squashed: give main's (git log origin/main). Open pages take a
new build by themselves (at once when hidden; visible, they offer Reload). machine: another machine's (Machines).

  vau version
  vau version 1a2b3c4
  vau version 1a2b3c4 --wait --timeout 1200
  vau version HEAD --wait --machine studio`,
    kind: "read",
    params: {
      commit: { type: "string", description: "a commit (its hash, short or full): whether it's live here (what this server runs is it, or after it)" },
      wait: { type: "boolean", description: "with commit: wait until it's live, or until the updates say why it won't be" },
      timeout: { type: "number", minimum: 0, maximum: 3600, default: 900, description: "with wait: seconds to wait at most" },
      machine: { type: "string", description: "another of the Machines, by its id (studio): its version, asked through this server" },
    },
    args: ["commit"],
    run: async ({ commit, wait, timeout, machine }, ctx) => {
      const given = typeof commit === "string" ? commit.trim() : ""
      if (wait && !given) throw new OpError("wait for which commit? give it (`commit`)")
      if (machine) {
        const there = await elsewhere(ctx, String(machine), { ...(given ? { commit: given } : {}), ...(wait ? { wait: true, timeout } : {}) })
        if (there) return there
      }
      const live = given ? (wait ? await waitFor(given, Number(timeout ?? 900)) : await look(given)) : undefined
      const { startedOn: _, ...now } = await running()
      return { ...(live ? { live } : {}), version: APP_VERSION, api: API_VERSION, ...now, pid: process.pid, started: Date.now() - Math.round(process.uptime() * 1000),
        updates: updateStatus(), app: await appUpdates() }
    },
    text: (r: Any) => [...(r.live ? [r.live.why] : []),
      `Vaultite ${r.version} (plugin API ${r.api})${r.commit ? `, ${short(r.commit)}${r.branch ? ` on ${r.branch}` : ""}` : ""}${r.machine ? ` on ${r.machine}` : ""}`,
      ...(r.subject ? [`Commit: ${r.subject}${r.at ? ` (${new Date(r.at).toISOString()})` : ""}`] : []),
      // (out of step: a checkout pulled and built but not restarted, or restarted but not built)
      ...(r.web?.commit && r.commit && r.web.commit !== r.commit ? [`Web app: built from ${short(r.web.commit)}, not ${short(r.commit)}`] : []),
      `Updates: ${updatesLine(r.updates, r.app)}`,
      ...(r.updates.last ? [`Last update: ${short(r.updates.last.from)} to ${short(r.updates.last.to)}, ${new Date(r.updates.last.at).toISOString()}`] : []),
      ...(r.updates.error ? [`Failed: ${r.updates.error.message}`] : [])].join("\n"),
  }]
}

/** The desktop app's updates, when it runs this server or is attached to it (null: none; unknown: it didn't say). */
const appUpdates = (): Promise<AppUpdates | "unknown" | null> => !inDesktop() ? Promise.resolve(null)
  : (desktopCall("app:updates", [], 5000) as Promise<AppUpdates | null>).then((a) => a ?? "unknown", () => "unknown" as const)

function updatesLine(u: Any, app: AppUpdates | "unknown" | null) {
  if (u.branch) return `following ${u.branch}, ${u.state}: ${u.why}`
  if (!app) return "off (not a service install following a branch, nor in the desktop app)"
  if (app === "unknown") return "the desktop app's, which didn't say how they are (an older app)"
  if (!app.available) return "off (this desktop app's build doesn't update itself)"
  if (app.mode === "off") return "off in the desktop app (it looks only when asked, from its menu)"
  return `by the desktop app, ${app.mode}, from ${app.from}${app.doing ? `: ${app.doing}` : app.ready ? `: ${app.ready.slice(0, 7)} ready, restart to update` : ""}`
}
