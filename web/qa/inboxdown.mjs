// The inbox (plugins/core/inbox) on a phone that can't reach it: Try again, not Loading… for ever; a list kept, said to be
// stale; followed again once the app's connection is back. WRITES an inbox event.   node web/qa/inboxdown.mjs <base url> [out dir]
import { mkdirSync } from "node:fs"
import { apiAt, qa, until } from "./lib/qa.mjs"
import { app } from "./lib/app.mjs"
import { routeSocket } from "./lib/sockets.mjs"
const { args: [B, OUT = "/tmp/phone-chat-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const api = apiAt(B)
await api("DELETE", "inbox/events")
const TITLE = "Lighthouse needs you in the browser"
await api("POST", "inbox/events", { source: "browser", kind: "waiting", title: TITLE })

const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true })
let refuse = true, inbox = null, events = null
const tries = []
await routeSocket(ctx, /\/api\/inbox\/live/, (ws) => {
  tries.push(Date.now())
  if (refuse) return ws.close()
  inbox = ws
  ws.connectToServer()
})
await routeSocket(ctx, /\/api\/events/, (ws) => { events = ws; ws.connectToServer() })
const page = watch(await ctx.newPage(), { ignore: /favicon|Failed to load resource|WebSocket/ }), ui = app(page)
const down = page.locator("[data-inbox-down]"), stale = page.locator("[data-inbox-stale]"), row = page.locator("[data-inbox-view]").getByText(TITLE)

await page.goto(`${B}#view/inbox`)
await page.locator("[data-inbox-view]").waitFor({ timeout: 30_000 })
check("never reached: it says so instead of loading for ever", await down.waitFor({ timeout: 30_000 }).then(() => true, () => false))
check("never reached: what failed, plainly, with Try again", (await down.innerText()).includes("Couldn't load the inbox: the server didn't answer") &&
  await down.getByRole("button", { name: "Try again" }).count() === 1, await down.innerText())
check("never reached: no Loading… left with it", await page.locator("[data-inbox-view] [aria-busy]").count() === 0)
await ui.idle()
await page.screenshot({ path: `${OUT}inbox-offline.png` })

refuse = false
await down.getByRole("button", { name: "Try again" }).tap()
check("Try again: the list comes", await row.waitFor({ timeout: 10_000 }).then(() => true, () => false))
check("Try again: the error's gone", await down.count() === 0 && await stale.count() === 0)

refuse = true
let mark = tries.length
inbox.close()
check("dropped: once it can't get back, a quiet line says the list may be out of date", await stale.waitFor({ timeout: 30_000 }).then(() => true, () => false))
check("dropped: the list stays, no error in its place", await row.count() === 1 && await down.count() === 0)
await ui.idle()
await page.screenshot({ path: `${OUT}inbox-stale.png` })

await until(() => tries.length >= mark + 5, 40_000)
refuse = false
const before = tries.length
events.close()
check("app reconnected: the inbox follows again with it", await stale.waitFor({ state: "detached", timeout: 8_000 }).then(() => true, () => false))
check("...through the app's reconnect, not its own next try (16 s off)", tries.length === before + 1 && Date.now() - tries.at(-1) < 8_000, { tries: tries.length - before })

refuse = true
mark = tries.length
inbox.close()
await until(() => tries.length >= mark + 5, 40_000)
refuse = false
const was = tries.length
await page.evaluate(() => dispatchEvent(new Event("online")))
check("online again: the inbox follows again at once, not at its own next try", await stale.waitFor({ state: "detached", timeout: 5_000 }).then(() => true, () => false) && tries.length === was + 1)

await ctx.close()
await api("DELETE", "inbox/events")
await done()
