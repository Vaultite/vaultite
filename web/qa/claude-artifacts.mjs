// claude.ai artifacts saved as .html run as is (window.claude, window.storage); QA_SAMPLE=1 also asks Claude for real
// (Claude Code on the server's machine). WRITES fixtures (QA/ in the vault): throwaway server only.
//   node web/qa/claude-artifacts.mjs <base url> <vault path>
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { qa, until, wait, SHOTS as OUT } from "./lib/qa.mjs"
const { args: [B, VAULT], browser, check, watch, done } = await qa(import.meta.url)
const temp = (p) => [realpathSync("/tmp"), realpathSync(tmpdir())].some((t) => realpathSync(p).startsWith(t + "/"))
if (!temp(VAULT)) { console.error("claude-artifacts: the vault must be a throwaway one in a temporary folder"); process.exit(2) }
mkdirSync(OUT, { recursive: true })
mkdirSync(`${VAULT}/QA`, { recursive: true })
const REAL = process.env.QA_SAMPLE === "1"
// A new page each run: what a run leaves (its data, the yes to asking Claude) belongs to that page only.
const NAME = `QA claude ${Date.now().toString(36)}.html`

const ART = `<!doctype html>
<html><head><title>QA claude</title></head>
<body><h1 id="ver">version one</h1><ul id="items"></ul><form id="form"><input name="q"><button id="go">Go</button></form>
<script>
window.__t = { snaps: [] }
document.getElementById("form").addEventListener("submit", (e) => { e.preventDefault(); window.__t.submitted = true })
;(async () => {
  const db = await claude.use("db"), art = await claude.use("artifact"), user = await claude.use("user")
  __t.nulls = [await claude.use("mcp"), await claude.use("room"), await claude.use("files")]
  __t.self = (await claude.use("self")) === art
  __t.sample = typeof (await claude.use("sample"))
  __t.perms = await (await claude.use("permissions")).state()
  __t.id = await user.id()
  __t.owner = await user.isOwner()
  const col = db.doc("data/users/" + __t.id + "/profile").collection("notes")
  col.orderBy("n", "desc").limit(2).onSnapshot((s) => {
    __t.snaps.push(s.docs.map((d) => d.data().n))
    document.getElementById("items").innerHTML = s.docs.map((d) => "<li>" + d.data().n + "</li>").join("")
  })
  try { db.doc("odd") } catch (e) { __t.badPath = e instanceof TypeError }
  const v = await window.storage.get("visits")
  __t.storage = await window.storage.set("visits", String(Number(v?.value ?? 0) + 1))
  __t.list = await window.storage.list("vis")
  __t.ready = true
})().catch((e) => { __t.error = String(e && (e.message || e.code || e)) })
window.add = (n) => claude.use("db").then((db) => db.collection("data/users/u_owner/profile/notes").add({ n }))
window.ask = (p, o) => claude.use("sample").then((s) => s(p, o)).then((r) => (__t.answer = r), (e) => (__t.answerError = e))
window.old = (p) => window.claude.complete(p).then((r) => (__t.completed = r), (e) => (__t.completeError = String(e)))
window.pub = async () => {
  const src = await vau.read("/" + vau.path)
  try { __t.published = await (await claude.use("artifact")).publish(src.replace("version one", "version two")) } catch (e) { __t.publishError = e }
}
</script></body></html>
`
writeFileSync(`${VAULT}/QA/${NAME}`, ART)
// Claude Code's Artifact tool reads a page back in this shape: a skeleton head, the page (title, style) inside body.
writeFileSync(`${VAULT}/QA/QA skeleton.html`, '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">' +
  "<style>*{box-sizing:border-box}body{margin:0}</style></head><body><title>Skeleton page</title><style>h1{color:rgb(1, 2, 3)}</style><h1>Drawn</h1>" +
  '<script>claude.use("db").then((db) => { window.__db = !!db })</script></body></html>')
const side = `${VAULT}/.vaultite/artifacts/QA/${NAME}.data.json`

const enc = encodeURIComponent
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } })
const page = watch(await ctx.newPage(), { label: "desktop" })
const frameOf = (name) => until(async () => {
  const f = page.frames().find((x) => x.url().includes(`/v/QA/${enc(name)}`) && x.url().includes("frame=1"))
  return f && (await f.evaluate(() => window.__t?.ready || window.__t?.error || window.__db !== undefined)) ? f : null
}, 15000, 250)
const t = (f) => f.evaluate(() => window.__t)

await page.goto(`${B}#file/${enc("QA/" + NAME)}`)
let f = await frameOf(NAME)
check("artifact opens", !!f)
let s = await t(f)
check("no errors", !s.error, s.error)
check("use(): unserved capabilities are null, self is artifact", s.nulls.every((x) => x === null) && s.self, s)
check("user: the owner, a stable id", s.owner === true && s.id === "u_owner", s)
check("permissions: served ones granted, sample asks", s.perms.db === "granted" && s.perms.artifact === "granted" && (s.sample !== "function" || s.perms.sample === "prompt"), s.perms)
check("db: a bad path throws a TypeError", s.badPath === true, s)
await f.click("#go")
check("a form's submit reaches the page", (await until(async () => (await t(f)).submitted, 2000)) === true)
check("window.storage: set and list", s.storage?.value === "1" && s.list?.keys?.includes("visits"), s)

// db: writes show in onSnapshot, ordered and limited, and are kept beside the artifact.
await f.evaluate(() => Promise.all([window.add(5), window.add(9), window.add(7)]))
s = await until(async () => { const x = await t(f); return x.snaps.at(-1)?.join() === "9,7" ? x : null }, 4000)
check("db: onSnapshot sees writes, ordered and limited", !!s, (await t(f)).snaps)
const kept = await until(() => { try { const d = JSON.parse(readFileSync(side, "utf8")); return Object.keys(d.db).length >= 3 && d.storage.personal.visits === "1" ? d : null } catch { return null } }, 4000)
check("db and storage kept in the sidecar", !!kept, existsSync(side) ? readFileSync(side, "utf8").slice(0, 300) : "none")

// A second view of it (an embed) hears the first one's writes.
writeFileSync(`${VAULT}/QA/QA claude note.md`, `# Two views\n\n![[${NAME}|200]]\n`)
const other = watch(await ctx.newPage(), { label: "second view" })
await other.goto(`${B}#file/${enc("QA/QA claude note.md")}`)
const f2 = await until(async () => {
  const x = other.frames().find((y) => y.url().includes(`/v/QA/${enc(NAME)}`) && y.url().includes("frame=1"))
  return x && (await x.evaluate(() => window.__t?.snaps?.length)) ? x : null
}, 15000, 250)
await f.evaluate(() => window.add(11))
check("db: another view hears the write", !!f2 && !!(await until(async () => (await t(f2)).snaps.at(-1)?.join() === "11,9", 4000)), f2 && (await t(f2)).snaps)
await other.close()
await f.evaluate(() => window.add(3)) // back to 9 on top after the delete below
await f.evaluate(() => claude.use("db").then(async (db) => { const s = await db.collection("data/users/u_owner/profile/notes").where("n", "==", 11).get(); for (const d of s.docs) await db.doc("data/users/u_owner/profile/notes/" + d.id).delete() }))
check("db: where() and delete()", !!(await until(async () => (await t(f)).snaps.at(-1)?.join() === "9,7", 4000)), (await t(f)).snaps)

// Consent: declined, sample rejects not_granted and isn't asked again in this view.
if (s?.sample === "function" || (await t(f)).sample === "function") {
  void f.evaluate(() => window.ask("Reply with exactly: ok", { modelTier: "quick" }))
  const no = await until(() => page.getByRole("button", { name: "Don't allow" }).first().isVisible().then((v) => v && page.getByRole("button", { name: "Don't allow" }).first()), 5000)
  check("first sample asks in the app", !!no)
  if (no) await no.click()
  s = await until(async () => { const x = await t(f); return x.answerError ? x : null }, 4000)
  check("declined: not_granted", s?.answerError?.code === "not_granted", s?.answerError)
  await f.evaluate(() => { window.__t.answerError = null; return window.ask("Reply with exactly: ok") })
  s = await t(f)
  check("declined: not asked again in this view", s.answerError?.code === "not_granted", s.answerError)
  if (REAL) {
    await page.reload()
    f = await frameOf(NAME)
    void f.evaluate(() => window.ask("Reply with exactly the word: pineapple", { modelTier: "quick", cache: false, onText: ({ text }) => { (window.__t.texts ??= []).push(text) } }))
    const yes = await until(() => page.getByRole("button", { name: "Allow", exact: true }).first().isVisible().then((v) => v && page.getByRole("button", { name: "Allow", exact: true }).first()), 5000)
    if (yes) await yes.click()
    s = await until(async () => { const x = await t(f); return x.answer || x.answerError ? x : null }, 90000, 500)
    check("sample answers, streamed", /pineapple/i.test(s?.answer?.text ?? "") && s.texts?.at(-1) === s.answer.text && s.answer.modelTierApplied === "quick", s?.answer ?? s?.answerError)
    await f.evaluate(() => window.old("Reply with exactly the word: mango"))
    s = await until(async () => { const x = await t(f); return x.completed || x.completeError ? x : null }, 90000, 500)
    check("complete(): the older API, no second ask", /mango/i.test(s?.completed ?? ""), s?.completed ?? s?.completeError)
  }
}

// publish: the file is rewritten, the frame reloads into the new version, the data stays.
await f.evaluate(() => window.pub())
const rewritten = await until(() => readFileSync(`${VAULT}/QA/${NAME}`, "utf8").includes("version two"), 4000)
check("publish rewrites the file", rewritten)
const reloaded = await until(async () => {
  const fr = page.frames().find((x) => x.url().includes(`/v/QA/${enc(NAME)}`) && x.url().includes("frame=1"))
  try { return (await fr?.evaluate(() => document.getElementById("ver")?.textContent)) === "version two" && fr } catch { return null }
}, 8000, 250)
check("the frame reloads into it", !!reloaded)
if (reloaded) {
  s = await until(async () => { const x = await t(reloaded); return x?.snaps?.length ? x : null }, 4000)
  check("db survives a publish", s?.snaps?.at(-1)?.join() === "9,7", s?.snaps)
  check("window.storage survives too", Number(s?.storage?.value) >= 2, s?.storage)
}
await page.screenshot({ path: `${OUT}claude-artifact.png` })

// The Artifact tool's shape: title from inside body, its style applied, the runtime there.
await page.goto("about:blank")
await page.goto(`${B}#file/${enc("QA/QA skeleton.html")}`)
const sk = await frameOf("QA skeleton.html")
check("skeleton page opens, with its runtime", !!sk && (await sk.evaluate(() => window.__db)) === true)
if (sk) {
  const look = await sk.evaluate(() => ({ title: document.title, color: getComputedStyle(document.querySelector("h1")).color }))
  check("its <title> and <style> inside body work", look.title === "Skeleton page" && look.color === "rgb(1, 2, 3)", look)
}
const files = await (await fetch(`${B}api/files`)).json()
const entry = files.files.find((x) => x.path === "QA/QA skeleton.html")
check("its title names it in the app", entry?.title === "Skeleton page", entry)
await wait(200)
await done()
