// A shared folder's note typed in from another machine of the vault (plugins/core/companion/bridge.ts): two servers on
// two copies of a vault that never sync, one sharing a folder. The other's app and the guest type in the note live, each
// sees the other's caret, the sharing one writes it and the other never does. Starts both servers itself.
//   node web/qa/sharebridge.mjs <vault copy>
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { freePort, qa, until, wait } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"

const { args: [VAULT], browser, check, watch, done } = await qa(import.meta.url)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-qa-sharebridge-"))
const [hostPort, otherPort, pubPort] = [await freePort(), await freePort(), await freePort()]
const HOST = `http://127.0.0.1:${hostPort}/`, OTHER = `http://127.0.0.1:${otherPort}/`, PUB = `http://127.0.0.1:${pubPort}`
const NOTE = "Qa bridge/Plan.md", TEXT = "# Plan\n\nA line to start from.\n"
const vaults = ["host", "other"].map((n) => path.join(tmp, n))
for (const v of vaults) {
  fs.cpSync(VAULT, v, { recursive: true })
  const m = path.join(v, ".vaultite/plugins/machines")
  fs.mkdirSync(m, { recursive: true })
  fs.writeFileSync(path.join(m, "data.json"), JSON.stringify({ machines: [{ id: "host", label: "Host", url: HOST.slice(0, -1) }, { id: "other", label: "Other", url: OTHER.slice(0, -1) }] }))
  fs.writeFileSync(path.join(m, "vault.json"), JSON.stringify({ id: "qa-sharebridge-vault" }))
  const pj = path.join(v, ".vaultite/plugins.json"), on = fs.existsSync(pj) ? JSON.parse(fs.readFileSync(pj, "utf8")) : {}
  fs.writeFileSync(pj, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "machines"])], disabled: (on.disabled ?? []).filter((x) => x !== "machines") }))
  fs.mkdirSync(path.join(v, "Qa bridge"), { recursive: true })
  fs.writeFileSync(path.join(v, NOTE), TEXT)
}
const locals = ["host", "other"].map((n) => fs.mkdirSync(path.join(tmp, `local-${n}`), { recursive: true }) ?? path.join(tmp, `local-${n}`))
fs.writeFileSync(path.join(locals[0], "config.json"), JSON.stringify({ mcp: { public: { url: PUB, port: pubPort } } }))
const procs = [[hostPort, vaults[0], locals[0]], [otherPort, vaults[1], locals[1]]].map(([port, v, l]) =>
  [port, testServer({ stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: v, VAULTITE_LOCAL: l } })])
const stop = () => {
  for (const [port, proc] of procs) {
    if (proc.exitCode === null) proc.kill()
    try { process.kill(Number(fs.readFileSync(path.join(os.tmpdir(), `vaultite-ptyd1-vaultite-${port}.sock.pid`), "utf8"))) } catch {}
    spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  }
  fs.rmSync(tmp, { recursive: true, force: true })
}
const onDisk = (i) => fs.readFileSync(path.join(vaults[i], NOTE), "utf8")

try {
  for (const b of [HOST, OTHER]) await until(async () => (await fetch(`${b}api/machines/self`)).ok, 60_000, 250)
  // (as the user's own vau, which needs no yes from the phone)
  const made = await (await fetch(`${HOST}api/ops/share.create`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli" },
    body: JSON.stringify({ folder: "Qa bridge", guest: "Ada Lovelace", role: "edit", days: 1 }) })).json()
  const link = made.result?.link ?? made.link
  check("the host shares the folder", typeof link === "string" && link.includes("/s/"), made)
  const folders = await (await fetch(`${HOST}api/share/folders`)).json()
  check("the host says what it shares", folders.folders?.includes("Qa bridge"), folders)

  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const mine = watch(await ctx.newPage(), { label: "other machine" })
  await mine.goto(`${OTHER}#file/${encodeURIComponent(NOTE)}`)
  const editor = (p) => p.locator(".cm-content").first()
  await editor(mine).waitFor({ timeout: 60_000 })
  const guestCtx = await browser.newContext({ viewport: { width: 1200, height: 800 } })
  const theirs = watch(await guestCtx.newPage(), { label: "guest" })
  await theirs.goto(link)
  await theirs.goto(`${PUB}/s/${made.result?.id ?? made.id}/#file/${encodeURIComponent("Plan.md")}`)
  await editor(theirs).waitFor({ timeout: 60_000 })
  // (the other machine asks what's shared as the note opens, then moves it there)
  await wait(3000)

  await editor(mine).click(); await mine.keyboard.press("ControlOrMeta+End"); await mine.keyboard.type("\nTyped on the other machine.")
  const seen = await until(async () => (await editor(theirs).innerText()).includes("Typed on the other machine."), 10_000)
  check("what the other machine's app types shows live at the guest's", seen, await editor(theirs).innerText())
  await editor(theirs).click(); await theirs.keyboard.press("ControlOrMeta+End"); await theirs.keyboard.type("\nTyped by the guest.")
  const back = await until(async () => (await editor(mine).innerText()).includes("Typed by the guest."), 10_000)
  check("...and the guest's at the other machine's", back, await editor(mine).innerText())
  const names = async (p) => p.evaluate(() => [...document.querySelectorAll(".cm-ySelectionInfo")].map((e) => e.textContent))
  check("each sees the other's caret, named", await until(async () => (await names(mine)).includes("Ada Lovelace") && (await names(theirs)).includes("Owner"), 10_000),
    [await names(mine), await names(theirs)])
  await wait(2500)
  check("the host wrote both", await until(() => onDisk(0).includes("Typed on the other machine.") && onDisk(0).includes("Typed by the guest."), 10_000), onDisk(0))
  check("the other machine never wrote it (no copy fighting the host's)", onDisk(1) === TEXT, onDisk(1))
  const blame = await (await fetch(`${HOST}api/ops/provenance.blame`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: NOTE }) })).json()
  const runs = blame.result?.runs ?? blame.runs ?? []
  check("the guest's line is theirs, the other machine's the user's", runs.some((r) => r.guest && r.text.includes("Typed by the guest")) && !runs.some((r) => r.guest && r.text.includes("Typed on the other machine")), runs)

  // The host gone: the other machine's app types on its own (saved there), and nothing typed is lost.
  const [, hostProc] = procs[0]
  hostProc.kill()
  await wait(1500)
  await editor(mine).click(); await mine.keyboard.press("ControlOrMeta+End"); await mine.keyboard.type("\nTyped while the host was away.")
  check("the host gone, the other machine saves it itself", await until(() => onDisk(1).includes("Typed while the host was away."), 10_000), onDisk(1))
  // Back: the note goes there again, with what was typed meanwhile (no sync between the two copies here: only the bridge).
  procs[0] = [hostPort, testServer({ stdio: "ignore", env: { ...process.env, PORT: String(hostPort), HOST: "127.0.0.1", VAULTITE_VAULT: vaults[0], VAULTITE_LOCAL: locals[0] } })]
  check("the host back, what was typed meanwhile reaches it", await until(() => onDisk(0).includes("Typed while the host was away."), 60_000, 500), onDisk(0))
  await editor(mine).click(); await mine.keyboard.press("ControlOrMeta+End"); await mine.keyboard.type("\nTyped once it was back.")
  check("...and typing goes there again, not here", await until(() => onDisk(0).includes("Typed once it was back."), 10_000) && !onDisk(1).includes("Typed once it was back."), [onDisk(0), onDisk(1)])
  check("nothing typed was lost or doubled", (await editor(mine).innerText()).split("Typed on the other machine.").length === 2 && onDisk(0).split("Typed while the host was away.").length === 2, onDisk(0))
  await ctx.close(); await guestCtx.close()
} finally {
  stop()
}
await done()
