import { z } from "zod"
import { headless } from "../../../core/headless.ts"

const EVALUATED = z.object({ result: z.object({ value: z.unknown() }).partial().optional(), exceptionDetails: z.object({ text: z.string().optional() }).optional() })
const RECT = z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() })
const SIZE = z.object({ w: z.number(), h: z.number() })

export type Shot = { png: Buffer; width: number; height: number }
export const MOST = 12

export async function pictures(o: { url: string; width: number; height: number; selector?: string; full?: boolean; dark?: boolean; scale?: number }): Promise<Shot[]> {
  const scale = o.scale ?? 2
  const b = await headless({ width: o.width, height: o.height })
  try {
    const p = b.page
    await p.send("Page.enable"); await p.send("Runtime.enable")
    await p.send("Emulation.setDeviceMetricsOverride", { width: o.width, height: o.height, deviceScaleFactor: scale, mobile: false })
    await p.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: o.dark ? "dark" : "light" }, { name: "prefers-reduced-motion", value: "reduce" }] })
    const loaded = new Promise<void>((ok) => p.on("Page.loadEventFired", () => ok()))
    const nav = await p.send("Page.navigate", { url: o.url })
    if (nav.errorText) throw new Error(`couldn't open ${o.url}: ${nav.errorText}`)
    await Promise.race([loaded, sleep(15_000)])
    const js = async (expr: string) => {
      const r = EVALUATED.parse(await p.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }))
      if (r.exceptionDetails) throw new Error(`the page: ${r.exceptionDetails.text}`)
      return r.result?.value
    }
    const drawn = o.selector
      ? `document.URL !== "about:blank" && [...document.querySelectorAll(${JSON.stringify(o.selector)})].some((e) => e.getBoundingClientRect().width > 0)`
      : `document.URL !== "about:blank" && !!document.body && document.body.innerText.trim().length > 0`
    for (let i = 0; i < 120 && !(await js(drawn)); i++) await sleep(250)
    await js("document.fonts ? document.fonts.ready.then(() => true) : true")
    await sleep(800)
    type Rect = z.infer<typeof RECT>
    let rects: Rect[]
    if (o.selector) {
      rects = await js(`[...document.querySelectorAll(${JSON.stringify(o.selector)})].slice(0, ${MOST}).map((e) => { const r = e.getBoundingClientRect(); return { x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height } }).filter((r) => r.w > 0 && r.h > 0)`).then((v) => z.array(RECT).parse(v))
      if (!rects.length) throw new Error(`nothing on the page matches ${o.selector}`)
    } else if (o.full) {
      const size = SIZE.parse(await js("({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight })"))
      rects = [{ x: 0, y: 0, w: Math.max(o.width, size.w), h: Math.min(size.h, 16_000) }]
    } else rects = [{ x: 0, y: 0, w: o.width, h: o.height }]
    const out: Shot[] = []
    for (const r of rects) {
      const shot = await p.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: !!(o.selector || o.full), clip: { x: r.x, y: r.y, width: r.w, height: r.h, scale: 1 } })
      out.push({ png: Buffer.from(String(shot.data), "base64"), width: Math.round(r.w), height: Math.round(r.h) })
    }
    return out
  } finally {
    await b.quit()
  }
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
