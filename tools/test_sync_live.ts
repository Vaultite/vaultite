// Device sync on real servers: a and b over the network (a the hub), c by the mailbox only. Edits travel, clashes settle
// in the note, mass deletes are held, the hub snapshots into git, a restart picks up.   node tools/test_sync_live.ts
import { execFileSync, type ChildProcess } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { gitEnv } from "../core/gitenv.ts"
import { check, exit, freePort, section, stopTerminals, summary, tempDir, testServer, type Any, waitFor } from "./test/lib.ts"

const t0 = Date.now()
setTimeout(() => { console.error("sync live: timed out after 5 min"); process.exit(1) }, 300_000).unref()
const tmp = tempDir("vaultite-sync-test-")
const ports = { a: await freePort(), b: await freePort(), c: await freePort() }
const vaultId = crypto.randomUUID(), mailbox = path.join(tmp, "mailbox"), git = path.join(tmp, "backups", "vault.git"), copy = path.join(tmp, "icloud-copy")
const shadow = path.join(tmp, "shadow-b")
const url = (d: keyof typeof ports) => `http://127.0.0.1:${ports[d]}`

function vaultAt(d: string) {
  const v = path.join(tmp, `vault-${d}`)
  const put = (p: string, text: string) => { fs.mkdirSync(path.dirname(path.join(v, p)), { recursive: true }); fs.writeFileSync(path.join(v, p), text) }
  put(".vaultite/plugins/machines/vault.json", JSON.stringify({ id: vaultId }))
  put(".vaultite/plugins/sync/data.json", JSON.stringify({ hub: "a" }))
  put("Notes/Idea.md", "# Idea\n\nfirst line\nsecond line\n")
  put("Notes/Move me.md", "moving\n")
  for (let i = 0; i < 70; i++) put(`Bulk/File ${i}.md`, `bulk ${i}\n`)
  return v
}
const V = { a: vaultAt("a"), b: vaultAt("b"), c: vaultAt("c") }
for (const d of ["a", "b", "c"] as const) {
  const local = path.join(tmp, `local-${d}`)
  const peers = d === "a" ? [{ id: "b", url: url("b") }] : d === "b" ? [{ id: "a", url: url("a") }] : []
  const set = { id: vaultId, folder: V[d], device: d, peers, mailbox: d === "b" ? null : mailbox, git: d === "a" ? git : null, ...(d === "a" ? { copy } : {}) }
  // (b also keeps a shadow copy of its vault: fed from it, compared with it)
  const sets = d === "b" ? [set, { id: `${vaultId}-shadow`, folder: shadow, input: V.b, device: "b", peers: [], mailbox: null, git: null }] : [set]
  const dir = path.join(local, "sync")
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, "sets.json"), JSON.stringify({ sets }))
}

const up = new Map<string, ChildProcess>()
const logs: Record<string, string> = {}
async function start(d: keyof typeof ports) {
  const local = path.join(tmp, `local-${d}`)
  const s = testServer({ env: { ...process.env, PORT: String(ports[d]), HOST: "127.0.0.1", VAULTITE_VAULT: V[d], VAULTITE_LOCAL: local, VAULTITE_SYNC_MS: "700" }, stdio: ["ignore", "pipe", "pipe"] })
  s.stdout!.on("data", (x) => (logs[d] = (logs[d] ?? "") + x)); s.stderr!.on("data", (x) => (logs[d] = (logs[d] ?? "") + x))
  up.set(d, s)
  const ok = await waitFor(async () => (await fetch(`${url(d)}/api/state`).catch(() => null))?.ok ?? false, 60_000, 200)
  if (!ok) throw new Error(`${d} didn't start:\n${logs[d]}`)
  if (!(await until(async () => (await op(d, "sync.status"))[1]?.[0]?.lastStep))) throw new Error(`${d} doesn't sync:\n${logs[d]}`)
}
async function stop(d: keyof typeof ports) {
  const s = up.get(d)
  if (!s) return
  const gone = new Promise((r) => s.once("exit", r))
  s.kill("SIGTERM"); await gone; up.delete(d); stopTerminals(ports[d])
}
const api = async (d: keyof typeof ports, method: string, route: string, body?: unknown) => {
  const r = await fetch(`${url(d)}/api/${route}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  return [r.status, await r.json().catch(() => null)] as [number, Any]
}
const op = (d: keyof typeof ports, id: string, params: Any = {}) => api(d, "POST", `ops/${id}`, params).then(([s, b]) => [s, b?.result ?? b] as [number, Any])
const read = (d: keyof typeof ports, p: string) => { try { return fs.readFileSync(path.join(V[d], p), "utf8") } catch { return null } }
const write = (d: keyof typeof ports, p: string, text: string) => { fs.mkdirSync(path.dirname(path.join(V[d], p)), { recursive: true }); fs.writeFileSync(path.join(V[d], p), text) }
const until = (fn: () => unknown, ms = 20_000) => waitFor(async () => !!(await fn()), ms, 150)

try {
  await Promise.all([start("a"), start("b"), start("c")])

  await section("edits travel", async () => {
    write("a", "Notes/New.md", "made on a\n")
    check("a's new note reaches b over the network", await until(() => read("b", "Notes/New.md") === "made on a\n"))
    check("and c through the mailbox", await until(() => read("c", "Notes/New.md") === "made on a\n"))
    write("c", "Notes/From c.md", "made on c\n")
    check("c's note reaches a through the mailbox", await until(() => read("a", "Notes/From c.md") === "made on c\n"))
    check("and b by a's relay", await until(() => read("b", "Notes/From c.md") === "made on c\n"))
    const big = crypto.randomBytes(3 << 20)
    fs.writeFileSync(path.join(V.a, "Attachments-clip.mp4"), big)
    check("a big file reaches b whole (fetched, not sent inline)", await until(() => { try { return fs.readFileSync(path.join(V.b, "Attachments-clip.mp4")).equals(big) } catch { return false } }, 30_000))
    fs.renameSync(path.join(V.b, "Notes/Move me.md"), path.join(V.b, "Notes/Moved.md"))
    check("a move reaches a as a move", await until(() => read("a", "Notes/Moved.md") === "moving\n" && read("a", "Notes/Move me.md") === null))
  })

  await section("a clash shows in the note and settles everywhere", async () => {
    await stop("b")
    write("a", "Notes/Idea.md", "# Idea\n\nfirst line, from a\nsecond line\n")
    await until(async () => (await op("c", "sync.status"))[1]?.[0]?.heads >= 1 && read("c", "Notes/Idea.md")?.includes("from a"))
    write("b", "Notes/Idea.md", "# Idea\n\nfirst line, from b\nsecond line\nand a line of b's\n")
    await start("b")
    const same = await until(() => read("a", "Notes/Idea.md") === read("b", "Notes/Idea.md") && read("a", "Notes/Idea.md")?.includes("and a line of b's"))
    check("both sides end alike, b's other line kept", same, [read("a", "Notes/Idea.md"), read("b", "Notes/Idea.md")])
    let v: Any = null, other: Any = null
    await until(async () => {
      v = (await api("a", "GET", `sync-conflicts/versions?path=${encodeURIComponent("Notes/Idea.md")}`))[1]
      other = (v?.versions ?? []).find((x: Any) => String(x.id).startsWith("sync:"))
      return other?.text != null
    })
    check("the note offers the other side", other && /first line, from (a|b)/.test(other.text) && other.base !== null, v)
    const idea = (r: Any) => (r?.[0]?.conflicts ?? []).filter((c: Any) => c.path === "Notes/Idea.md")
    const [, cs] = await op("b", "sync.conflicts")
    check("b lists the same clash", idea(cs).length === 1 && idea(cs)[0].conflict.id === other?.id.slice(5), cs)
    const [s] = await api("a", "POST", "sync-conflicts/resolve", { path: "Notes/Idea.md", id: other?.id })
    check("settled in the note", s === 200)
    check("settled on b too", await until(async () => idea((await op("b", "sync.conflicts"))[1]).length === 0))
  })

  await section("many deletes at once are held", async () => {
    const bulk = (dir: string) => { try { return fs.readdirSync(path.join(dir, "Bulk")).length } catch { return 0 } }
    const t = Date.now()
    for (let i = 0; i < 70; i++) fs.rmSync(path.join(V.b, `Bulk/File ${i}.md`))
    const sets = async () => (await op("b", "sync.status"))[1] ?? []
    check("held on b", await until(async () => (await sets())[0]?.held?.deletes === 70), await sets())
    check("and in its shadow copy", await until(async () => (await sets())[1]?.held?.deletes === 70) && bulk(shadow) === 70, await sets())
    // (a trade since, and a look on a after it: whatever b let through would be on a by now)
    await until(async () => ((await sets())[0]?.peers ?? []).find((p: Any) => p.id === "a")?.ok > t)
    const traded = Date.now()
    await until(async () => (await op("a", "sync.status"))[1]?.[0]?.lastStep > traded)
    check("a still has them", bulk(V.a) === 70, bulk(V.a))
    await op("b", "sync.release", { no: true })
    check("written back on b when the answer is no", await until(() => bulk(V.b) === 70), bulk(V.b))
    check("nothing held any more", await until(async () => (await sets()).every((s: Any) => !s.held)), await sets())
  })

  await section("the hub's git snapshot", async () => {
    const [, r] = await op("a", "sync.snapshot")
    check("a committed one", r?.[0]?.result?.committed === true || r?.[0]?.result?.committed === false, r)
    const files = execFileSync("git", ["--git-dir", git, "ls-tree", "-r", "--name-only", "HEAD"], { encoding: "utf8", env: gitEnv() })
    check("with the notes and settings in it", files.includes("Notes/New.md") && files.includes(".vaultite/plugins/sync/data.json"), files.slice(0, 300))
    const [, rb] = await op("b", "sync.snapshot")
    check("b isn't the hub: none there", rb?.[0]?.hub === false, rb)
  })

  await section("the hub's one-way copy", async () => {
    check("a's files are copied", await until(() => fs.existsSync(path.join(copy, "Notes/New.md")) && fs.existsSync(path.join(copy, "Bulk/File 9.md"))))
    fs.writeFileSync(path.join(copy, "Notes/New.md"), "made on a\nwritten into the copy\n")
    check("a write into the copy comes back as a change", await until(() => read("a", "Notes/New.md") === "made on a\nwritten into the copy\n"))
    check("and reaches b", await until(() => read("b", "Notes/New.md") === "made on a\nwritten into the copy\n"))
    fs.writeFileSync(path.join(copy, "Notes/Stray.md"), "a stray session's note\n")
    check("a new file written there is kept", await until(() => read("b", "Notes/Stray.md") === "a stray session's note\n"))
    fs.rmSync(path.join(copy, "Notes/Moved.md"))
    check("a delete there is put back, never synced", await until(() => fs.existsSync(path.join(copy, "Notes/Moved.md"))) && read("a", "Notes/Moved.md") === "moving\n")
  })

  await section("shadow mode", async () => {
    write("b", "Notes/Shadowed.md", "in the live vault\n")
    check("the live vault's change reaches the shadow copy", await until(() => fs.existsSync(path.join(shadow, "Notes/Shadowed.md"))))
    check("the live vault is only read", read("b", "Notes/Shadowed.md") === "in the live vault\n")
    const [, r] = await op("b", "sync.compare")
    const now = r?.[0]?.now
    check("compare: nothing missing, nothing lost", now && !now.missing.length && !now.lostLines.length && now.same > 70, now)
  })

  await section("the switch off iCloud, and back", async () => {
    // (on a stopped machine's folders: the copy made and checked, the set and link written; then undone)
    const from = path.join(tmp, "icloud", "MyVault"), to = path.join(tmp, "home", "Vaultite", "MyVault"), local = path.join(tmp, "switch-local")
    const link = path.join(tmp, "home", ".vaultite", "vault")
    fs.cpSync(V.c, from, { recursive: true })
    fs.mkdirSync(path.dirname(link), { recursive: true }); fs.symlinkSync(from, link)
    const tool = (...args: string[]) => execFileSync(process.execPath, [path.join(import.meta.dirname, "sync_switch.ts"), ...args], { encoding: "utf8", env: { ...process.env } })
    const port = String(await freePort())
    const out = tool("move", "--from", from, "--to", to, "--local", local, "--device", "m1", "--copy", from, "--link", link, "--port", port, "--no-icloud-wait")
    const sets = JSON.parse(fs.readFileSync(path.join(local, "sync", "sets.json"), "utf8")).sets
    check("the vault copied whole", tool("hashes", from) === tool("hashes", to), out)
    check("its set: the new folder, the old one its one-way copy", sets.length === 1 && sets[0].folder === to && sets[0].copy === from && sets[0].id === vaultId, sets)
    check("the link points at the new folder", fs.readlinkSync(link) === to)
    let refused = ""
    try { tool("move", "--from", from, "--to", to, "--local", local, "--device", "m1", "--port", port, "--no-icloud-wait") } catch (e) { refused = String((e as { stderr?: string }).stderr) }
    check("a second move is refused (the folder's made)", /isn't empty/.test(refused), refused)
    const busy = (await import("node:net")).createServer().listen(Number(port), "127.0.0.1")
    await new Promise((r) => busy.once("listening", r))
    try { tool("back", "--local", local, "--port", port); refused = "" } catch (e) { refused = String((e as { stderr?: string }).stderr) }
    busy.close()
    check("nothing moves while a server answers", /stop it first/.test(refused), refused)
    tool("back", "--local", local, "--port", port)
    check("back: the link is the old folder again, its sync stopped", fs.readlinkSync(link) === from && !JSON.parse(fs.readFileSync(path.join(local, "sync", "sets.json"), "utf8")).sets.length)
    // (a machine that has no copy, the mini PC: an empty folder with the vault's id, its service pointed at it)
    const unit = path.join(tmp, "vaultite.service"), was = `[Service]\nEnvironment="VAULTITE_VAULT=/home/x/MyVault"\nRestart=always\n`
    fs.writeFileSync(unit, was)
    const join = path.join(tmp, "home", "Vaultite", "Joined")
    tool("join", "--to", join, "--vault", vaultId, "--local", local, "--device", "minipc", "--unit", unit, "--port", port)
    check("join: the folder has the vault's id, the service points at it", fs.readFileSync(unit, "utf8").includes(`VAULTITE_VAULT=${join}`) &&
      JSON.parse(fs.readFileSync(path.join(join, ".vaultite/plugins/machines/vault.json"), "utf8")).id === vaultId)
    tool("back", "--local", local, "--port", port)
    check("and back", fs.readFileSync(unit, "utf8") === was)
  })

  await section("failover: the hub moves and back", async () => {
    // (the M1 gone: vau sync hub on any machine; a vault setting, so every machine follows, backups and all)
    const hubOn = async (d: keyof typeof ports) => (await op(d, "sync.status"))[1]?.[0]?.hub
    await stop("a")
    write("b", "Notes/While the hub is down.md", "kept on b\n")
    const [s] = await op("b", "sync.hub", { machine: "b" })
    check("vau sync hub on another machine", s === 200 && await hubOn("b") === "b")
    const [, snap] = await op("b", "sync.snapshot")
    check("the new hub takes the snapshots", snap?.[0]?.hub === true, snap)
    await start("a")
    check("the old hub, back, follows the setting", await until(async () => (await hubOn("a")) === "b"))
    check("and has what was made meanwhile", await until(() => read("a", "Notes/While the hub is down.md") === "kept on b\n"))
    await op("a", "sync.hub", { machine: "a" })
    check("and back", await until(async () => (await hubOn("b")) === "a" && (await hubOn("a")) === "a"))
  })

  await section("a restart picks up", async () => {
    await stop("a")
    write("b", "Notes/While a was off.md", "hello\n")
    await start("a")
    check("what b made meanwhile arrives", await until(() => read("a", "Notes/While a was off.md") === "hello\n"))
    const [, st] = await op("a", "sync.status")
    check("one version per file after the restart", st?.[0]?.merging === 0, st?.[0])
  })
} catch (e) {
  check("ran", false, (e as Error).message)
} finally {
  for (const d of [...up.keys()] as (keyof typeof ports)[]) await stop(d)
}
const code = summary("sync-live", t0)
if (code) for (const [d, l] of Object.entries(logs)) console.log(`\n--- ${d}\n${l.slice(-3000)}`)
await exit(code)
