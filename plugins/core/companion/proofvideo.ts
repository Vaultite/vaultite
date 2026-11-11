// A job's proof as a video: its tour played on the worker's own copy of the change (a dev server's address) in a
// headless Chrome, never on the user's screen and with no sound, its marks and each step's words drawn in, as an mp4.
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { type Cdp, chromePath, headless } from "../../../core/headless.ts"
import type { Do, Step, Tour } from "./tour.ts"
import { FLIPS, holdMs } from "./proof.ts"

/** The frame a proof is recorded at (CSS pixels), and how many frames a second: small files, still sharp text. */
export const SIZE = { width: 1280, height: 800 }
const FPS = 15
/** The most a proof runs: a short video, a few MB. */
const MOST_MS = 120_000

/** ffmpeg, from PATH or where Homebrew and Linux put it. */
export function ffmpegPath() {
  const dirs = [...(process.env.PATH ?? "").split(path.delimiter), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
  return dirs.map((d) => path.join(d, "ffmpeg")).find((p) => fs.existsSync(p)) ?? null
}

/** The words a do or a wait clicks or types into, in the order the step does them: a demo does what guide waits for. */
export function actsOf(s: Pick<Step, "do" | "wait" | "tags">): Do[] {
  // (a bare click: on the step's first thing)
  const thing = s.tags.map((g) => ("find" in g.at ? g.at.find : "")).find(Boolean)
  const clicks = s.wait?.any.length === 1 ? s.wait.any[0].flatMap((c) => { const text = c.kind === "click" ? c.text ?? thing : undefined; return text ? [{ action: "click" as const, text }] : [] }) : []
  return [...clicks, ...(s.do ?? [])]
}

/** The address a proof plays at: `url` itself, or a note or page (`open`) of the Vaultite served there. */
export function proofUrl(url: string, open?: string) {
  if (!open || /^https?:\/\//i.test(open)) return open || url
  const base = url.replace(/#.*$/, "").replace(/\/+$/, "")
  return /\.\w+$/.test(open) ? `${base}/#file/${encodeURIComponent(open)}` : `${base}/#${open.replace(/^#/, "")}`
}

/** What the page is given: finding a thing by its words (the smallest that says them, its label first), the marks, the
 *  step's words as a caption, a before picture over its thing, a before and after slide. */
const PAGE = String.raw`(() => {
  if (window.__proof) return
  const norm = (s) => (s || "").replace(/\s+/g, " ").trim().toLowerCase()
  const root = document.createElement("div")
  root.id = "__proof"
  root.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647;font:500 15px -apple-system,system-ui,sans-serif"
  document.documentElement.appendChild(root)
  const tint = "#f97316"
  const shown = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 1 && r.height > 1 && cs.visibility !== "hidden" && cs.display !== "none" && Number(cs.opacity) > 0.05 }
  function find(words) {
    const w = norm(words); if (!w) return null
    let best = null
    for (const el of document.querySelectorAll("body *")) {
      if (root.contains(el) || !shown(el)) continue
      const label = norm(el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || el.getAttribute("alt") || "")
      const text = norm(el.innerText)
      const score = label === w ? 0 : text === w ? 1 : label.startsWith(w) ? 2 : text.startsWith(w) ? 3 : label.includes(w) ? 4 : text.includes(w) ? 5 : -1
      if (score < 0) continue
      const r = el.getBoundingClientRect(), area = r.width * r.height
      if (!best || score < best.score || (score === best.score && area < best.area)) best = { el, score, area }
    }
    if (!best) return null
    // (kept clear of the caption's band at the bottom: one near an edge comes to the middle)
    const was = best.el.getBoundingClientRect()
    if (was.top < 50 || was.bottom > innerHeight - 150) best.el.scrollIntoView({ block: "center", inline: "nearest" })
    const r = best.el.getBoundingClientRect()
    return { x: r.left, y: r.top, w: r.width, h: r.height }
  }
  const box = (css) => { const d = document.createElement("div"); d.style.cssText = "position:absolute;box-sizing:border-box;" + css; root.appendChild(d); return d }
  function mark(kind, r, label) {
    const pad = 6
    if (kind === "point") {
      const a = box("left:" + (r.x + r.w / 2 - 6) + "px;top:" + (r.y + r.h + 4) + "px;width:0;height:0;border:12px solid transparent;border-bottom:18px solid " + tint + ";transform:translate(-6px,-12px);filter:drop-shadow(0 2px 3px #0006)")
      a.dataset.mark = kind
    } else if (kind === "underline" || kind === "strike") {
      box("left:" + r.x + "px;top:" + (kind === "strike" ? r.y + r.h / 2 - 2 : r.y + r.h + 2) + "px;width:" + r.w + "px;height:4px;border-radius:2px;background:" + tint).dataset.mark = kind
    } else if (kind === "spotlight") {
      box("left:" + (r.x - pad) + "px;top:" + (r.y - pad) + "px;width:" + (r.w + 2 * pad) + "px;height:" + (r.h + 2 * pad) + "px;border-radius:10px;box-shadow:0 0 0 9999px #0008").dataset.mark = kind
    } else {
      const frame = kind === "frame"
      box("left:" + (r.x - pad) + "px;top:" + (r.y - pad) + "px;width:" + (r.w + 2 * pad) + "px;height:" + (r.h + 2 * pad) + "px;border:3px " + (frame ? "dashed" : "solid") + " " + tint + ";border-radius:" + (frame ? 8 : 12) + "px;box-shadow:0 0 0 4px " + tint + "33").dataset.mark = kind
    }
    if (label) { const l = box("left:" + r.x + "px;top:" + Math.max(4, r.y - 34) + "px;padding:3px 9px;border-radius:7px;background:" + tint + ";color:#fff;font-size:13px;white-space:nowrap"); l.textContent = label }
  }
  function caption(n, total, text, low) {
    const c = box("left:50%;" + (low ? "top:22px" : "bottom:22px") + ";transform:translateX(-50%);max-width:78%;padding:12px 18px;border-radius:14px;background:#111c;color:#fff;font-size:20px;line-height:1.35;text-align:center;backdrop-filter:blur(8px);box-shadow:0 6px 24px #0006")
    c.dataset.caption = ""
    const k = document.createElement("span"); k.textContent = n + "/" + total + "  "; k.style.cssText = "opacity:.6;font-size:15px"
    c.append(k, document.createTextNode(text))
  }
  function picture(src, r, on) {
    let p = root.querySelector("[data-before]"), tab = root.querySelector("[data-tab]")
    if (!p) {
      p = box("left:" + r.x + "px;top:" + r.y + "px;width:" + r.w + "px;height:" + r.h + "px;overflow:hidden;border-radius:6px")
      p.dataset.before = ""
      const img = document.createElement("img"); img.src = src; img.style.cssText = "width:100%;height:100%;object-fit:fill;display:block"
      p.append(img)
      // (its word above it, never over a small thing: Before, then Now)
      tab = box("left:" + r.x + "px;top:" + Math.max(4, r.y - 30) + "px;padding:2px 8px;border-radius:6px;color:#fff;font-size:12px")
      tab.dataset.tab = ""
    }
    p.style.display = on ? "block" : "none"
    tab.textContent = on ? "Before" : "Now"
    tab.style.background = on ? "#111c" : tint
  }
  function slide(before, after, which) {
    let s = root.querySelector("[data-slide]")
    if (!s) {
      s = box("inset:0;background:#0d0d0f;display:flex;align-items:center;justify-content:center;gap:28px;padding:40px 40px 120px")
      s.dataset.slide = ""
      for (const [src, word] of [[before, "Before"], [after, "After"]]) {
        if (!src) continue
        const f = document.createElement("figure"); f.dataset.side = word; f.style.cssText = "margin:0;flex:1;max-width:" + (before && after ? "48%" : "80%") + ";display:flex;flex-direction:column;align-items:center;gap:10px;transition:opacity .35s"
        const img = document.createElement("img"); img.src = src; img.style.cssText = "width:100%;max-height:560px;border-radius:10px;box-shadow:0 8px 30px #000a;object-fit:contain"
        const cap = document.createElement("figcaption"); cap.textContent = word; cap.style.cssText = "color:#fff;opacity:.75;font-size:15px"
        f.append(img, cap); s.appendChild(f)
      }
    }
    for (const f of s.querySelectorAll("figure")) f.style.opacity = !which || f.dataset.side === which ? "1" : ".35"
  }
  function tap(x, y) {
    const d = box("left:" + (x - 18) + "px;top:" + (y - 18) + "px;width:36px;height:36px;border-radius:50%;background:" + tint + "55;border:2px solid " + tint + ";transition:transform .5s,opacity .5s")
    requestAnimationFrame(() => { d.style.transform = "scale(1.8)"; d.style.opacity = "0" })
    setTimeout(() => d.remove(), 600)
  }
  const clear = () => { root.textContent = "" }
  const labels = () => [...document.querySelectorAll("button,a,[role=button],[role=tab],[aria-label],h1,h2,h3")].filter((e) => !root.contains(e) && shown(e))
    .map((e) => (e.getAttribute("aria-label") || e.innerText || "").replace(/\s+/g, " ").trim()).filter((t) => t && t.length < 40).slice(0, 30)
  window.__proof = { find, mark, caption, picture, slide, tap, clear, labels }
})()`

/** A picture for the page: a data address (the page may be any site's, so never a file of this machine). */
const dataUrl = (abs: string) => `data:image/${path.extname(abs).slice(1).replace("jpg", "jpeg")};base64,${fs.readFileSync(abs).toString("base64")}`

export type Recorded = { file: string; ms: number; times: number[]; bytes: number }
/** Record `tour` played at `url` into mp4 `out`: captions, marks, befores flipped, afters (the Mac's own UI) as slides;
 *  `pic` finds a step's picture here. Throws saying what it couldn't find. */
export async function recordProof(o: { url: string; tour: Pick<Tour, "title" | "steps">; out: string; pic: (p: string) => string; signal?: AbortSignal }): Promise<Recorded> {
  const chrome = chromePath(), ffmpeg = ffmpegPath()
  if (!chrome) throw new Error("no Chrome to record in here (Google Chrome, or Chromium: VAULTITE_CHROME names one)")
  if (!ffmpeg) throw new Error("no ffmpeg here to make the video (brew install ffmpeg, or apt install ffmpeg)")
  const browser = await headless(SIZE, o.signal)
  let enc: ReturnType<typeof spawn> | null = null
  o.signal?.addEventListener("abort", () => enc?.kill("SIGKILL"), { once: true })
  try {
    const p = browser.page
    await p.send("Page.enable"); await p.send("Runtime.enable")
    await p.send("Emulation.setDeviceMetricsOverride", { ...SIZE, deviceScaleFactor: 1, mobile: false })
    const loaded = new Promise<void>((ok) => p.on("Page.loadEventFired", () => ok()))
    const nav = await p.send("Page.navigate", { url: o.url })
    if (nav.errorText) throw new Error(`couldn't open ${o.url}: ${nav.errorText} (is its server running?)`)
    await Promise.race([loaded, sleep(15_000)])
    const js = async (expr: string) => {
      const r = await p.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }) as { result?: { value?: unknown }; exceptionDetails?: { text?: string } }
      if (r.exceptionDetails) throw new Error(`the page: ${r.exceptionDetails.text}`)
      return r.result?.value
    }
    // (a page that draws itself after load, as the app does: its first words up before the first frame)
    for (let i = 0; i < 40 && !(await js("document.body && document.body.innerText.trim().length > 0")); i++) await sleep(250)
    await sleep(1200)
    await js(PAGE)

    // The things of the steps before any acts found first (later ones may come of what it does, so when theirs comes):
    // one that isn't there fails before any video is made, saying so.
    type Rect = { x: number; y: number; w: number; h: number }
    const finds = (s: Step) => s.tags.flatMap((g) => [g.at, g.to]).flatMap((at) => (at && "find" in at ? [at.find] : []))
    const missing = async (s: Step, wait = 0) => {
      const out: string[] = []
      for (const f of finds(s)) {
        let ok = false
        for (const t0 = Date.now(); !(ok = !!(await js(`!!__proof.find(${JSON.stringify(f)})`))) && Date.now() - t0 < wait;) await sleep(250)
        if (!ok) out.push(`step ${s.n}: "${f}"`)
      }
      return out
    }
    const lostSay = async (lost: string[]) => new Error(`not on the page at ${o.url}: ${lost.join(", ")}. It shows: ${((await js("__proof.labels()")) as string[]).map((x) => `"${x}"`).join(", ") || "nothing readable"}. Name things by the words they show there`)
    const acts = o.tour.steps.findIndex((s) => actsOf(s).length), first = acts < 0 ? o.tour.steps : o.tour.steps.slice(0, acts + 1)
    const lost = (await Promise.all(first.map((s) => missing(s)))).flat()
    if (lost.length) throw await lostSay(lost)

    enc = spawn(ffmpeg, ["-hide_banner", "-loglevel", "error", "-y", "-f", "image2pipe", "-c:v", "mjpeg", "-framerate", String(FPS), "-i", "-",
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-preset", "veryfast", "-crf", "30", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", o.out], { stdio: ["pipe", "ignore", "pipe"] })
    let encErr = ""
    enc.stderr!.on("data", (d: Buffer) => { encErr += d })
    const encoded = new Promise<number>((ok) => enc!.on("exit", (c) => ok(c ?? 1)))
    // (frames come only when the page changes: the latest is written at a steady rate, so the video keeps real time)
    let latest: Buffer | null = null, written = 0
    p.on("Page.screencastFrame", (f) => { latest = Buffer.from(String(f.data), "base64"); void p.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {}) })
    await p.send("Page.startScreencast", { format: "jpeg", quality: 82, maxWidth: SIZE.width, maxHeight: SIZE.height })
    while (!latest) await sleep(30)
    const t0 = Date.now()
    const ticker = setInterval(() => {
      const want = Math.floor(((Date.now() - t0) / 1000) * FPS)
      while (latest && written < want) { enc!.stdin!.write(latest); written++ }
    }, 1000 / FPS / 2)
    const times: number[] = []
    try {
      await sleep(900)
      const total = o.tour.steps.length
      for (const s of o.tour.steps) {
        if (o.signal?.aborted) throw new Error("stopped")
        if (Date.now() - t0 > MOST_MS) throw new Error(`a proof runs ${MOST_MS / 60_000} minutes at most: fewer or shorter steps`)
        const after = s.after
        await js("__proof.clear()")
        times.push(Math.round((Date.now() - t0) / 100) / 10)
        const hold = holdMs(s)
        if (after) {
          await js(`__proof.slide(${JSON.stringify(s.before ? dataUrl(o.pic(s.before)) : "")}, ${JSON.stringify(dataUrl(o.pic(after)))}, ${s.before ? '"Before"' : "null"})`)
          await js(`__proof.caption(${s.n}, ${total}, ${JSON.stringify(s.said)})`)
          if (s.before) { await sleep(FLIPS[0][0]); await js(`__proof.slide("", "", "After")`); await sleep(hold - FLIPS[0][0]) } else await sleep(hold)
          continue
        }
        const late = await missing(s, 3000)
        if (late.length) throw await lostSay(late)
        const rects: (Rect | null)[] = []
        for (const g of s.tags) {
          const r = "find" in g.at ? await js(`__proof.find(${JSON.stringify(g.at.find)})`) as Rect | null : null
          rects.push(r)
          if (r) await js(`__proof.mark(${JSON.stringify(g.kind === "arrow" || g.kind === "connect" ? "ring" : g.kind)}, ${JSON.stringify(r)}, ${JSON.stringify(g.label ?? "")})`)
        }
        // (a mark low on the page: the caption goes on top, never over it)
        const low = rects.some((r) => r && r.y + r.h > SIZE.height - 150)
        await js(`__proof.caption(${s.n}, ${total}, ${JSON.stringify(s.said)}, ${low})`)
        if (s.before && rects[0]) {
          const src = JSON.stringify(dataUrl(o.pic(s.before))), r = JSON.stringify(rects[0])
          await js(`__proof.picture(${src}, ${r}, true)`)
          let at = 0
          for (const [ms, on] of FLIPS) { await sleep(ms - at); at = ms; await js(`__proof.picture(${src}, ${r}, ${on})`) }
          await sleep(Math.max(0, hold - at))
        } else await sleep(hold)
        // (what guide would wait for them to do, and its do: done, so the next step shows what it led to)
        for (const d of actsOf(s)) { await act(p, js, d); await sleep(700) }
      }
      await js("__proof.clear()")
      await sleep(900)
    } finally {
      clearInterval(ticker)
      await p.send("Page.stopScreencast").catch(() => {})
      enc.stdin!.end()
    }
    const code = await encoded
    if (code !== 0) throw new Error(`ffmpeg couldn't make the video: ${encErr.trim().slice(-300)}`)
    return { file: o.out, ms: Date.now() - t0, times, bytes: fs.statSync(o.out).size }
  } finally {
    enc?.kill("SIGKILL")
    await browser.quit()
  }
}

/** One do in the recording browser: a click at the thing saying its words, typing (into one), a key, a scroll. */
async function act(p: Cdp, js: (e: string) => Promise<unknown>, d: Do) {
  const at = async (text: string) => {
    const r = await js(`__proof.find(${JSON.stringify(text)})`) as { x: number; y: number; w: number; h: number } | null
    if (!r) throw new Error(`do: nothing says "${text}" on the page now`)
    return { x: r.x + r.w / 2, y: r.y + r.h / 2 }
  }
  const click = async (pt: { x: number; y: number }) => {
    // (seen in the video: where it clicked)
    await js(`__proof.tap(${pt.x}, ${pt.y})`)
    for (const type of ["mousePressed", "mouseReleased"]) await p.send("Input.dispatchMouseEvent", { type, ...pt, button: "left", clickCount: 1 })
  }
  if (d.action === "click" && d.text) return click(await at(d.text))
  if (d.action === "type") { if (d.text) await click(await at(d.text)); return p.send("Input.insertText", { text: d.value ?? "" }) }
  if (d.action === "scroll") return p.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: SIZE.width / 2, y: SIZE.height / 2, deltaX: 0, deltaY: d.dir === "up" ? -400 : 400 })
  if (d.action === "press" && d.key) {
    const keys: Record<string, [string, number]> = { enter: ["Enter", 13], escape: ["Escape", 27], esc: ["Escape", 27], tab: ["Tab", 9], backspace: ["Backspace", 8], space: [" ", 32] }
    const k = keys[d.key.toLowerCase()]
    if (!k) return
    for (const type of ["keyDown", "keyUp"]) await p.send("Input.dispatchKeyEvent", { type, key: k[0], windowsVirtualKeyCode: k[1], ...(k[0] === "Enter" && type === "keyDown" ? { text: "\r" } : {}) })
  }
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
