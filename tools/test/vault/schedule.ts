import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, read, sleep, tmp, vault, write } = $
  // Jobs on a timer (core/schedule.ts): when they're due, a manifest's `schedule` (a command, an op) and plugin.every.
  {
    const { nextRun, Scheduler, whenProblems } = await import("../../../core/schedule.ts")
    const { hookProblems } = await import("../../../core/hooks.ts")
    const at = (s: string) => new Date(s).getTime() // (local time)
    check("schedule: an interval is due at once the first time, then a period after its last run",
      nextRun({ every: "15m" }, { seen: 5 }) === 5 && nextRun({ every: "15m" }, { seen: 5, ran: 1000 }) === 1000 + 900_000)
    check("schedule: an `at` job waits for its next slot, then the one a period after the slot it ran for",
      nextRun({ every: "1d", at: "07:00" }, { seen: at("2026-03-02T09:00") }) === at("2026-03-03T07:00") &&
      nextRun({ every: "1d", at: "07:00" }, { seen: 0, for: at("2026-03-02T07:00") }) === at("2026-03-03T07:00") &&
      nextRun({ every: "1w", at: "07:00" }, { seen: 0, for: at("2026-03-02T07:00") }) === at("2026-03-09T07:00"))
    check("schedule: timings are checked", whenProblems({ every: "soon" }).length === 1 && whenProblems({ every: "2h", at: "07:00" })[0]?.includes("whole days") &&
      whenProblems({ every: "1d", at: "7am" }).length === 1 && !whenProblems({ every: "1d", at: "07:00", machine: "home" }).length)

    // A scheduler of its own: due jobs run once at a time, a missed `at` slot runs once (not once per missed day).
    const file = path.join(tmp, "sched.json"), ran: string[] = []
    let gate: () => void = () => {}, slows = 0
    const jobs = [{ plugin: "p", job: { name: "fast", every: "1h", run: () => { ran.push("fast") } } },
      { plugin: "p", job: { name: "daily", every: "1d", at: "07:00", run: () => { ran.push("daily") } } },
      { plugin: "p", job: { name: "elsewhere", every: "1m", machine: "other", run: () => { ran.push("elsewhere") } } },
      { plugin: "p", job: { name: "slow", every: "1m", run: () => { ran.push("slow"); return slows++ ? undefined : new Promise<void>((r) => { gate = r }) } } },
      { plugin: "p", job: { name: "broken", every: "1h", run: () => { ran.push("broken"); throw new Error("no network") } } }]
    const s = new Scheduler({ file, jobs: () => jobs, here: async (m) => !m })
    const t0 = at("2026-03-02T09:00")
    const slow = s.tick(t0)
    await sleep(10)
    check("schedule: intervals run at once, an `at` job waits, another machine's doesn't run here", ran.sort().join() === "broken,fast,slow", ran)
    ran.length = 0
    await s.tick(t0 + 120_000)
    check("schedule: a job still running isn't started again", !ran.includes("slow") && !ran.length, ran)
    gate()
    await slow
    await s.tick(at("2026-03-05T12:00")) // (three days later)
    check("schedule: after days away each runs once; the missed slot once", ran.sort().join() === "broken,daily,fast,slow", ran)
    ran.length = 0
    await s.tick(at("2026-03-05T12:30"))
    check("schedule: and not again before they're due", ran.join() === "slow", ran)
    const rows = await new Scheduler({ file, jobs: () => jobs, here: async (m) => !m }).list(at("2026-03-05T12:31"))
    const row = (n: string) => rows.find((r) => r.name === n)!
    const why = "Daily changed and waits for you to allow it again"
    const held = await new Scheduler({ file, jobs: () => jobs.filter((j) => j.job.name !== "daily"), here: async (m) => !m,
      paused: () => [{ plugin: "p", job: { name: "daily", every: "1d", at: "07:00" }, why }] }).list(at("2026-03-05T12:31"))
    const daily = held.find((r) => r.name === "daily")!
    check("schedule: a paused plugin's job is listed, saying why, with no next run", daily.paused === why && daily.next === null && daily.ran !== null && row("fast").paused === null, held)
    check("schedule: last runs are kept on this machine (a new scheduler reads them), with errors", row("broken").error === "no network" && row("daily").next === new Date(at("2026-03-06T07:00")).toISOString() &&
      row("elsewhere").next === null && row("elsewhere").here === false, rows)

    // A vault plugin's manifest: a command and an op on a timer, run by the app's scheduler; plugin.every and plugin.around.
    const WC = ".vaultite/plugins/wordcount"
    const m = JSON.parse(read(`${WC}/manifest.json`))
    m.ops = m.ops.filter((o: Any) => o.id !== "wordcount.bad")
    m.schedule = [{ name: "tick", every: "1h", command: ["node", "-e", "require('fs').writeFileSync(process.env.VAULTITE_PLUGIN_STATE + '/tick.txt', process.env.VAULTITE_SCHEDULE)"] },
      { every: "1d", at: "07:00", op: "note.create", params: { title: "Morning" } },
      { name: "now", every: "1m", op: "note.create", params: { title: "Scheduled note", body: "From a schedule." } },
      { name: "typo", every: "1w", at: "21:00", op: "note.create", params: { titel: "Weekly" } }]
    m.writes = [{ folder: "Notes", why: "notes on a schedule" }]
    write(`${WC}/manifest.json`, JSON.stringify(m, null, 2))
    write(".vaultite/plugins/guard/manifest.json", JSON.stringify({ id: "guard", name: "Guard", description: "A test's middleware.", apiVersion: 1 }))
    write(".vaultite/plugins/guard/plugin.ts", `import { OpError, Plugin } from "@vaultite/core/plugins.ts"
export const plugin = new Plugin(import.meta.url)
plugin.around("*", () => { throw new Error("a bug") })
plugin.around("note.create", async ({ params, who }, next) => {
  if (params.title === "Forbidden") throw new OpError("not that one")
  return next({ ...params, title: params.title.replace("Lighthose", "Lighthouse"), body: \`\${params.body ?? ""} (\${who.source})\` })
})
plugin.around(["ops.list"], async (_call, next) => ((await next()) as unknown[]).slice(0, 1))
plugin.every("beat", { every: "2h" }, () => { plugin.saveSettings({ beat: true }) })
plugin.every("gone", { every: "1h" }, () => {})
plugin.every("gone", null)
`)
    await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: [...(vault.config("plugins").enabled ?? []), "wordcount", "guard"] })
    await api("POST", "ops/plugin.allow", { id: "guard" })
    const [, plugins] = await api("GET", "plugins")
    check("schedule: the plugins load", ["wordcount", "guard"].every((id) => (plugins as Any[]).find((p) => p.id === id)?.loaded), (plugins as Any[]).filter((p) => ["wordcount", "guard"].includes(p.id)))
    const [, checked] = await api("POST", "ops/plugin.check", { path: "wordcount" })
    check("schedule: plugins check names a job's op parameter it doesn't take", (checked as Any[])[0]?.warnings?.some((w: string) => w.includes("schedule[3]") && w.includes("titel")), checked)
    await app.scheduler.tick()
    const state = path.join(process.env.VAULTITE_LOCAL!, "plugin-state", fs.readdirSync(path.join(process.env.VAULTITE_LOCAL!, "plugin-state"))[0], "wordcount")
    check("schedule: a manifest's command ran, told which", fs.existsSync(path.join(state, "tick.txt")) && fs.readFileSync(path.join(state, "tick.txt"), "utf8") === "tick")
    await vault.synced()
    // The write gate: a schedule acts on its own, so its writes outside .vaultite/ wait for the user's grant.
    check("write gate: a schedule's write outside .vaultite/ is refused without a grant", !fs.existsSync(path.join(VAULT, "Notes/Scheduled note.md")))
    check("write gate: ...and the app is told to ask", JSON.parse(read(".vaultite/grants.json")).wordcount?.Notes === "ask", read(".vaultite/grants.json"))
    const [, gw] = await api("GET", "state")
    check("write gate: /api/state lists it", gw.writeGrants.some((g: Any) => g.plugin === "wordcount" && g.place === "Notes" && g.answer === "ask" && g.on), gw.writeGrants)
    await api("POST", "ops/plugin.grant", { id: "wordcount", allow: false })
    await api("POST", "ops/schedule.run", { id: "wordcount/now" })
    check("write gate: Not now, still refused", !fs.existsSync(path.join(VAULT, "Notes/Scheduled note.md")) && JSON.parse(read(".vaultite/grants.json")).wordcount?.Notes === "not now")
    await api("POST", "ops/plugin.grant", { id: "wordcount" })
    {
      const folders = vault.config("folders")
      vault.setConfig("folders", { ...folders, notes: "Writing/Notes" })
      check("write gate: a folder granted is wherever the user keeps that kind's files, another plugin's kind too",
        vault.mayWrite("wordcount", "Writing/Notes/x.md") && vault.mayWrite("wordcount", "Notes/x.md") && !vault.mayWrite("wordcount", "Elsewhere/x.md"))
      vault.setConfig("folders", folders)
    }
    await api("POST", "ops/schedule.run", { id: "wordcount/now" })
    await vault.synced()
    check("schedule: a manifest's op ran, as a schedule (the middleware saw who)", fs.existsSync(path.join(VAULT, "Notes/Scheduled note.md")) && read("Notes/Scheduled note.md").includes("From a schedule. (schedule)"), fs.existsSync(path.join(VAULT, "Notes/Scheduled note.md")) && read("Notes/Scheduled note.md"))
    check("schedule: plugin.every ran", vault.config("plugins/guard/data").beat === true)
    let [st, body] = await api("POST", "ops/schedule.list", {})
    const ids = (body as Any[]).map((r) => r.id)
    check("schedule: schedule.list has every job, with when it last ran and next runs", st === 200 && ["wordcount/tick", "wordcount/note.create", "wordcount/now", "guard/beat"].every((i) => ids.includes(i)) && !ids.includes("guard/gone") &&
      (body as Any[]).find((r) => r.id === "wordcount/tick").ran !== null, body)
    ;[st, body] = await api("POST", "ops/schedule.run", { id: "wordcount/note.create" })
    check("schedule: schedule.run runs one now", st === 200 && body === null && fs.existsSync(path.join(VAULT, "Notes/Morning.md")), [st, body])
    const stranger = { headers: { host: "vault.example.ts.net", "tailscale-user-login": "stranger@example.com" }, socket: { remoteAddress: "100.64.0.9" } } as Any
    check("schedule: only this machine's owner may run a job", await app.runOp("schedule.run", { id: "guard/beat" }, { http: stranger }).then(() => false, (e) => e.status === 403))
    const probs = hookProblems({ id: "wordcount", schedule: [{ every: "1x", command: ["node"] }, { every: "1h" }, { every: "1h", op: "Bad", extra: 1 }, { every: "1h", op: "a.b" }, { every: "2h", op: "a.b" }] }, path.join(VAULT, WC))
    const has = (x: string) => probs.some((p) => p.includes(x))
    check("schedule: a manifest's schedule is checked", has("schedule[0]: every is") && has("schedule[1]: give it a command or an op") && has("op is an operation's id") && has("'extra' isn't a key") && has("'a.b' is there twice"), probs)

    // Middleware over ops (plugin.around): rewrite, refuse, answer; one that throws by mistake is skipped.
    ;[st, body] = await api("POST", "ops/note.create", { title: "Lighthose trip", body: "Plans." })
    check("around: rewrites an op's params (checked again), the op runs with them", st === 200 && fs.existsSync(path.join(VAULT, "Notes/Lighthouse trip.md")) && read("Notes/Lighthouse trip.md").includes("Plans. (api)"), [st, body])
    ;[st, body] = await api("POST", "ops/note.create", { title: "Forbidden" })
    check("around: refuses with an OpError", st === 400 && body.error === "not that one" && !fs.existsSync(path.join(VAULT, "Notes/Forbidden.md")), [st, body])
    ;[st, body] = await api("POST", "ops/ops.list", {})
    check("around: changes an op's answer", Array.isArray(body) && body.length === 1, body)
    await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: (vault.config("plugins").enabled ?? []).filter((x: string) => x !== "guard" && x !== "wordcount") })
    ;[st, body] = await api("POST", "ops/ops.list", {})
    check("around: only while its plugin is on; jobs too", Array.isArray(body) && body.length > 1 && !(await app.scheduler.list()).some((r) => r.plugin === "guard"), body)
    fs.rmSync(path.join(VAULT, ".vaultite/plugins/guard"), { recursive: true })
    for (const n of ["Scheduled note", "Morning", "Lighthouse trip"]) fs.rmSync(path.join(VAULT, `Notes/${n}.md`), { force: true })
  }
}
