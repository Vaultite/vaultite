// oxlint-disable-next-line vaultite/comment-lines -- qa() reads its arguments from this usage line
//   node web/qa/toasts.mjs <base url> (components/Toast.tsx core/notify.ts index.css)
import { qa, until } from "./lib/qa.mjs"
const { args: [B], browser, check, watch, noErrors, done } = await qa(import.meta.url)

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2, reducedMotion: "reduce" })
await ctx.addInitScript(() => sessionStorage.setItem("vaultite.safe", "1"))
const page = watch(await ctx.newPage(), { console: true, ignore: /WebSocket|ERR_CONNECTION|Failed to load resource/ })
const toasts = page.locator("[data-sonner-toast]")
const stays = toasts.filter({ hasText: "Vault plugins are off" })
const front = page.locator("[data-sonner-toast][data-front=true]")
const heightAtRest = async (over) => {
  if (over) await front.hover({ position: { x: 30, y: 12 } })
  else await page.mouse.move(5, 300)
  const still = await until(() => stays.evaluate((e, want) => e.dataset.expanded === want && !e.getAnimations().length, String(over)), 5000)
  return still ? (await stays.boundingBox())?.height : undefined
}

try {
  await page.goto(B)
  check("two toasts, one behind the other", await until(async () => (await toasts.count()) === 2 && await stays.getAttribute("data-front") === "false", 20000), await toasts.allInnerTexts())
  const fanned = await heightAtRest(true)
  await page.mouse.move(5, 300)
  check("the front one goes, the one behind stays", await until(async () => (await toasts.count()) === 1 && (await stays.count()) === 1, 20000), await toasts.allInnerTexts())
  const alone = await heightAtRest(false), hovered = await heightAtRest(true)
  check("a toast is as tall in the stack, alone and hovered", !!alone && fanned === alone && hovered === alone, { fanned, alone, hovered })
  for (const width of [390, 240]) {
    await page.setViewportSize({ width, height: 800 })
    const rest = await heightAtRest(false), over = await heightAtRest(true)
    check(`hovered, it's as tall at ${width} wide`, !!rest && over === rest, { rest, over })
  }
  noErrors()
} finally {
  await done()
}
