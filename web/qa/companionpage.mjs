// The Companion page: its talk (an ask and its answer, Details), a job card and its usage. Seeds a day's logs in the
// server's local dir: throwaway server only.
//   node web/qa/companionpage.mjs <base url> <server's VAULTITE_LOCAL> [out dir]
import { appendFileSync, mkdirSync, readdirSync } from "node:fs"
import path from "node:path"
import { qa, until, wait } from "./lib/qa.mjs"
const { args: [B, LOCAL, OUT = "/tmp/companionpage-shots/"], browser, check, watch, done } = await qa(import.meta.url)
mkdirSync(OUT, { recursive: true })
const call = async (id, body = {}) => {
  const r = await fetch(new URL(`/api/ops/${id}`, B), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
  return { status: r.status, body: await r.json().catch(() => null) }
}
const dir = path.join(LOCAL, "companion", readdirSync(path.join(LOCAL, "companion"))[0])
const d = new Date(), day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`, t = Date.now() - 60_000
appendFileSync(path.join(dir, `moments-${day}.jsonl`), `${JSON.stringify({ kind: "ask", for: "Claude", text: "What's this button for?", app: "com.example.app", title: "Example", summoned: true, voice: true, waited: 120, seq: 9001, t })}\n`)
appendFileSync(path.join(dir, `actions-${day}.jsonl`), [{ t: t + 300, as: "Claude (summoned)", op: "sent" }, { t: t + 1400, as: "Claude (summoned)", op: "word" },
  { t: t + 1500, as: "Claude (summoned)", op: "say", text: "It shares this page with your team." }, { t: t + 1600, as: "Claude (summoned)", op: "done" }].map((x) => JSON.stringify(x)).join("\n") + "\n")

const page = watch(await browser.newPage({ viewport: { width: 1280, height: 860 } }))
try {
  const r = await call("companion.conversation", {})
  const e = r.body?.exchanges?.find((x) => x.seq === 9001)
  check("conversation has the ask and its answer", !!e && e.said[0] === "It shares this page with your team." && e.word > 1, e ?? r)
  const u = await call("companion.usage")
  check("usage answers", u.status === 200 && Array.isArray(u.body?.services), u)

  await page.goto(B)
  await page.waitForSelector("[data-ui='panel:pages:pages']")
  const o = await call("companion.page")
  check("page op opens its page", o.status === 200 && /Companion\.md$/.test(o.body?.path ?? ""), o)
  check("the talk draws", await until(async () => !!(await page.$("[data-companion-turn]"))))
  check("its answer shows", await until(async () => /It shares this page with your team/.test(await page.$eval("[data-companion-conversation]", (el) => el.innerText).catch(() => ""))))
  check("usage draws", await until(async () => !!(await page.$("[data-companion-usage]"))))
  await page.screenshot({ path: `${OUT}page.png` })
  // A day back and forth.
  await page.click("[data-companion-conversation] [aria-label='Day before']")
  check("the day before", await until(async () => /Nothing that day|data-companion-turn/.test(await page.$eval("[data-companion-conversation]", (el) => el.innerHTML))))
  await page.click("[data-companion-conversation] [aria-label='Day after']")
  check("back to today", await until(async () => !!(await page.$("[data-companion-turn]"))))
  await wait(300)
} finally { await done() }
