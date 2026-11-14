import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "../harness.ts"

export async function notesKeepItRunning($: VaultTest, LH: string, hash: string, vplugin: () => Promise<Any>) {
  const { VAULT, check, read, write } = $
  write(`${LH}/AGENTS.md`, read(`${LH}/AGENTS.md`) + "\nA line an agent added.\n")
  write(`${LH}/pages/Lighthouse.md`, read(`${LH}/pages/Lighthouse.md`) + "\nMore.\n")
  const after = await vplugin()
  check("trust: its notes edited, it keeps running with nothing to allow", after.loaded && !after.approval && after.hash !== hash, after.approval)
  const { notesOf } = await import("../../../../core/trust.ts")
  const dir = path.join(VAULT, "..", "notes-plugin")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ id: "n", schedule: [{ name: "a", every: "1d", command: ["bash", "-c", ". ./steps.md"] }],
    ops: [{ id: "n.b", command: ["node", "run.mjs"] }] }))
  const note = notesOf(dir)
  check("trust: Markdown a command runs is code, as is everything but Markdown", note("Brief.md") && note("pages/A.md") && !note("steps.md") && !note("run.mjs") && !note("x.ts") && !note("manifest.json"))
  fs.rmSync(dir, { recursive: true })
  const heard: string[] = [], said = console.error
  console.error = (...a: unknown[]) => { heard.push(a.map(String).join(" ")); said(...a) }
  write(`${LH}/AGENTS.md`, read(`${LH}/AGENTS.md`) + "\nAnother.\n")
  return { stop: () => { console.error = said; return heard } }
}

export async function pausedStays($: VaultTest, LH: string, stop: () => string[]) {
  const { api, app, check, read, sleep, write } = $
  const paused = async () => { await sleep(150); return ((await api("GET", "inbox/events"))[1].events as Any[]).filter((e) => e.key === "paused:lighthouse") }
  let told = await paused()
  check("trust: a plugin that changed after it was allowed tells the user it's paused, waiting on them", told.length === 1 && told[0].kind === "waiting" &&
    told[0].title.startsWith("Lighthouse changed and is paused") && told[0].body.includes("beam.ts") && told[0].link === "detail:plugin/lighthouse" && !told[0].read, told)
  const first = told[0]?.id
  write(`${LH}/beam.ts`, read(`${LH}/beam.ts`) + "\n")
  await api("GET", "plugins")
  told = await paused()
  check("trust: ...once, not again for each later edit", told.length === 1 && told[0].id === first && !!app.vaultPlugins.trust.approval("lighthouse")?.paused, told)
  const logged = stop()
  check("trust: ...and in Errors (what console.error says), once", logged.filter((m) => m.includes("Lighthouse changed and is paused") && m.includes("vau plugin allow lighthouse")).length === 1, logged)
  const [sc, sb] = await api("POST", "ops/inbox.settle", { item: first })
  const [dc] = await api("DELETE", `inbox/events/${first}`)
  await api("POST", "ops/inbox.read", { ids: [first] })
  await api("DELETE", "inbox/events?done=1")
  await api("POST", "inbox/events/done", { ids: [first, "zz-nothing"] })
  told = await paused()
  check("trust: its notice stays till it's allowed: settling, forgetting, reading or clearing it leave it open (a cleanup can't hide it)",
    sc === 409 && JSON.stringify(sb).includes("Lighthouse stays paused until you allow it, so") && dc === 409 && told.length === 1 && told[0].state === "open" && told[0].stays, [sc, sb, dc, told])
  check("trust: its notice offers Allow, which runs plugin.allow for it", JSON.stringify(told[0]?.fix) === JSON.stringify({ label: "Allow", op: "plugin.allow",
    args: { id: "lighthouse" }, why: "Lighthouse stays paused until you allow it" }), told[0])
  const [, { event: posted }] = await api("POST", "inbox/events", { source: "vau", kind: "waiting", key: "posted", title: "Posted", stays: true,
    fix: { label: "Run", op: "plugin.allow", args: { id: "lighthouse" }, why: "x" } })
  check("trust: an event posted over HTTP can't carry a fix or stay (only the core and plugins give one)", !posted?.fix && !posted?.stays, posted)
  await api("DELETE", `inbox/events/${posted?.id}`)
  await app.syncPlugins()
  told = await paused()
  check("trust: ...and replaced some other way, the next look says it again", told.length === 1 && told[0].state === "open" && told[0].stays, told)
  const [fc, fb] = await api("POST", `inbox/events/${told[0]?.id}/fix`, {})
  told = await paused()
  check("trust: its Allow allows it, and the notice is settled", fc === 200 && String(fb.text).includes("Lighthouse is allowed on this machine") &&
    !app.vaultPlugins.trust.approval("lighthouse")?.paused && told.length === 1 && told[0].state === "done", [fc, fb, told])
  const [gc] = await api("POST", `inbox/events/${told[0]?.id}/fix`, {})
  check("trust: ...a second press finds nothing left to do", gc === 404, gc)
  const { scheduleOf } = await import("../../../../core/hooks.ts")
  const jobs = scheduleOf({ schedule: [{ name: "brief", every: "1d", at: "{morning}" }, { name: "odd", every: "1d", at: "{late}" }] }, (k) => (k === "morning" ? "06:45" : "soon"))
  check("trust: a paused job's time a setting names is read (so the run it misses is told)", jobs[0].at === "06:45" && jobs[1].at === "{late}", jobs)
}
