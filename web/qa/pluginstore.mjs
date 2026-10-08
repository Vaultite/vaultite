// The plugin directory and this machine's yes, in the app. Plugins > Browse: an index that can't be read is a quiet line;
// a made-up index (a file: the server's VAULTITE_PLUGIN_INDEX) lists by stars, New and Updated, searched, each with its
// version and what it says it does; Install fetches its made-up git repository (VAULTITE_GITHUB=file://<repos>) into
// .vaultite/plugins/, off; its switch turns it on and allows it. A newer tag shows Update; updated, it waits on the
// Plugins page and its sheet shows what changed, what it says it does, and Allow. One turned on by plugins.json alone
// (a sync, a shared vault) waits too, and runs once allowed. Phone width: nothing overflows. WRITES the vault's plugins
// and the index and repos given (throwaway server only, started with those two variables; npm run qa sets them).
//   node web/qa/pluginstore.mjs <base url> <vault path> <plugin index> <plugin repos> [out dir]
import { execFileSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"

const { args: [BASE, VAULT, INDEX, REPOS, OUT = "/tmp/pluginstore-shots/"], browser, check, watch, done } = await qa(import.meta.url)
const B = BASE.replace(/\/+$/, "")
mkdirSync(OUT, { recursive: true })
const file = (rel) => join(VAULT, rel)
const json = (rel) => { try { return JSON.parse(readFileSync(file(rel), "utf8")) } catch { return null } }
const api = async (p, body) => { const r = await fetch(`${B}/api/${p}`, body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}); return [r.status, await r.json().catch(() => null)] }
const listed = async (id) => ((await api("plugins"))[1] ?? []).find((p) => p.id === id)
const plugins = () => json(".vaultite/plugins.json") ?? {}
const putPlugins = (c) => writeFileSync(file(".vaultite/plugins.json"), JSON.stringify(c, null, 2) + "\n")

// A made-up plugin's repository: Harbor, v1.0.0 (it says it talks to a host), then v1.1.0 (it runs programs too).
const HARBOR = join(REPOS, "alicepark", "harbor")
const g = (...args) => execFileSync("git", ["-c", "user.name=Alice Park", "-c", "user.email=alice@example.com", "-c", "init.defaultBranch=main", ...args], { cwd: HARBOR, stdio: "pipe" })
const release = (version, tide, disclosures) => {
  mkdirSync(HARBOR, { recursive: true })
  writeFileSync(join(HARBOR, "manifest.json"), JSON.stringify({ id: "harbor", name: "Harbor", description: "A made-up plugin: the harbour's tides.", version, author: "Alice Park",
    repo: "alicepark/harbor", apiVersion: 1, disclosures }, null, 2))
  writeFileSync(join(HARBOR, "plugin.ts"), `import { Plugin } from "@vaultite/core/plugins.ts"\nexport const plugin = new Plugin(import.meta.url)\nplugin.route("GET", "harbor", () => ({ tide: "${tide}" }))\n`)
  if (!existsSync(join(HARBOR, ".git"))) g("init", "-q")
  g("add", "-A"); g("commit", "-q", "-m", version); g("tag", `v${version}`)
}
const entry = (o) => ({ description: "Made up.", author: "Bob Lee", version: "1.0.0", tag: "v1.0.0", stars: 1, released: "2026-01-01T00:00:00Z", created: "2025-01-01T00:00:00Z",
  pushed: "2026-01-01T00:00:00Z", issues: { open: 0, closed: 0 }, topics: ["vaultite-plugin"], disclosures: {}, readme: "", score: 10, ...o })
const writeIndex = (harborVersion) => {
  mkdirSync(dirname(INDEX), { recursive: true })
  writeFileSync(INDEX, JSON.stringify({ format: 1, generated: new Date().toISOString(), blocked: {}, plugins: [
    entry({ id: "harbor", name: "Harbor", author: "Alice Park", repo: "alicepark/harbor", version: harborVersion, tag: `v${harborVersion}`, stars: 40, released: "2026-06-01T00:00:00Z",
      description: "The harbour's tides, and when the boats leave.", icon: "anchor", tint: "teal", disclosures: { network: ["tides.example.com"], ...(harborVersion === "1.1.0" ? { shell: true } : {}) } }),
    entry({ id: "beacon", name: "Beacon", repo: "boblee/beacon", stars: 90, created: "2024-01-01T00:00:00Z", released: "2025-01-01T00:00:00Z" }),
    entry({ id: "skiff", name: "Skiff", repo: "boblee/skiff", stars: 5, created: "2026-09-01T00:00:00Z", released: "2026-09-30T00:00:00Z", description: "Small boats and their moorings." }),
  ] }))
}
const cleanup = () => {
  for (const p of [".vaultite/plugins/harbor", ".vaultite/plugins/lighthouse", ".vaultite/plugins-lock.json", ".vaultite/cache/plugin-index.json"]) rmSync(file(p), { recursive: true, force: true })
  const c = plugins(); c.enabled = (c.enabled ?? []).filter((x) => x !== "harbor" && x !== "lighthouse"); putPlugins(c)
}
cleanup()
rmSync(INDEX, { force: true })

try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  const page = watch(await ctx.newPage())
  const shot = (name) => page.screenshot({ path: `${OUT}pluginstore-${name}.png` })
  const browse = page.locator("[data-plugin-browse]")
  const rows = () => browse.locator("[data-browse-row]").evaluateAll((els) => els.map((e) => e.dataset.browseRow))
  await page.goto(`${B}/#plugins`)
  await until(() => page.locator("main").count(), 8000)
  await page.getByRole("radio", { name: "Browse" }).click()

  // ---------- an index that can't be read: a quiet line
  check("browse: an index that can't be read is a quiet line", await until(async () => (await browse.locator("[data-browse-empty]").innerText()).includes("can't be reached"), 8000),
    await browse.innerText().catch(() => ""))
  await shot("unreachable")

  // ---------- the index: sorts, search, disclosures
  writeIndex("1.0.0")
  release("1.0.0", "high", { network: ["tides.example.com"] })
  await browse.locator("[data-browse-refresh]").click()
  check("browse: by stars", await until(async () => (await rows()).join() === "beacon,harbor,skiff", 8000), await rows())
  const harborRow = browse.locator('[data-browse-row="harbor"]')
  check("browse: each with its stars, version and what it says it does", /40[\s\S]*1\.0\.0/.test(await harborRow.innerText()) &&
    (await harborRow.locator("[data-browse-discloses]").innerText()).includes("Talks to tides.example.com"), await harborRow.innerText())
  check("browse: each with its icon (a puzzle piece for one without)", await browse.locator("[data-browse-icon] svg").count() === 3 &&
    await harborRow.locator("[data-browse-icon]").evaluate((e) => getComputedStyle(e).color === getComputedStyle(document.documentElement).getPropertyValue("--teal").trim() || !!e.style.color))
  await shot("browse")
  await page.getByRole("radio", { name: "New" }).click()
  check("browse: New puts the newest first", await until(async () => (await rows())[0] === "skiff", 8000), await rows())
  await page.getByRole("radio", { name: "Updated" }).click()
  check("browse: Updated, the last released first", await until(async () => (await rows()).join() === "skiff,harbor,beacon", 8000), await rows())
  await page.getByPlaceholder("Search the directory").fill("moorings")
  check("browse: searched", await until(async () => (await rows()).join() === "skiff", 8000), await rows())
  await page.getByPlaceholder("Search the directory").fill("")
  await page.getByRole("radio", { name: "Stars" }).click()

  // ---------- install: off until turned on, which allows it here
  await harborRow.locator('[data-browse-action="install"]').click()
  check("install: its folder, off, with where it came from", await until(async () => existsSync(file(".vaultite/plugins/harbor/plugin.ts")) && json(".vaultite/plugins-lock.json")?.harbor?.tag === "v1.0.0", 8000) &&
    !(plugins().enabled ?? []).includes("harbor") && !(await listed("harbor"))?.loaded, json(".vaultite/plugins-lock.json"))
  check("install: the row says it's installed", await until(async () => (await harborRow.innerText()).includes("Installed"), 8000), await harborRow.innerText())
  check("install: nothing of it runs yet", (await api("harbor"))[0] === 404)
  await page.getByRole("radio", { name: "Installed" }).click()
  const sw = page.getByRole("switch", { name: "Harbor plugin" })
  await until(() => sw.count(), 8000)
  await sw.click()
  check("turned on here, it's allowed and runs", await until(async () => (await api("harbor"))[1]?.tide === "high", 8000), await listed("harbor"))
  await page.locator('[data-plugin-row="harbor"]').click()
  const sheet = page.locator("dialog[open]")
  check("its sheet: version, author, repository, where it came from, what it says it does", await until(async () => {
    const t = await sheet.innerText()
    return t.includes("1.0.0") && t.includes("Alice Park") && t.includes("alicepark/harbor") && t.includes("Installed from") && t.includes("Talks to tides.example.com")
  }, 8000), await sheet.innerText().catch(() => ""))
  await shot("sheet")
  await page.keyboard.press("Escape")
  await wait(400)

  // ---------- update: a newer tag; updated, it waits for this machine's yes again
  release("1.1.0", "low", { network: ["tides.example.com"], shell: true })
  writeIndex("1.1.0")
  await page.getByRole("radio", { name: "Browse" }).click()
  await browse.locator("[data-browse-refresh]").click()
  check("browse: an update out", await until(async () => (await harborRow.locator('[data-browse-action="update"]').count()) === 1, 8000), await harborRow.innerText().catch(() => ""))
  await harborRow.locator('[data-browse-action="update"]').click()
  check("update: its files are the new version's", await until(async () => json(".vaultite/plugins-lock.json")?.harbor?.version === "1.1.0" && readFileSync(file(".vaultite/plugins/harbor/plugin.ts"), "utf8").includes('"low"'), 8000))
  check("update: its new code doesn't run until allowed", await until(async () => !(await listed("harbor"))?.loaded && (await listed("harbor"))?.approval?.state === "changed", 8000) && (await api("harbor"))[0] === 404)
  await page.getByRole("radio", { name: "Installed" }).click()
  const waiting = page.locator('[data-plugin-waiting="harbor"]')
  check("update: its row says it changed and waits", await until(async () => (await waiting.innerText()).includes("Changed"), 8000), await waiting.innerText().catch(() => ""))
  await page.locator('[data-plugin-review="harbor"]').click()
  const approval = page.locator('dialog[open] [data-plugin-approval="harbor"]')
  check("update: its sheet shows what changed and what it says it does now", await until(async () => (await approval.locator("[data-plugin-changed]").innerText()).includes("plugin.ts") &&
    (await approval.locator("[data-plugin-discloses]").innerText()).includes("runs programs on this machine"), 8000), await approval.innerText().catch(() => ""))
  await shot("approval")
  await approval.locator('[data-plugin-allow="harbor"]').click()
  check("update: allowed, the new version runs", await until(async () => (await api("harbor"))[1]?.tide === "low", 8000))
  await page.keyboard.press("Escape")
  await wait(400)

  // ---------- turned on by plugins.json alone (a sync, a shared vault): waits
  cpSync(new URL("../../tools/fixtures/lighthouse/", import.meta.url).pathname, file(".vaultite/plugins/lighthouse"), { recursive: true })
  putPlugins({ ...plugins(), enabled: [...(plugins().enabled ?? []), "lighthouse"] })
  const lw = page.locator('[data-plugin-waiting="lighthouse"]')
  check("synced on: its row waits for this machine's yes", await until(async () => (await lw.innerText()).includes("Waiting for you to allow it on this machine"), 10000), await lw.innerText().catch(() => ""))
  check("synced on: nothing of it runs", (await api("lighthouse"))[0] === 404 && !(await listed("lighthouse"))?.loaded)
  check("synced on: a toast says so, with Review", await until(async () => (await page.getByText("it waits for you to allow it on this machine").count()) > 0, 8000))
  await page.locator('[data-plugin-review="lighthouse"]').click()
  const la = page.locator('dialog[open] [data-plugin-approval="lighthouse"]')
  check("synced on: its sheet says it came from elsewhere", await until(async () => (await la.innerText()).includes("this machine hasn't run it"), 8000), await la.innerText().catch(() => ""))
  await la.locator('[data-plugin-allow="lighthouse"]').click()
  check("synced on: allowed, it runs", await until(async () => (await api("lighthouse"))[0] === 200, 8000))
  await page.keyboard.press("Escape")
  await shot("installed")

  // ---------- phone
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })
  const pp = watch(await phone.newPage(), { label: "phone" })
  await pp.goto(`${B}/#plugins`)
  await until(() => pp.getByRole("radio", { name: "Browse" }).count(), 8000)
  await pp.getByRole("radio", { name: "Browse" }).tap()
  await until(() => pp.locator("[data-browse-row]").count(), 8000)
  const over = await pp.evaluate(() => document.documentElement.scrollWidth - innerWidth)
  check("phone: Browse fits the screen", over <= 0, over)
  await pp.screenshot({ path: `${OUT}pluginstore-phone.png` })
} finally {
  await browser.close()
  cleanup()
}
await done()
