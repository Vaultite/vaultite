// A shared folder end to end, as its owner and its guests see it: the owner shares it from the folder's toolbar (a link
// copied, who has access listed, roles changed), the guest opens the link in a browser (desktop and phone) and reads its
// notes, follows links, sees images, and plays an HTML page with the owner live (vau.shared()); reads outside the folder
// fail for both; a reader only watches; an editor's change is theirs. Starts its own server on a copy of the vault.
//   node web/qa/shareguest.mjs <vault copy>
import { spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import zlib from "node:zlib"
import { freePort, qa, SHOTS, until, wait } from "./lib/qa.mjs"
import { testServer } from "../../tools/test/lib.ts"

const { args: [VAULT], browser, check, watch, done } = await qa(import.meta.url)

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-qa-shareguest-"))
const [port, pubPort] = [await freePort(), await freePort()]
const B = `http://127.0.0.1:${port}/`, PUB = `http://127.0.0.1:${pubPort}`
const V = path.join(tmp, "vault"), LOCAL = path.join(tmp, "local"), F = "Music theory"
fs.cpSync(VAULT, V, { recursive: true })
fs.mkdirSync(path.join(V, ".vaultite/plugins/machines"), { recursive: true })
fs.writeFileSync(path.join(V, ".vaultite/plugins/machines/data.json"), JSON.stringify({ machines: [] }))
fs.mkdirSync(LOCAL, { recursive: true })
fs.writeFileSync(path.join(LOCAL, "config.json"), JSON.stringify({ mcp: { public: { url: PUB, port: pubPort } } }))

/** A small PNG of one colour. */
function png(w, h, [r, g, b]) {
  const crc = (buf) => { let c = ~0; for (const x of buf) { c ^= x; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)) } return ~c >>> 0 }
  const chunk = (type, data) => { const t = Buffer.concat([Buffer.from(type), data]), out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); t.copy(out, 4); out.writeUInt32BE(crc(t), 8 + data.length); return out }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  const rows = Buffer.concat(Array.from({ length: h }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))])
}
const put = (rel, text) => { fs.mkdirSync(path.dirname(path.join(V, rel)), { recursive: true }); fs.writeFileSync(path.join(V, rel), text) }
put(`${F}/Intervals.md`, "# Intervals\n\nA third up from C is E. The [[Major scale]] is built from them.\n\n![[Circle.png]]\n\n## Practice\n\n- [ ] Sing a major third\n")
put(`${F}/Scales/Major scale.md`, "# Major scale\n\nWhole, whole, half, whole, whole, whole, half. Back to [[Intervals]].\n")
put(`${F}/Chords.csv`, "name,quality\nC major,major\nA minor,minor\nG major,major\n")
fs.writeFileSync(path.join(V, F, "Circle.png"), png(120, 80, [40, 120, 220]))
put("Secret/Private.md", "PRIVATE_WORDS not shared\n")
put(`${F}/Chord quiz.html`, `<!doctype html><html><head><title>Chord quiz</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>body{font:16px system-ui;margin:16px;color:var(--vau-foreground)}button{font:inherit;padding:8px 14px;margin-right:8px}</style></head><body>
<h1 id="chord">…</h1><p><button data-a="major">Major</button><button data-a="minor">Minor</button></p><p id="answers"></p><p id="here"></p>
<script type="module">
window.__t = { changes: [] }
const chords = await vau.csv("Chords.csv")
const room = await vau.shared()
window.room = room
for (const [k, p] of [["outside", "../Secret/Private.md"], ["top", "/Secret/Private.md"]]) {
  try { await vau.read(p); __t[k] = "read" } catch (e) { __t[k] = String(e?.message ?? e) }
}
const draw = () => {
  chord.textContent = chords[(room.state.round ?? 0) % chords.length].name
  answers.textContent = Object.entries(room.state).filter(([k]) => k.startsWith("a:")).map(([, v]) => v).sort().join(" · ")
  here.textContent = room.people.map((p) => p.name).join(", ")
}
room.on("change", (s, keys, by) => { __t.changes.push({ keys, by }); draw() })
room.on("people", draw)
document.querySelectorAll("button").forEach((b) => b.onclick = () => room.set("a:" + room.me.id, room.me.name + ": " + b.dataset.a))
draw()
__t.ready = true
</script></body></html>
`)

const server = testServer({ stdio: "ignore", env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", VAULTITE_VAULT: V, VAULTITE_LOCAL: LOCAL } })
const stop = () => {
  if (server.exitCode === null) server.kill()
  try { process.kill(Number(fs.readFileSync(path.join(os.tmpdir(), `vaultite-ptyd1-vaultite-${port}.sock.pid`), "utf8"))) } catch {}
  spawnSync("tmux", ["-L", `vaultite-${port}`, "kill-server"], { stdio: "ignore" })
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 })
}
const api = async (op, body) => { const j = await (await fetch(`${B}api/ops/${op}`, { method: "POST", headers: { "Content-Type": "application/json", "X-Vaultite-Client": "cli" }, body: JSON.stringify(body) })).json(); return j.result ?? j }
const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `shareguest-${name}.png`) })
const frameOf = (p, name) => until(async () => {
  const f = p.frames().find((x) => x.url().includes("frame=1") && x.url().includes(encodeURIComponent(name)))
  return f && (await f.evaluate(() => window.__t?.ready)) ? f : null
}, 30_000, 250)

try {
  await until(async () => (await fetch(`${B}api/state`)).ok, 60_000, 250)
  fs.mkdirSync(SHOTS, { recursive: true })

  // The owner shares the folder from its page's toolbar: a name, Can edit, the link made and copied.
  const ownerCtx = await browser.newContext({ viewport: { width: 1280, height: 860 }, permissions: ["clipboard-read", "clipboard-write"] })
  const owner = watch(await ownerCtx.newPage(), { label: "owner" })
  await owner.goto(`${B}#view/${encodeURIComponent(`folder/${F}`)}`)
  await owner.locator("[data-folder-share]").first().click({ timeout: 30_000 })
  const sheet = owner.locator(`[data-share-sheet="${F}"]`)
  await sheet.waitFor()
  await sheet.locator("[data-share-guest]").fill("Ada Lovelace")
  await sheet.getByRole("radio", { name: "Can edit" }).click()
  await sheet.locator("[data-share-create]").click()
  const link = await until(() => sheet.locator("[data-share-link] input").inputValue(), 10_000)
  check("the owner shares the folder from its toolbar: a link of its own", /\/s\/[A-Za-z0-9_-]{43}$/.test(link ?? ""), link)
  check("...copied at once", await until(async () => (await owner.evaluate(() => navigator.clipboard.readText())) === link, 5000))
  check("...and Ada is listed, can edit", await until(() => sheet.locator('[data-share-row] [data-share-role="edit"]').count(), 5000) === 1)
  await shot(owner, "owner-sheet")
  await owner.keyboard.press("Escape")
  check("the tree marks the folder shared, saying with whom", await until(async () => (await owner.locator("[data-shared-mark]").first().getAttribute("data-tip")) === "Shared with Ada Lovelace", 10_000))

  // A reader too (made the way vau makes it), whose role is then changed in the sheet.
  const reader = await api("share.create", { folder: F, guest: "Bea Reader", role: "read", days: 7 })
  check("vau makes a link too", typeof reader?.link === "string", reader)

  // Ada on her laptop: the folder is her whole vault; its notes read as the app reads them; links and images work.
  const guestCtx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
  const guest = watch(await guestCtx.newPage(), { label: "guest" })
  // (what the guest's app asks that the gateway refuses: none of it should be, but a page's read outside the folder)
  const refused = []
  guest.on("response", (r) => { if (r.status() >= 400 && !r.url().includes("Private.md")) refused.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`) })
  await guest.goto(link)
  const at = new URL(guest.url()).pathname
  check("the link opens the folder's own address", /^\/s\/[A-Za-z0-9_-]{11}\/$/.test(at), guest.url())
  check("...on the folder's page, as a shared folder's link opens", await until(() => guest.evaluate(() => location.hash === "#view/folder" && !!document.querySelector("[data-folder-view]")), 30_000), await guest.evaluate(() => location.hash))
  await shot(guest, "guest-landing")
  check("her tree is the folder's notes, nothing else of the vault", await until(async () => {
    const t = await guest.locator("body").innerText()
    return t.includes("Intervals") && t.includes("Scales") && !t.includes("Secret") && !t.includes("Daily")
  }, 30_000), await guest.locator("body").innerText().catch(() => ""))
  await guest.goto(`${PUB}${at}#file/${encodeURIComponent("Intervals.md")}`)
  await guest.locator(".cm-content").first().waitFor({ timeout: 30_000 })
  check("a note reads as in the app, its image drawn", await until(() => guest.evaluate(() => [...document.querySelectorAll("img")].some((i) => /Circle\.png/.test(i.src) && i.naturalWidth === 120)), 15_000))
  await shot(guest, "guest-note")
  await guest.locator(".cm-content").getByText("Major scale").first().click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] }).catch(() => {})
  check("a link goes to the note it names, in the folder", await until(() => guest.evaluate(() => decodeURIComponent(location.hash).includes("Scales/Major scale.md")), 10_000), await guest.evaluate(() => location.hash))

  // The page, played together: the owner in the app, Ada through her link, each seeing the other's answers live.
  await owner.goto("about:blank")
  await owner.goto(`${B}#file/${encodeURIComponent(`${F}/Chord quiz.html`)}`)
  await guest.goto("about:blank")
  await guest.goto(`${PUB}${at}#file/${encodeURIComponent("Chord quiz.html")}`)
  const [mine, theirs] = [await frameOf(owner, "Chord quiz.html"), await frameOf(guest, "Chord quiz.html")]
  check("the page runs for both, reading the folder's CSV", !!mine && !!theirs && (await theirs.evaluate(() => document.getElementById("chord").textContent)) === "C major")
  check("each sees the other here, by name", await until(async () => (await theirs.evaluate(() => window.room.people.map((p) => p.name).sort().join()))?.includes("Ada Lovelace")
    && (await mine.evaluate(() => window.room.people.length)) === 2 && (await theirs.evaluate(() => window.room.people.length)) === 2, 10_000),
    [await mine?.evaluate(() => window.room.people), await theirs?.evaluate(() => window.room.people)])
  await theirs.locator('button[data-a="minor"]').click()
  check("Ada's answer shows on the owner's page", await until(() => mine.evaluate(() => document.getElementById("answers").textContent.includes("Ada Lovelace: minor")), 10_000))
  await mine.locator('button[data-a="major"]').click()
  check("...and the owner's on Ada's", await until(() => theirs.evaluate(() => document.getElementById("answers").textContent.includes(": major")), 10_000))
  const side = path.join(V, `.vaultite/artifacts/${F}/Chord quiz.html.shared.json`)
  const kept = () => { try { return JSON.parse(fs.readFileSync(side, "utf8")) } catch { return {} } }
  check("kept beside the page, under the vault's path", await until(() => Object.values(kept()).some((v) => String(v).includes("Ada Lovelace: minor")), 5000), kept())
  const reads = { owner: await mine.evaluate(() => [window.__t.outside, window.__t.top]), guest: await theirs.evaluate(() => [window.__t.outside, window.__t.top]) }
  check("neither one's page reads outside the folder (the owner's either: Ada sets what it does)", [...reads.owner, ...reads.guest].every((r) => r !== "read"), reads)
  await shot(owner, "owner-page")
  await shot(guest, "guest-page")

  // Ada on her phone: the same folder, the same page, live.
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" })
  const phone = watch(await phoneCtx.newPage(), { label: "guest phone" })
  await phone.goto(link)
  await phone.goto(`${PUB}${at}#file/${encodeURIComponent("Intervals.md")}`)
  await phone.locator(".cm-content").first().waitFor({ timeout: 30_000 })
  check("on a phone, the note fits the screen", await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await shot(phone, "phone-note")
  await phone.goto("about:blank")
  await phone.goto(`${PUB}${at}#file/${encodeURIComponent("Chord quiz.html")}`)
  const pf = await frameOf(phone, "Chord quiz.html")
  check("...and the page plays there too, with the answers so far", !!pf && await until(() => pf.evaluate(() => document.getElementById("answers").textContent.includes("Ada Lovelace: minor")), 10_000))
  check("her phone and laptop are one person in the page", await until(async () => (await mine.evaluate(() => window.room.people.length)) === 2, 5000), await mine.evaluate(() => window.room.people))
  await shot(phone, "phone-page")

  // Bea may only view: she watches the page live, and her answer isn't kept.
  const beaCtx = await browser.newContext({ viewport: { width: 1100, height: 800 } })
  const bea = watch(await beaCtx.newPage(), { label: "reader" })
  await bea.goto(reader.link)
  const beaAt = new URL(bea.url()).pathname
  await bea.goto(`${PUB}${beaAt}#file/${encodeURIComponent("Chord quiz.html")}`)
  const bf = await frameOf(bea, "Chord quiz.html")
  check("a reader sees the page live", !!bf && await until(() => bf.evaluate(() => document.getElementById("answers").textContent.includes("Ada Lovelace: minor")), 10_000))
  await bf.locator('button[data-a="major"]').click()
  await wait(1500)
  check("...and changes nothing in it", !(await mine.evaluate(() => document.getElementById("answers").textContent)).includes("Bea Reader")
    && !(await bf.evaluate(() => document.getElementById("answers").textContent)).includes("Bea Reader"), await mine.evaluate(() => document.getElementById("answers").textContent))

  // Ada's edit lands in the file, as hers.
  await guest.goto("about:blank")
  await guest.goto(`${PUB}${at}#file/${encodeURIComponent("Intervals.md")}`)
  const ed = guest.locator(".cm-content").first()
  await ed.waitFor({ timeout: 30_000 })
  await ed.click()
  await guest.keyboard.press("ControlOrMeta+End")
  await guest.keyboard.type("\nAda: a fifth up from C is G.")
  const file = path.join(V, F, "Intervals.md")
  check("Ada's edit is written to the owner's file", await until(() => fs.readFileSync(file, "utf8").includes("a fifth up from C is G"), 15_000), fs.readFileSync(file, "utf8"))
  const blame = await api("provenance.blame", { path: `${F}/Intervals.md` })
  check("...and marked hers", (blame?.runs ?? []).some((r) => r.guest && r.text.includes("fifth up")), blame)

  // The owner makes Bea an editor in the sheet; then takes Ada's access away: her page stops at once.
  await owner.goto(`${B}#view/${encodeURIComponent(`folder/${F}`)}`)
  await owner.locator("[data-folder-share]").first().click({ timeout: 30_000 })
  await sheet.waitFor()
  await sheet.locator(`[data-share-row="${reader.id}"] [data-share-role]`).click()
  await owner.getByRole("menuitemradio", { name: "Can edit" }).click()
  check("the owner changes what Bea may do", await until(() => sheet.locator(`[data-share-row="${reader.id}"] [data-share-role="edit"]`).count(), 5000) === 1)
  check("...and Bea's open app says so", await until(() => bea.getByText("You can now edit this folder").count(), 10_000) > 0)
  const ada = sheet.locator('[data-share-row]').filter({ hasText: "Ada Lovelace" })
  await ada.locator("[data-share-role]").click()
  await owner.getByRole("menuitem", { name: "Remove access" }).click()
  await owner.getByRole("button", { name: "Remove" }).click()
  check("Ada's access goes", await until(async () => (await sheet.locator("[data-share-row]").count()) === 1, 5000))
  check("...her page goes offline", await until(() => pf.evaluate(() => window.room.online === false), 10_000))
  const gone = await fetch(`${PUB}${at}api/state`, { headers: { cookie: (await phoneCtx.cookies()).map((c) => `${c.name}=${c.value}`).join("; ") } })
  check("...and her link opens nothing", gone.status === 401, gone.status)
  check("the gateway refused nothing the guest's app asked for", !refused.filter((r) => !r.startsWith("401")).length, refused)
  await Promise.all([ownerCtx, guestCtx, phoneCtx, beaCtx].map((c) => c.close()))
} finally {
  stop()
}
await done()
