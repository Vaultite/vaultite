// Claude Code's chat tab, pictured: a made-up session played over its socket (no session runs), each scene at desktop
// and phone sizes, light and dark, plus frames of a turn streaming. For judging the design; checks only that it draws.
//   node web/qa/chatshots.mjs <base url> [out dir] [scene,scene...] [size,size...]
import { mkdirSync } from "node:fs"
import { deflateSync } from "node:zlib"
import { qa, wait } from "./lib/qa.mjs"
const { args: [B, OUT = "/tmp/chatshots/", ONLY = "", SIZES_ONLY = ""], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })

const T0 = Date.now() - 6 * 60_000
const at = (s) => new Date(T0 + s * 1000).toISOString()
const S = (state, more = {}) => ({ id: "qa-chat", state, cwd: "/Users/alice/lighthouse", account: "default", by: "app", model: "claude-opus-5-5", effort: "high",
  mode: "auto", started: T0, at: Date.now() - (state === "working" ? 14_000 : 60_000), asks: [], seq: 1, told: 0, turn: null, ...more })

const LONG = `The launch page now builds from \`site/launch.md\`, and the countdown reads the date from its front matter.

## What changed
- **\`site/build.ts\`**: the page's date comes from \`launch_at\`, so moving the launch is one line.
- **\`site/countdown.ts\`**: counts down in the visitor's time zone and hides itself once it's passed.
- Removed the hard-coded date in \`index.html\`.

\`\`\`ts
export function countdown(to: Date, now = new Date()) {
  const ms = Math.max(0, to.getTime() - now.getTime())
  return { days: Math.floor(ms / 864e5), hours: Math.floor(ms / 36e5) % 24 }
}
\`\`\`

All 42 tests pass. Want me to deploy it to the preview site?`
const EDIT = { file_path: "/Users/alice/lighthouse/site/build.ts", old_string: "const date = \"2026-12-01\"\nrender(page, { date })", new_string: "const date = page.meta.launch_at\nif (!date) throw new Error(\"launch_at missing\")\nrender(page, { date })" }

const user = (id, text, s) => ({ k: "user", id, text, at: at(s) })
const text = (id, t, s, live) => ({ k: "text", id, text: t, at: at(s), ...(live ? { live: true } : {}) })
const tool = (id, name, summary, input, result, s, more = {}) => ({ k: "tool", id, name, summary, input, ...(result === undefined ? {} : { result }), at: at(s), ...more })
const DONE = [
  user("u1", "The launch date is hard-coded in three places. Make the countdown read it from the page's front matter instead.", 0),
  { k: "thinking", id: "m1:0", text: "I should find where the date is set first, then change the build to read `launch_at`.", at: at(2) },
  text("m1:1", "I'll find where the date is set.", 3),
  tool("t1", "Grep", "2026-12-01 in site", { pattern: "2026-12-01", path: "site" }, "site/build.ts:14\nsite/index.html:22\nsite/countdown.ts:3", 4),
  tool("t2", "Read", "site/build.ts", { file_path: "/Users/alice/lighthouse/site/build.ts" }, "1  import { render } from \"./render\"\n…", 5),
  tool("t3", "Edit", "site/build.ts", EDIT, "The file site/build.ts has been updated.", 7),
  tool("t4", "Bash", "Run the tests", { command: "npm test -- site", description: "Run the tests" }, "> lighthouse@1.0.0 test\n> node --test site\n\n✔ countdown counts down to the launch (12 ms)\n✔ countdown hides itself once it\'s passed (3 ms)\n✔ countdown reads the visitor\'s time zone (4 ms)\n✔ build reads launch_at from front matter (40 ms)\n✔ build fails without launch_at (2 ms)\n✔ build renders the page (31 ms)\n✔ index has no hard-coded date (1 ms)\n\nℹ tests 42\nℹ suites 6\nℹ pass 42\nℹ fail 0\nℹ duration_ms 412", 9),
  text("m2:0", LONG, 12),
  { k: "result", id: "r1", ok: true, ms: 14_000, at: at(13) },
]

/** A small PNG: a soft gradient from one colour to another (rgb triples). */
function png(w, h, a, b) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => { const t = Buffer.from(type), len = Buffer.alloc(4), sum = Buffer.alloc(4); len.writeUInt32BE(data.length); sum.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, sum]) }
  const head = Buffer.alloc(13); head.writeUInt32BE(w, 0); head.writeUInt32BE(h, 4); head[8] = 8; head[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) for (let c = 0; c < 3; c++) raw[y * (w * 3 + 1) + 1 + x * 3 + c] = Math.round(a[c] + (b[c] - a[c]) * ((x / w + y / h) / 2))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", head), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))])
}
// (a message's pictures as the server names them; the page's requests for them are answered with these)
const PICTURES = [png(160, 100, [242, 160, 90], [120, 70, 200]), png(120, 120, [60, 170, 140], [30, 60, 120])]
const IMAGES = PICTURES.map((_, n) => ({ src: `image/u1/${n}` }))

/** The scenes: a hello (what the socket says first), then what it says over time. */
const SCENES = {
  done: { hello: { s: S("idle"), live: DONE } },
  expanded: { hello: { s: S("idle"), live: DONE }, open: ["[data-work] button[aria-expanded]", "[data-tool=Edit] button", "[data-tool=Bash] button"] },
  // a message with pictures, and a turn whose calls ran long (grouped) and one failed
  images: { hello: { s: S("idle"), live: [{ ...user("u1", "Make the countdown look like these two mockups.", 0), images: IMAGES },
    text("m1:0", "I'll look at the current styles first.", 2),
    tool("t1", "Read", "site/countdown.css", { file_path: "/Users/alice/lighthouse/site/countdown.css" }, "     1→.countdown { display: flex; }\n     2→.countdown span { font: 600 48px/1 system-ui; }", 3),
    tool("t2", "Read", "site/countdown.ts", { file_path: "/Users/alice/lighthouse/site/countdown.ts" }, "     1→export function countdown() {}", 4),
    tool("t3", "Grep", "countdown in site", { pattern: "countdown", path: "/Users/alice/lighthouse/site" }, "site/index.html:12\nsite/countdown.ts:1", 5),
    tool("t4", "Edit", "site/countdown.css", { file_path: "/Users/alice/lighthouse/site/countdown.css", old_string: ".countdown { display: flex; }", new_string: ".countdown {\n  display: flex;\n  gap: 12px;\n  background: linear-gradient(135deg, #f2a05a, #7846c8);\n}" }, "The file has been updated.", 6),
    tool("t5", "Bash", "Build the site", { command: "npm run build -- --strict-css-checks-for-every-file-in-the-site-folder", description: "Build the site" }, "Exit code 1\nsite/countdown.css:4: unknown property", 8, { error: true }),
    tool("t6", "Edit", "site/countdown.css", { file_path: "/Users/alice/lighthouse/site/countdown.css", old_string: "  background: x", new_string: "  background: y" }, "The file has been updated.", 9),
    text("m2:0", "The countdown now uses the mockups' gradient and spacing; the build passes.", 12),
    { k: "result", id: "r1", ok: true, ms: 72_000, at: at(13) }] }, open: ["[data-work] button[aria-expanded]", "[data-tool=Bash] button"] },
  permission: { hello: { s: S("waiting", { asks: ["ask:t9"] }), live: [...DONE.slice(0, 8), user("u2", "Yes, deploy it to the preview.", 30),
    tool("t9", "Bash", "Deploy to preview", { command: "npx wrangler pages deploy dist --branch preview", description: "Deploy to preview" }, undefined, 32),
    { k: "ask", id: "ask:t9", kind: "permission", tool: "Bash", title: "Run a command?", detail: "Deploy to preview", input: { command: "npx wrangler pages deploy dist --branch preview" }, always: "npx wrangler commands", at: at(32) }] } },
  question: { hello: { s: S("waiting", { asks: ["ask:t8"] }), live: [...DONE.slice(0, 3),
    tool("t8", "AskUserQuestion", "", {}, undefined, 4),
    { k: "ask", id: "ask:t8", kind: "question", tool: "AskUserQuestion", title: "Where should the date live?", at: at(4), questions: [{ question: "Where should the launch date live?", header: "Date",
      options: [{ label: "Front matter", description: "launch_at in site/launch.md" }, { label: "Config file", description: "site/config.json, shared by every page" }, { label: "Environment", description: "LAUNCH_AT at build time" }] }] }] } },
  plan: { hello: { s: S("waiting", { asks: ["ask:t7"], mode: "plan" }), live: [DONE[0], tool("t7", "ExitPlanMode", "", {}, undefined, 4),
    { k: "ask", id: "ask:t7", kind: "plan", tool: "ExitPlanMode", title: "Claude has a plan", at: at(4), plan: "## Plan\n1. Read `launch_at` from the page's front matter in `site/build.ts`.\n2. Pass it to the countdown; drop the date in `index.html`.\n3. Add a test for a missing date.\n4. Run the tests." }] } },
  error: { hello: { s: S("error", { error: "Claude's usage limit is reached: it resets at 3 pm." }), live: DONE.slice(0, 5) } },
  loading: { silent: true },
  // loading while its machine isn't answering
  unreachable: { silent: true, then: async (page, ws) => { ws.send(JSON.stringify({ t: "unreachable", reason: "Mini PC isn't answering" })) } },
  // a picture added with the attach button, then words typed beside it
  attached: { hello: { s: S("idle"), live: DONE }, then: async (page) => {
    // (a picture of the page itself: a real screenshot, as one is pasted)
    const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 360, height: 240 } })
    await page.locator("[data-attach-input]").setInputFiles({ name: "screenshot.png", mimeType: "image/png", buffer: shot })
    await page.locator("[data-picture]").first().waitFor({ timeout: 5000 }).catch(() => {})
    await page.locator("[data-composer] textarea").fill("The countdown overlaps the header here:")
  } },
  // read three times without a hello: it says it couldn't load, and keeps trying
  failed: { silent: true, then: async (page, ws) => { for (let n = 0; n < 3; n++) ws.send(JSON.stringify({ t: "error", reason: "ENOENT: no such file" })) } },
  // its machine not answering: said over the composer, the conversation kept
  away: { hello: { s: S("idle"), live: DONE }, then: async (page, ws) => { ws.send(JSON.stringify({ t: "unreachable", reason: "Mini PC isn't answering" })) } },
  // a message sent while Claude works: queued under the composer
  queued: { hello: { s: S("working"), live: DONE.slice(0, 5) }, then: async (page) => {
    await page.locator("[data-composer] textarea").fill("Also update the changelog when you're done.")
    await page.keyboard.press("Enter")
    await wait(400)
  } },
  // a turn as it streams: thinking, words written a few at a time, a call running, then more words
  streaming: { hello: { s: S("working"), live: [DONE[0]], asked: 4000 }, stream: true },
}

const ALL = [
  { name: "desktop-light", viewport: { width: 1440, height: 900 }, scheme: "light" },
  { name: "desktop-dark", viewport: { width: 1440, height: 900 }, scheme: "dark" },
  { name: "phone-light", viewport: { width: 390, height: 844 }, scheme: "light", phone: true },
  { name: "phone-dark", viewport: { width: 390, height: 844 }, scheme: "dark", phone: true },
  { name: "phonemax-light", viewport: { width: 430, height: 932 }, scheme: "light", phone: true },
]
const SIZES = ALL.filter((s) => (SIZES_ONLY ? SIZES_ONLY.split(",").includes(s.name) : !s.extra))

const hello = (h) => JSON.stringify({ t: "hello", found: true, s: h.s, title: "Read the launch date from front matter", cwd: h.s.cwd, account: "default", model: h.s.model, effort: "high",
  tui: null, driven: "", history: { entries: h.asked ? [{ ...h.live[0], at: new Date(Date.now() - h.asked).toISOString() }, ...h.live.slice(1)] : h.live, start: 0 } })

/** `end`: told as the turn is about to end (its result, then idle), so a video can mark where its work folds away. */
async function stream(ws, page, shot, end = () => {}) {
  const put = (e) => ws.send(JSON.stringify({ t: "put", e }))
  const words = LONG.split(/(?<=\s)/)
  put({ k: "thinking", id: "m1:0", text: "Finding where", at: at(2), live: true })
  await wait(700); await shot("01-thinking")
  put({ k: "thinking", id: "m1:0", text: "Finding where the date is set.", at: at(2) })
  let said = ""
  for (const [n, w] of "I'll find where the date is set, then read it from the front matter.".split(/(?<=\s)/).entries()) {
    said += w; put(text("m1:1", said, 3, true)); await wait(40)
    if (n === 6) await shot("02-text-streaming")
  }
  put(text("m1:1", said, 3))
  put(tool("t1", "Grep", "2026-12-01 in site", { pattern: "2026-12-01", path: "site" }, undefined, 4, { live: true }))
  await wait(300); await shot("03-tool-running")
  put(tool("t1", "Grep", "2026-12-01 in site", { pattern: "2026-12-01", path: "site" }, "site/build.ts:14", 4))
  put(tool("t3", "Edit", "site/build.ts", EDIT, undefined, 7, { live: true }))
  await wait(300); await shot("04-second-tool")
  put(tool("t3", "Edit", "site/build.ts", EDIT, "updated", 7))
  put(tool("t4", "Bash", "Run the tests", { command: "npm test -- site" }, undefined, 9))
  await wait(400); await shot("05-bash-running")
  put(tool("t4", "Bash", "Run the tests", { command: "npm test -- site" }, "ℹ tests 42\nℹ pass 42", 9))
  said = ""
  for (const [n, w] of words.entries()) {
    said += w; put(text("m2:0", said, 12, true)); await wait(25)
    if (n === 20) await shot("06-answer-streaming")
    if (n === 60) await shot("07-answer-streaming-more")
  }
  put(text("m2:0", said, 12))
  end()
  put({ k: "result", id: "r-stream", ok: true, ms: 14_000, at: at(13) })
  ws.send(JSON.stringify({ t: "state", s: S("idle") }))
  await wait(500); await shot("08-done")
}

for (const size of SIZES) {
  const ctx = await browser.newContext({ viewport: size.viewport, colorScheme: size.scheme, deviceScaleFactor: size.phone ? 2 : 1, ...(size.phone ? { isMobile: true, hasTouch: true } : {}) })
  for (const [name, sc] of Object.entries(SCENES)) {
    if (ONLY && !ONLY.split(",").includes(name)) continue
    const page = watch(await ctx.newPage(), { label: `${size.name} ${name}`, ignore: /favicon|Failed to load resource|WebSocket/ })
    let sock = null
    await page.routeWebSocket(/\/api\/claude-code\/chat\/qa-chat$/, (ws) => { sock = ws; if (!sc.silent) ws.send(hello(sc.hello)) })
    await page.route("**/api/ops/claude-code.chat-*", (r) => r.fulfill({ json: { id: "qa-chat", state: "working" } }))
    await page.route("**/api/claude-code/chat/qa-chat/image/**", (r) => r.fulfill({ contentType: "image/png", body: PICTURES[Number(r.request().url().split("/").pop())] ?? PICTURES[0] }))
    await page.goto("about:blank")
    await page.goto(`${B}#view/claude-session%2Fqa-chat`)
    const drawn = await page.locator(sc.silent ? "[data-composer]" : "[data-chat=qa-chat] [data-entries]").waitFor({ timeout: 20000 }).then(() => true, () => false)
    check(`${size.name} ${name}: drawn`, drawn)
    await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" })
    await wait(900)
    for (const sel of sc.open ?? []) { await page.locator(sel).first().click().catch(() => {}); await wait(350) }
    if (sc.open) await wait(500)
    if (sc.then) { await sc.then(page, sock); await wait(400) }
    const file = (n) => `${OUT}${size.name}-${name}${n ? `-${n}` : ""}.png`
    if (sc.stream) await stream(sock, page, (n) => page.screenshot({ path: file(n) }))
    else {
      if (name === "done" || name === "expanded" || name === "images") {
        await page.evaluate((top) => { const s = document.querySelector("[data-chat] .overflow-y-auto"); if (s) s.scrollTop = top ? 0 : s.scrollHeight }, name !== "done")
        await wait(500) // (what fades as it scrolls, Jump to latest, at rest)
      }
      await page.screenshot({ path: file() })
    }
    await page.close()
  }
  // a new chat, as the tab opens
  if (!ONLY || ONLY.split(",").includes("new")) {
    const page = watch(await ctx.newPage(), { label: `${size.name} new` })
    await page.goto("about:blank")
    await page.goto(`${B}#view/claude-session%2Fnew`)
    check(`${size.name} new: drawn`, await page.locator("[data-composer]").waitFor({ timeout: 20000 }).then(() => true, () => false))
    await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" })
    await wait(900)
    await page.screenshot({ path: `${OUT}${size.name}-new.png` })
    await page.close()
  }
  await ctx.close()
}
// Motion, as video: a turn streams in, its work folds away as it ends, a call opens and closes, a message is sent; cut
// into contact sheets (ffmpeg) of 10 frames a second, for judging motion without watching.
if (!ONLY || ONLY.split(",").includes("motion")) {
  const { execFileSync } = await import("node:child_process")
  const { readdirSync, renameSync, writeFileSync } = await import("node:fs")
  for (const size of [ALL[0], ALL[3]]) {
    const vdir = `${OUT}video-${size.name}/`
    const ctx = await browser.newContext({ viewport: size.viewport, colorScheme: size.scheme, ...(size.phone ? { isMobile: true, hasTouch: true } : {}),
      recordVideo: { dir: vdir, size: size.viewport } })
    const page = watch(await ctx.newPage(), { label: `${size.name} motion`, ignore: /favicon|Failed to load resource|WebSocket/ })
    // (the video starts once the page is made: marks count from then, so each sheet starts as its action does)
    const t0 = Date.now()
    let sock = null
    await page.routeWebSocket(/\/api\/claude-code\/chat\/qa-chat$/, (ws) => { sock = ws; ws.send(hello({ s: S("idle"), live: [{ ...DONE[0], at: new Date(Date.now() - 2000).toISOString() }] })) })
    await page.route("**/api/ops/claude-code.chat-*", (r) => r.fulfill({ json: { id: "qa-chat", state: "working" } }))
    await page.goto(`${B}#view/claude-session%2Fqa-chat`)
    await page.locator("[data-chat=qa-chat] [data-entries]").waitFor({ timeout: 20000 })
    await page.addStyleTag({ content: "[data-sonner-toaster]{display:none!important}" })
    await wait(1000)
    const marks = []
    const mark = (name) => marks.push([name, (Date.now() - t0) / 1000])
    mark("stream")
    sock.send(JSON.stringify({ t: "state", s: S("working") }))
    await stream(sock, page, async () => {}, () => mark("collapse"))
    await wait(1000)
    mark("open-tool")
    await page.locator("[data-work] button[aria-expanded]").first().click().catch(() => {})
    await wait(700)
    await page.locator("[data-tool=Edit] button").first().click().catch(() => {})
    await wait(700)
    await page.locator("[data-tool=Edit] button").first().click().catch(() => {})
    await wait(700)
    await page.locator("[data-work] button[aria-expanded]").first().click().catch(() => {})
    await wait(700)
    mark("send")
    await page.locator("[data-composer] textarea").fill("Ship it to the preview, please.")
    await page.keyboard.press("Enter")
    await wait(150)
    sock.send(JSON.stringify({ t: "put", e: { ...user("u9", "Ship it to the preview, please.", 0), at: new Date().toISOString() } }))
    sock.send(JSON.stringify({ t: "state", s: S("working") }))
    await wait(1500)
    mark("end")
    await ctx.close()
    const video = readdirSync(vdir).find((f) => f.endsWith(".webm"))
    renameSync(vdir + video, `${OUT}${size.name}-motion.webm`)
    writeFileSync(`${OUT}${size.name}-motion-marks.json`, JSON.stringify(marks))
    for (let n = 0; n < marks.length - 1; n++) {
      const [name, from] = marks[n], to = marks[n + 1][1]
      const frames = Math.min(48, Math.ceil((to - from) * 10)), cols = size.phone ? 8 : 6
      execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from), "-t", String(Math.min(to - from, 4.8)), "-i", `${OUT}${size.name}-motion.webm`,
        "-vf", `fps=10,${size.phone ? "scale=195:-1" : "crop=780:900:460:0,scale=390:-1"},tile=${cols}x${Math.ceil(frames / cols)}`, "-frames:v", "1", `${OUT}${size.name}-motion-${name}.png`])
    }
  }
}
await done()
