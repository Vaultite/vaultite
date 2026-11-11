// Two servers of one vault, each the other's machine: what they keep shared (core/kept.ts) travels live and catches up,
// none of it written into the vault; state files from before are taken in.   node tools/test_shared.ts (npm test)
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import type { ChildProcess } from "node:child_process"
import { check, exit, freePort, stopTerminals, summary, tempDir, testServer, type Any, waitFor } from "./test/lib.ts"

const t0 = Date.now()
setTimeout(() => { console.error("shared: timed out after 4 min"); process.exit(1) }, 240_000).unref()
const tmp = tempDir("vaultite-shared-test-")
const [pa, pb] = [await freePort(), await freePort()]
const vaultId = crypto.randomUUID()
const machines = { machines: [{ id: "alpha", label: "Alpha", url: `http://127.0.0.1:${pa}` }, { id: "beta", label: "Beta", url: `http://127.0.0.1:${pb}` }] }
const term = (id: string) => `view:terminal/claude-${id}`

/** A vault as each machine has it (the same files: iCloud's copy), with what an older app wrote in it. */
function vaultAt(dir: string, legacy: boolean) {
  const v = path.join(tmp, dir)
  fs.mkdirSync(path.join(v, ".vaultite/plugins/machines"), { recursive: true })
  fs.mkdirSync(path.join(v, "Notes"), { recursive: true })
  fs.writeFileSync(path.join(v, "Notes/Idea.md"), "# Idea\n")
  fs.writeFileSync(path.join(v, ".vaultite/plugins.json"), JSON.stringify({ enabled: ["machines", "workspaces"], disabled: [] }))
  fs.writeFileSync(path.join(v, ".vaultite/plugins/machines/data.json"), JSON.stringify(machines))
  fs.writeFileSync(path.join(v, ".vaultite/plugins/machines/vault.json"), JSON.stringify({ id: vaultId }))
  if (legacy) {
    fs.mkdirSync(path.join(v, ".vaultite/plugins/tabs"), { recursive: true })
    fs.writeFileSync(path.join(v, ".vaultite/plugins/tabs/device-oldphone0001.json"), JSON.stringify({ name: "iPhone app", kind: "phone", at: new Date().toISOString(), tabs: [{ to: "file:Notes/Idea.md" }] }))
    fs.mkdirSync(path.join(v, ".vaultite/plugins/workspaces"), { recursive: true })
    fs.writeFileSync(path.join(v, ".vaultite/plugins/workspaces/2.json"), JSON.stringify({ name: "Writing", layout: { root: { id: "g0", tabs: [{ id: "t1", to: "file:Notes/Idea.md" }], active: "t1" }, focus: "g0" } }))
    fs.mkdirSync(path.join(v, ".vaultite/cache"), { recursive: true })
    fs.writeFileSync(path.join(v, ".vaultite/cache/people.json"), JSON.stringify({ places: { "seattle, wa": [47.6, -122.3] } }))
  }
  return v
}
const VA = vaultAt("a", true), VB = vaultAt("b", false)

const up = new Map<number, ChildProcess>()
const logs: Record<number, string> = {} // (each server's output, shown when a check fails)
async function start(port: number, vault: string, local: string) {
  const s = testServer({ env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: vault, VAULTITE_LOCAL: path.join(tmp, local) }, stdio: ["ignore", "pipe", "pipe"] })
  s.stdout!.on("data", (d) => (logs[port] = (logs[port] ?? "") + d)); s.stderr!.on("data", (d) => (logs[port] = (logs[port] ?? "") + d))
  up.set(port, s)
  const ok = await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/api/state`).catch(() => null))?.ok ?? false, 60_000, 200)
  if (!ok) throw new Error(`the server on ${port} didn't start`)
}
async function stop(port: number) {
  const s = up.get(port)
  if (!s) return
  const gone = new Promise((r) => s.once("exit", r))
  s.kill("SIGTERM")
  await gone
  up.delete(port)
  stopTerminals(port)
}
const api = async (port: number, method: string, route: string, body?: unknown, headers: Record<string, string> = {}) => {
  const r = await fetch(`http://127.0.0.1:${port}/api/${route}`, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return [r.status, await r.json().catch(() => null)] as [number, Any]
}
const devicesOn = async (port: number) => ((await api(port, "GET", "tabs/devices"))[1]?.devices ?? []) as Any[]
/** Every file under .vaultite/ and its time: what the app wrote into the vault. A write's own temp file (core/vault.ts'
 *  `<name>.tmp-<pid>-<n>`, gone once renamed) is that write, not one of its own. */
const stamps = (v: string) => Object.fromEntries((fs.readdirSync(path.join(v, ".vaultite"), { recursive: true }) as string[])
  .filter((f) => !/\.tmp-\d+-\d+$/.test(f))
  .map((f) => [f, fs.statSync(path.join(v, ".vaultite", f), { throwIfNoEntry: false })]).filter(([, st]) => (st as fs.Stats | undefined)?.isFile())
  .map(([f, st]) => [f, (st as fs.Stats).mtimeMs]))

try {
  await Promise.all([start(pa, VA, "local-a"), start(pb, VB, "local-b")])

  // ---------- what an older app wrote, taken in ----------
  check("shared: a device's file from before is taken in and removed", (await devicesOn(pa)).some((d) => d.id === "oldphone0001") &&
    !fs.existsSync(path.join(VA, ".vaultite/plugins/tabs/device-oldphone0001.json")))
  const ws = (await api(pa, "GET", "workspaces"))[1]?.workspaces ?? []
  check("shared: a workspace's file keeps its name, its tabs are taken in", ws[1]?.name === "Writing" && ws[1]?.layout?.tabs?.[0]?.root?.to === "file:Notes/Idea.md" && ws[1]?.layout?.tabs?.[0]?.root?.id === "t1" &&
    JSON.stringify(JSON.parse(fs.readFileSync(path.join(VA, ".vaultite/plugins/workspaces/2.json"), "utf8"))) === JSON.stringify({ name: "Writing" }), ws)
  check("shared: caches in the vault are taken in, the folder gone", !fs.existsSync(path.join(VA, ".vaultite/cache")))
  const legacy = await waitFor(async () => (await devicesOn(pb)).some((d) => d.id === "oldphone0001") || null, 45_000, 250)
  check("shared: and the other machine gets them (asked at its start, or when told)", !!legacy)

  // ---------- live: a device's tabs on one, on the other in a moment (once each knows the other is up) ----------
  const sees = (port: number, id: string) => waitFor(async () => ((await api(port, "GET", "machines"))[1] as Any[] | null)?.some((m) => m.id === id && m.online) || null, 45_000, 500)
  check("shared: each machine sees the other", !!(await sees(pa, "beta")) && !!(await sees(pb, "alpha")))
  const before = stamps(VA)
  const t1 = Date.now()
  await api(pa, "PUT", "tabs/devices/alphamac0001", { tabs: [{ to: "file:Notes/Idea.md" }, { to: term("k1"), label: "Claude" }] }, { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "x-vaultite-client": "app/desktop" })
  const seen = await waitFor(async () => (await devicesOn(pb)).find((d) => d.id === "alphamac0001") ?? null, 10_000, 50)
  const ms = Date.now() - t1
  check(`shared: a device's tabs reach the other machine live (${ms} ms)`, !!seen && ms < 3000, seen)
  check("shared: its terminal tab names the machine it runs on", seen?.tabs.some((t: Any) => t.to === `${term("k1")}@alpha`), seen?.tabs)
  check("shared: as its own machine lists it, without its machine", (await devicesOn(pa)).find((d) => d.id === "alphamac0001")?.tabs.some((t: Any) => t.to === term("k1")))
  await api(pb, "PUT", "workspaces/1", { layout: { tabs: [{ id: "t9", root: { id: "p9", to: "file:Notes/Idea.md" }, focus: "p9" }], active: "t9" } })
  const there = await waitFor(async () => ((await api(pa, "GET", "workspaces"))[1]?.workspaces?.[0]?.layout?.tabs?.[0]?.id === "t9") || null, 10_000, 50)
  check("shared: a workspace's tabs too", !!there)
  await new Promise((r) => setTimeout(r, 1500)) // (past the store's write to its own disk)
  const after = stamps(VA)
  // (grants.json: a plugin's first write on its own asks once, whenever it comes)
  const wrote = Object.keys(after).filter((f) => after[f] !== before[f] && f !== "grants.json")
  check("shared: none of it is written into the vault", !wrote.length, wrote)

  // ---------- one down: the other keeps what it had, and it catches up when back ----------
  await stop(pb)
  await api(pa, "PUT", "tabs/devices/alphamac0001", { tabs: [{ to: "file:Notes/Idea.md" }] }, { "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)", "x-vaultite-client": "app/desktop" })
  await api(pa, "POST", "tabs/devices/alphamac0001/label", { label: "Desk" })
  await start(pb, VB, "local-b")
  const caught = await waitFor(async () => (await devicesOn(pb)).find((d) => d.id === "alphamac0001" && d.label === "Desk" && d.tabs.length === 1) ?? null, 45_000, 250)
  check("shared: a machine that was down catches up on what changed meanwhile", !!caught)
  check("shared: and what it kept itself survived its restart", ((await api(pb, "GET", "workspaces"))[1]?.workspaces?.[0]?.layout?.tabs?.[0]?.id === "t9"))
  await stop(pa)
  check("shared: with the other machine off, its devices still show (as last heard)", (await devicesOn(pb)).some((d) => d.id === "alphamac0001" && !d.live))
  // A device forgotten on one machine is forgotten on the other.
  await start(pa, VA, "local-a")
  await api(pb, "DELETE", "tabs/devices/oldphone0001")
  const forgot = await waitFor(async () => !(await devicesOn(pa)).some((d) => d.id === "oldphone0001") || null, 10_000, 100)
  check("shared: forgetting a device travels too", !!forgot)
} catch (e) {
  check(`shared: threw ${(e as Error).stack}`, false)
} finally {
  await Promise.all([...up.keys()].map(stop))
}
const failed = (await import("./test/lib.ts")).results.some((r) => r.status === "FAIL")
if (failed) for (const [port, log] of Object.entries(logs)) console.log(`\n---- server ${port === String(pa) ? "alpha" : "beta"}'s output, its last lines:\n${log.split("\n").filter((l) => !/" 200 \d+ms$/.test(l)).slice(-40).join("\n")}`)
await exit(summary("shared", t0))
