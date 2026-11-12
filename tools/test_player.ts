import { chromium } from "playwright-core"
import { FILL, FULL_GUARD } from "../electron/playerpage.ts"
import { check, exit, summary } from "./test/lib.ts"
const began = Date.now()

const browser = await chromium.launch({ headless: true })
try {
  const page = await browser.newPage({ viewport: { width: 800, height: 450 } })
  await page.setContent(`<body style="margin:0"><div id="player" style="width:640px;height:360px"><video muted style="width:640px;height:360px"></video></div>
<button id="go" style="position:fixed;bottom:0">go</button></body>`)
  const outcome = await page.evaluate(([fill, guard]) => {
    const grantedAfterElectronsWindowResizesRefusingAPopover = function (this: Element) {
      return new Promise<void>((ok, no) => setTimeout(() => this.matches(":popover-open") ? no(new Error("already open as a Popover")) : ok(), 2500))
    }
    Element.prototype.requestFullscreen = grantedAfterElectronsWindowResizesRefusingAPopover
    new Function(fill)()
    new Function(guard)()
    const held = document.querySelector("[data-vaultite-player]")
    if (!held?.matches(":popover-open")) return Promise.resolve("nothing held")
    return held.requestFullscreen().then(() => "granted", (e: Error) => `refused: ${e.message}`)
  }, [`return ${FILL}`, `return ${FULL_GUARD}`])
  check("player: the site's full screen of the box it holds is granted, however late (not held again meanwhile)", outcome === "granted", outcome)
} finally {
  await browser.close()
}
await exit(summary("player", began))
