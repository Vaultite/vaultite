// The iPhone app's first screen (phone.html, shown at every launch) with a stand-in for its native shell: it opens the
// last server, or lists them to pick, add or remove; files kept on the phone have their menu; and it loads only its own
// code, not the app's. WRITES: nothing.
//   node web/qa/phonelauncher.mjs <base url>
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B0], browser, check, watch, done } = await qa(import.meta.url)
const B = B0.endsWith("/") ? B0 : `${B0}/`

/** Capacitor's bridge, as the iPhone app injects it: each call to the Shell plugin kept in `__shell`. */
const SHELL = `(() => {
  const calls = window.__shell = []
  const answers = {
    servers: { servers: [{ url: "https://studio.example.ts.net", name: "studio" }, { url: "https://mini.example.ts.net", name: "mini" }], last: "https://studio.example.ts.net" },
    downloads: { items: [{ path: "Videos/Talk.mp4", title: "Talk", size: 52000000, got: 52000000, done: true }] },
    probe: { ok: true },
  }
  window.Capacitor = {
    isNativePlatform: () => true, isPluginAvailable: (n) => n === "Shell", PluginHeaders: [{ name: "Shell", methods: [] }],
    nativePromise: (plugin, method, options) => { calls.push({ method, options }); return Promise.resolve(answers[method]) },
  }
})()`
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 })
await ctx.addInitScript(SHELL)
const page = watch(await ctx.newPage())
const calls = (method) => page.evaluate((m) => window.__shell.filter((c) => c.method === m).map((c) => c.options), method)

// A launch: the last server, checked, then opened.
await page.goto(`${B}phone.html`)
check("a launch opens the last server once it answers", await until(async () => (await calls("open")).some((o) => o.url === "https://studio.example.ts.net"), 10_000),
  await page.evaluate(() => window.__shell))
check("...checked first", (await calls("probe")).some((o) => o.url === "https://studio.example.ts.net"))

// Switch server…: the list, to pick from.
await page.goto(`${B}phone.html?pick`)
await page.getByRole("heading", { name: "Vaultite" }).waitFor()
check("Switch server lists the servers", await page.getByText("mini", { exact: true }).isVisible() && await page.getByText("studio", { exact: true }).isVisible())
check("...and doesn't open one by itself", (await calls("open")).length === 0)
const js = await page.evaluate(() => performance.getEntriesByType("resource").filter((r) => /\.js$/.test(new URL(r.name).pathname)).reduce((n, r) => n + r.decodedBodySize, 0))
check("it loads only its own code, not the app's", js > 0 && js < 700 * 1024, `${Math.round(js / 1024)} KB`)

// A server's menu: Remove.
await page.getByRole("button", { name: "More for mini" }).click()
await page.getByRole("menuitem", { name: "Remove" }).click()
check("a server's menu removes it", await until(async () => (await calls("setServers")).some((o) => o.servers.length === 1 && o.servers[0].name === "studio"), 3000))
check("...from the list", await until(async () => !(await page.getByText("mini", { exact: true }).count()), 3000))

// A file kept on the phone: its menu.
await page.getByRole("button", { name: "More for Talk" }).click()
check("a kept file's menu has Remove from this iPhone", await page.getByRole("menuitem", { name: "Remove from this iPhone" }).isVisible())
await page.keyboard.press("Escape")
await wait(300)

// Adding one: https unless typed otherwise, checked, then opened.
await page.getByLabel("Server address").fill("laptop.example.ts.net:8447")
await page.getByRole("button", { name: "Add", exact: true }).click()
check("an added server opens", await until(async () => (await calls("open")).some((o) => o.url === "https://laptop.example.ts.net:8447"), 5000), await calls("open"))

await ctx.close()
await done()
