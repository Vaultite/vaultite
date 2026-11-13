const POLL = 40

function requestsOut(page) {
  const out = new Set()
  const add = (r) => { out.add(r); out.at = Date.now() }, end = (r) => { if (out.delete(r)) out.at = Date.now() }
  out.at = 0
  page.on("request", (r) => { if (!["websocket", "eventsource"].includes(r.resourceType())) add(r) })
  page.on("response", (r) => { if (/text\/event-stream/.test(r.headers()["content-type"] ?? "")) end(r.request()) })
  page.on("requestfinished", end)
  page.on("requestfailed", end)
  page.on("framenavigated", (f) => { if (f === page.mainFrame()) out.clear() })
  return out
}

/** After a frame is drawn: web/src/core/unsaved.ts' vaultiteBusy, and motion that will end (not one a scroll drives). */
const pageBusy = (page, saves) => page.evaluate((saves) => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => {
  const moving = document.getAnimations().filter((a) => a.playState === "running" && a.timeline instanceof DocumentTimeline && a.effect?.getComputedTiming().endTime !== Infinity)
  done([...(window.vaultiteBusy?.({ saves }) ?? []), ...(moving.length ? [`${moving.length} animations`] : [])])
}))), saves)

function framesHeard(page) {
  const waiters = new Set()
  page.on("websocket", (ws) => ws.on("framereceived", ({ payload }) => { for (const w of waiters) w(ws.url(), String(payload)) }))
  return waiters
}

function changedPaths(url, payload) {
  if (!/\/api\/events\b/.test(url)) return undefined
  let m
  try { m = JSON.parse(payload) } catch { return undefined }
  return m.type === "change" || (m.type === "hello" && m.paths !== undefined) ? m.paths ?? null : undefined
}

export function app(page) {
  const out = requestsOut(page), heard = framesHeard(page)
  /** Nothing out, unsaved, due or moving for `quiet` ms: a request a timer starts comes a moment after the last. */
  async function idle({ timeout = 10_000, quiet = 150, saves = false } = {}) {
    const end = Date.now() + timeout
    let since = 0, last = []
    for (;;) {
      last = [...(out.size ? [`${out.size} requests: ${[...out].slice(0, 3).map((r) => new URL(r.url()).pathname).join(", ")}`] : []),
        ...await pageBusy(page, saves).catch((e) => [`no answer: ${e.message.split("\n")[0]}`])]
      if (last.length) since = 0
      else if (!since) since = Date.now()
      else if (Date.now() - Math.max(since, out.at) >= quiet) return
      if (Date.now() > end) throw new Error(`the app wasn't idle after ${timeout} ms: ${last.join("; ")}`)
      await new Promise((r) => setTimeout(r, POLL))
    }
  }

  async function hearing(match, act, timeout, missed) {
    let hit
    const got = new Promise((resolve) => { hit = (url, payload) => { if (match(url, payload)) resolve() }; heard.add(hit) })
    try {
      await act()
      let timer
      await Promise.race([got, new Promise((_, no) => { timer = setTimeout(() => no(new Error(`${missed} within ${timeout} ms`)), timeout) })])
      clearTimeout(timer)
    } finally { heard.delete(hit) }
    await idle()
  }

  /** Runs `act` (a write to the vault), then waits till the app hears `file` (its vault path) changed, and is idle. */
  const sees = (file, act, { timeout = 10_000 } = {}) =>
    hearing((url, payload) => { const paths = changedPaths(url, payload); return paths === null || !!paths?.includes(file) }, act, timeout, `the app didn't hear ${file} change`)

  /** idle, and the debounced saves done (trackSoon's `save`): before a reload or reading localStorage. */
  const saved = (o = {}) => idle({ timeout: 15_000, ...o, saves: true })

  const hears = (socket, act, { timeout = 10_000 } = {}) => hearing((url) => socket.test(url), act, timeout, `the page heard nothing on ${socket}`)

  const menus = () => page.locator("[role=menu]")
  const ROLES = ["menuitem", "menuitemcheckbox", "menuitemradio"], ITEM = ROLES.map((r) => `[role=${r}]`).join(", ")
  const menu = {
    top: () => menus().last(),
    isOpen: async () => (await menus().count()) > 0,
    async open(target, click = {}) { const n = await menus().count(); await target.click(click); await menus().nth(n).waitFor(); return menu.top() },
    context: (target, click = {}) => menu.open(target, { ...click, button: "right" }),
    items: () => menu.top().locator(ITEM).evaluateAll((els) => els.map((e) => (e.getAttribute("aria-label") ?? e.textContent ?? "").trim())),
    async pick(...path) {
      for (const [i, name] of path.entries()) {
        const n = await menus().count()
        const row = ROLES.map((r) => menu.top().getByRole(r, { name, exact: true })).reduce((a, b) => a.or(b)).first()
        if (i < path.length - 1) { await row.hover(); await menus().nth(n).waitFor() } else await row.click()
      }
      await idle()
    },
    async close() { for (let i = 0; i < 5 && await menu.isOpen(); i++) { await page.keyboard.press("Escape"); await idle() } },
  }

  const pane = (label) => label === undefined ? page.locator("section[data-pane-frame][data-focused]:not([data-away])")
    : page.locator("section[data-pane-frame]:not([data-away])").and(page.getByLabel(label, { exact: typeof label === "string" }))
  pane.all = () => page.locator("section[data-pane-frame]:not([data-away])").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))

  const toasts = page.locator("[data-sonner-toast]")
  const toast = () => toasts.allInnerTexts()
  toast.wait = async (text, { timeout = 10_000 } = {}) => { const t = toasts.filter({ hasText: text }).first(); await t.waitFor({ timeout }); return t }

  return { idle, saved, sees, hears, menu, pane, toast }
}
