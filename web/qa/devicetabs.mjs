// The Tabs panel's other devices (plugins/core/tabs). Two devices (browser contexts: a desktop one and a phone one with
// an iPhone's user agent), each with the Tabs panel: what one has open shows under the other's tabs, named by its
// browser, and not under its own (the phone's first tab is the vault's start page); a click there opens it on this device; a tab closed there goes from the other's list;
// the Tabs heading's right-click hides and shows other devices' tabs; the phone, open, shows as open: a tab closed on it
// from the desktop closes there, one moved opens here; renamed, it keeps the name; Devices lists both; closed, it's no
// longer open; "Forget this device" takes it away. Writes sidebars.json (put back) and the devices' files: throwaway server only.
//   node web/qa/devicetabs.mjs <base url> <vault path> [out dir]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, VAULT, OUT = "/tmp/devicetabs-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const sidebarsPath = path.join(VAULT, ".vaultite", "sidebars.json")
const sidebarsWas = existsSync(sidebarsPath) ? readFileSync(sidebarsPath, "utf8") : null
writeFileSync(sidebarsPath, JSON.stringify({ left: ["tabs:tabs", "files:files"], right: [], collapsed: [] }) + "\n")
const devices = path.join(VAULT, ".vaultite", "plugins", "tabs")
rmSync(devices, { recursive: true, force: true })
const notes = readdirSync(path.join(VAULT, "Notes")).filter((f) => f.endsWith(".md")).slice(0, 2).map((f) => `Notes/${f}`)
if (notes.length < 2) { console.error("needs a vault with two notes in Notes/"); process.exit(2) }
const stem = (p) => p.split("/").pop().replace(/\.md$/, "")

try {
  const desk = await browser.newContext({ viewport: { width: 1280, height: 800 } })
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true,
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" })
  // (automated browsers aren't devices: these stand for a person's)
  for (const c of [desk, phone]) await c.addInitScript(() => Object.defineProperty(Navigator.prototype, "webdriver", { get: () => false }))
  const A = await desk.newPage(), P = await phone.newPage()
  for (const p of [A, P]) watch(p)

  await A.goto(`${B}/#file/${encodeURIComponent(notes[0])}`)
  await A.waitForSelector("[data-tabs-panel]")
  await A.click("[data-tab-bar] button[aria-label='New tab']"); await wait(200)
  await A.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, notes[1])
  await P.goto(`${B}/#new`); await wait(1500)

  const files = () => existsSync(devices) ? readdirSync(devices).filter((f) => f.startsWith("device-")) : []
  check("each device saves its own file", (await until(() => files().length === 2 ? true : null, 8000)) === true, files())

  // The phone's tabs list (its drawer has the same panel): the desktop's tabs, named by its browser.
  await P.goto(`${B}/#view/tabs`)
  const theirs = (page) => page.$$eval("[data-device-tabs] [data-device]", (els) => els.map((d) => ({
    name: d.firstElementChild.textContent, rows: [...d.querySelectorAll("a")].map((a) => a.textContent.trim()) })))
  const seen = await until(async () => { const x = await theirs(P); return x.length && x[0].rows.length === 2 ? x : null }, 8000)
  check("the phone lists the desktop's tabs", JSON.stringify(seen?.[0]?.rows) === JSON.stringify(notes.map(stem)), seen)
  const os = { darwin: "Mac", win32: "Windows" }[process.platform] ?? "Linux"
  check("named by its browser", new RegExp(`Chrom(e|ium) on ${os}`).test(seen?.[0]?.name ?? ""), seen?.[0]?.name)
  await P.screenshot({ path: `${OUT}phone.png` })

  // The desktop never lists itself.
  const mine = await theirs(A)
  check("a device doesn't list itself", !mine.some((d) => /Chrom(e|ium) on/.test(d.name)), mine)

  // A click opens it here.
  await P.click(`[data-device-tabs] a:has-text("${stem(notes[1])}")`)
  const opened = await until(() => P.evaluate(() => decodeURIComponent(location.hash)).then((h) => h.includes(stem(notes[1])) ? h : null), 8000)
  check("a click opens it on this device", !!opened, opened)
  const back = await until(async () => { const x = await theirs(A); return x[0]?.rows.includes(stem(notes[1])) ? x : null }, 8000)
  check("now the desktop lists the phone's tab", back?.[0]?.rows?.includes(stem(notes[1])) && /Safari on iPhone/.test(back[0].name), back)
  await A.screenshot({ path: `${OUT}desktop.png` })

  // A tab closed on the desktop goes from the phone's list.
  await A.hover("[data-open-tabs] [data-open-tab] >> nth=0")
  await A.click("[data-open-tabs] [data-open-tab] >> nth=0 >> button[aria-label^=Close]")
  await P.goto(`${B}/#view/tabs`)
  const after = await until(async () => { const x = await theirs(P); return x[0]?.rows.length === 1 ? x : null }, 8000)
  check("a closed tab goes from the other device's list", after?.[0]?.rows?.[0] === stem(notes[1]), after)

  // Right-clicking the Tabs heading hides other devices' tabs, and shows them again.
  const others = async (on) => {
    await A.click("[data-tabs-panel] [data-heading=Tabs]", { button: "right" })
    await A.click("text=Other devices' tabs")
    return until(async () => (((await theirs(A)).length > 0) === on ? true : null), 8000)
  }
  check("the Tabs heading's menu hides other devices' tabs", (await others(false)) === true, await theirs(A))
  check("and shows them again", (await others(true)) === true, await theirs(A))

  // The phone is open: from the desktop, a tab closes there, and one moves here.
  const phoneOn = (page) => page.$eval("[data-device-tabs] [data-device]", (d) => d.hasAttribute("data-live")).catch(() => false)
  check("the phone shows as open now", (await until(async () => ((await phoneOn(A)) ? true : null), 20000)) === true, await theirs(A))
  const rowMenu = async (name, item) => {
    await A.click(`[data-device-tabs] [data-device] a:has-text("${name}")`, { button: "right" })
    await A.click(`text=${item}`)
  }
  await rowMenu(stem(notes[1]), "Close on Safari on iPhone")
  const shut = await until(() => P.$$eval("[data-open-tab]", (els) => els.map((e) => e.textContent)).then((t) => (t.some((x) => x.includes(stem(notes[1]))) ? null : t)), 8000)
  check("Close on <device> closes the tab on that device", !!shut, shut)
  await P.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, notes[0])
  await until(async () => ((await theirs(A))[0]?.rows.includes(stem(notes[0])) ? true : null), 8000)
  await rowMenu(stem(notes[0]), "Move here")
  const moved = await until(() => A.evaluate(() => decodeURIComponent(location.hash)).then((h) => (h.includes(stem(notes[0])) ? h : null)), 8000)
  const left = await until(async () => ((await theirs(A))[0]?.rows.includes(stem(notes[0])) ? null : true), 8000)
  check("Move here opens it here and closes it there", !!moved && left === true, [moved, await theirs(A)])

  // Renamed, it keeps the name (with a tab open again: a device with none isn't listed).
  await P.evaluate((p) => { location.hash = `#file/${encodeURIComponent(p)}` }, notes[1])
  await until(async () => ((await theirs(A))[0]?.rows.includes(stem(notes[1])) ? true : null), 8000)
  await A.click("[data-device-tabs] [data-device] > div:first-child", { button: "right" })
  await A.click("text=Rename…")
  await A.fill("[data-device-tabs] input[aria-label='Device name']", "Kitchen phone")
  await A.press("[data-device-tabs] input[aria-label='Device name']", "Enter")
  const renamed = await until(async () => ((await theirs(A))[0]?.name.includes("Kitchen phone") ? true : null), 8000)
  check("a device renamed keeps its name", renamed === true, await theirs(A))
  await A.screenshot({ path: `${OUT}desktop-live.png` })

  // Devices lists both, this one marked.
  const D = await desk.newPage()
  watch(D)
  await D.goto(`${B}/#view/devices`)
  const rows = await until(() => D.$$eval("[data-device-row]", (els) => els.map((e) => e.textContent)).then((r) => (r.length === 2 && r.some((x) => x.includes("Kitchen phone")) ? r : null)), 8000)
  check("Devices lists every device, this one marked", rows?.some((r) => r.includes("This device")) && rows?.some((r) => r.includes("Kitchen phone") && r.includes("Open now")), rows)
  await D.screenshot({ path: `${OUT}devices.png` })
  await D.close()

  // Closed, the phone is no longer open.
  await P.close()
  check("a device whose windows closed isn't open", (await until(async () => ((await phoneOn(A)) ? null : true), 30000)) === true, await theirs(A))

  // Forgetting a device.
  await A.click("[data-device-tabs] [data-device] > div:first-child", { button: "right" })
  await A.click("text=Forget this device")
  const gone = await until(async () => ((await theirs(A)).length === 0 ? true : null), 8000)
  check("Forget this device takes it away", gone === true, await theirs(A))
} finally {
  await browser.close()
  if (sidebarsWas === null) rmSync(sidebarsPath, { force: true }); else writeFileSync(sidebarsPath, sidebarsWas)
}
await done()
