// The Passwords tab (plugins/core/web-viewer/Passwords.tsx) end to end in the desktop app, on a made-up KeePass file
// written here (groups, a KeeShare-exported Agents group, a one-time code, the recycle bin): set up, listed by group,
// searched, an entry's sheet (masked password, reveal, its code, agents' uses of it), edited with the generator and
// the agent-free switch, a new one, deleted with Undo, locked and unlocked, and what's written read back from the file.
// WRITES: the throwaway vault only (and the made-up file in a temporary folder).
//   node web/qa/passwords.mjs <vault copy> [<folder for its pictures>]
import { _electron } from "playwright-core"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { ROOT, qa, until, wait } from "./lib/qa.mjs"
import { otpOf, totp } from "../../electron/browser/keepass.ts"

const { args: [VAULT, SHOTS], check, errs, watch, done } = await qa(import.meta.url, { chrome: false })
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "vau-passwords-"))

// ---------- a made-up main file ----------
const { Credentials, Kdbx, ProtectedValue } = await import("kdbxweb")
const PW = "made-up main password", SECRET = "Lighthouse-7!pw", SEED = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
const db = Kdbx.create(new Credentials(ProtectedValue.fromString(PW)), "Passwords")
const b64 = (s) => Buffer.from(s).toString("base64")
const work = db.createGroup(db.getDefaultGroup(), "Work"), agents = db.createGroup(db.getDefaultGroup(), "Agents")
agents.customData = new Map([["KeeShare/Reference", { value: b64(`<?xml version="1.0"?><KeeShare><Type><Export/></Type><Group>${Buffer.from(agents.uuid.bytes).toString("base64")}</Group><Path>${b64("agents.kdbx")}</Path><Password>${b64("made-up share")}</Password><KeepGroups>True</KeepGroups></KeeShare>`) }]])
const add = (group, title, user, pw, url, tags = [], more = {}) => {
  const e = db.createEntry(group)
  e.fields.set("Title", title); e.fields.set("UserName", user); e.fields.set("Password", ProtectedValue.fromString(pw)); e.fields.set("URL", url)
  for (const [k, v] of Object.entries(more)) e.fields.set(k, k === "otp" ? ProtectedValue.fromString(v) : v)
  e.tags = tags
  return e
}
add(work, "Lighthouse", "alice", SECRET, "https://lighthouse.example.com", ["work"], { otp: `otpauth://totp/Lighthouse:alice?secret=${SEED}&period=30`, Notes: "Front desk: ask for Bo." })
add(agents, "Harbor", "alice@example.com", "harbor-pw", "harbor.example.org")
add(db.getDefaultGroup(), "Bank", "alice.park", "bank-pw", "https://bank.example.net")
const binned = add(db.getDefaultGroup(), "Old mail", "old", "old-pw", "https://mail.example.com")
db.createRecycleBin()
db.move(binned, db.getGroup(db.meta.recycleBinUuid))
const DB = path.join(TMP, "Passwords.kdbx")
fs.writeFileSync(DB, Buffer.from(await db.save()))
const reread = async () => {
  const d = await Kdbx.load(new Uint8Array(fs.readFileSync(DB)).buffer, new Credentials(ProtectedValue.fromString(PW)))
  const all = []; const walk = (g) => { for (const e of g.entries) all.push({ e, group: g.name }); g.groups.forEach(walk) }; walk(d.getDefaultGroup())
  const text = (v) => (v && typeof v.getText === "function" ? v.getText() : v ?? "")
  return all.map(({ e, group }) => ({ title: text(e.fields.get("Title")), username: text(e.fields.get("UserName")), password: text(e.fields.get("Password")), tags: e.tags, group }))
}

// ---------- the app ----------
const plugins = path.join(VAULT, ".vaultite/plugins.json")
const on = fs.existsSync(plugins) ? JSON.parse(fs.readFileSync(plugins, "utf8")) : { enabled: [], disabled: [] }
fs.writeFileSync(plugins, JSON.stringify({ ...on, enabled: [...new Set([...(on.enabled ?? []), "web-viewer"])] }))
const app = await _electron.launch({
  executablePath: path.join(ROOT, "node_modules/.bin/electron"), args: [ROOT, "--vault", VAULT],
  env: { ...process.env, VAULTITE_QUIET: process.env.SHOW ? "" : "1", VAULTITE_USER_DATA: path.join(TMP, "userData"), VAULTITE_LOCAL: path.join(TMP, "local"), VAULTITE_TEST_TOUCHID: "yes" },
})
let output = ""
app.process().stdout?.on("data", (d) => { output += d })
app.process().stderr?.on("data", (d) => { output += d })
const win = await app.firstWindow()
watch(win, { console: true, fail: false })
await win.waitForSelector("[role=tree]", { timeout: 60000 })
const origin = new URL(win.url()).origin
await app.evaluate(({ BaseWindow }) => { BaseWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1300, height: 860 }) })
const engine = (name, ...args) => win.evaluate(([n, a]) => window.vaultite.web.engine(n, ...a), [name, args])
const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await wait(400); await win.screenshot({ path: path.join(SHOTS, `passwords-${name}.png`) }) } }
const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText())
// (agents' uses: made up, as the server would answer)
const USES = { uses: [{ t: Date.now() - 120_000, entry: { title: "Harbor", username: "alice@example.com" }, site: "harbor.example.org", agent: "Claude Code", status: "filled", approved: "the user's passkey (iPhone)", machine: "m1" }] }
await win.route("**/api/web-viewer/login-uses", (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(USES) }))
await wait(1500)
const sheet = win.locator("dialog[open]").last()
const toast = (text) => win.locator("[data-sonner-toast]", { hasText: text }).last()
const rows = () => win.locator("[data-passwords-entry]").evaluateAll((els) => els.filter((e) => !e.closest("[data-kept]") && !e.hasAttribute("data-leaving")).map((e) => e.getAttribute("data-passwords-entry")))

// ---------- not set up ----------
const ran = await fetch(`${origin}/api/ops/ui.command`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: "web:passwords" }) }).then((r) => r.json()).catch((e) => ({ error: String(e) }))
check("Show passwords opens the tab: not set up, it asks for the file", await until(() => win.locator("[data-passwords-setup] [data-passwords-choose]").isVisible(), 8000), ran)
await shot("setup")

// (the OS file dialog can't be driven here: the file and its password as Choose and its dialog give them)
const set = await engine("passwords:set", DB, PW)
check("set up: it opens, unlocked", set?.file === DB && set.locked === false, set)
check("its entries listed, the recycle bin's left out, by title", await until(async () => (await rows()).join() === "Bank,Harbor,Lighthouse", 8000), await rows())
check("its groups at the side: all, Work, Agents, the recycle bin, agents' logins", await until(async () =>
  (await win.locator("[data-passwords-group]").evaluateAll((els) => els.map((e) => e.getAttribute("data-passwords-group")))).length === 5, 3000),
  await win.locator("[data-passwords-groups]").innerText().catch(() => ""))
check("the shared entry is marked for agents", await win.locator('[data-passwords-entry="Harbor"] [data-passwords-mark="shared"]').count() === 1)
check("no password in the list", !(await win.locator("[data-passwords-list]").innerText()).includes(SECRET))
await shot("list")

// ---------- search and groups ----------
const search = win.locator('[data-passwords] input[type="search"]')
await search.fill("example.org")
check("search by website", await until(async () => (await rows()).join() === "Harbor", 2000), await rows())
await search.fill("work")
check("… by tag", await until(async () => (await rows()).join() === "Lighthouse", 2000), await rows())
await search.fill("")
await win.locator("[data-passwords-group]", { hasText: "Recycle bin" }).click()
check("the recycle bin shows what's in it", await until(async () => (await rows()).join() === "Old mail", 2000), await rows())
await win.locator('[data-passwords-group="all"]').click()

// ---------- an entry's sheet ----------
await win.locator('[data-passwords-entry="Lighthouse"]').click()
await sheet.locator("[data-password-sheet]").waitFor({ timeout: 5000 })
check("its sheet: username and website, the password masked", /alice/.test(await sheet.innerText()) && /lighthouse\.example\.com/.test(await sheet.innerText()) && !(await sheet.innerText()).includes(SECRET))
const code = (await sheet.locator("[data-password-code]").innerText()).replace(/\D/g, "").slice(0, 6)
const now = totp(otpOf({ otp: `otpauth://totp/x?secret=${SEED}` }), Date.now()), before = totp(otpOf({ otp: `otpauth://totp/x?secret=${SEED}` }), Date.now() - 30_000)
check("its one-time code, as RFC 6238 has it now", code === now || code === before, [code, now])
await sheet.getByRole("button", { name: "Show password" }).click()
check("Show password reveals it", (await sheet.innerText()).includes(SECRET))
await sheet.getByRole("button", { name: "Copy password" }).click()
check("Copy password copies it", await until(async () => (await clipboard()) === SECRET, 2000))
check("… and says it's cleared in 30 seconds", await until(() => toast("cleared in 30 seconds").count(), 2000) > 0)
check("its notes", /Front desk: ask for Bo/.test(await sheet.innerText()))
await shot("entry")
await win.keyboard.press("Escape")

await win.locator('[data-passwords-entry="Harbor"]').click()
await sheet.locator("[data-password-sheet]").waitFor({ timeout: 5000 })
check("used by agents: which, where, how approved", await until(async () => /Claude Code · harbor\.example\.org · .* · approved with iPhone/.test(await sheet.innerText()), 3000), await sheet.innerText())

// ---------- editing: the generator, the agent-free switch ----------
await sheet.locator("[data-password-edit]").click()
await sheet.locator('[data-password-form="edit"]').waitFor({ timeout: 5000 })
check("the switch can be turned on for a shared entry", await sheet.locator('[data-password-free="can"]').count() === 1)
await sheet.locator("[data-password-generate]").click()
const generated = await sheet.locator('[data-password-field="password"]').inputValue()
check("Generate makes a 20-character password, shown", generated.length === 20 && generated !== "harbor-pw" && await sheet.locator('[data-password-field="password"]').getAttribute("type") === "text", generated)
await sheet.getByRole("switch", { name: "Digits" }).click()
const noDigits = await sheet.locator('[data-password-field="password"]').inputValue()
check("… a kind turned off makes another without it", noDigits !== generated && !/\d/.test(noDigits), noDigits)
await shot("edit")
await sheet.getByRole("switch", { name: "Agents can use it without asking" }).click()
await sheet.locator('[data-password-field="username"]').fill("harbor@example.org")
await sheet.locator("[data-password-save]").click()
check("saved: back to its sheet, changed", await until(async () => /harbor@example\.org/.test(await sheet.innerText().catch(() => "")), 5000), await sheet.innerText().catch(() => ""))
const afterEdit = (await reread()).find((e) => e.title === "Harbor")
check("… in the file: the username, the generated password, the agent-free tag", afterEdit?.username === "harbor@example.org" && afterEdit.password === noDigits && afterEdit.tags.includes("agent-free"), afterEdit && { ...afterEdit, password: afterEdit.password === noDigits })
await win.keyboard.press("Escape")
check("… and the list marks it agent-free", await until(() => win.locator('[data-passwords-entry="Harbor"] [data-passwords-mark="free"]').count(), 3000) === 1)

await win.locator('[data-passwords-entry="Bank"]').click({ button: "right" })
await win.getByRole("menuitem", { name: "Edit" }).click()
await sheet.locator('[data-password-form="edit"]').waitFor({ timeout: 5000 })
check("the switch can't be turned on for an entry agents don't share", await sheet.locator('[data-password-free="cannot"]').count() === 1
  && await sheet.getByRole("switch", { name: "Agents can use it without asking" }).isDisabled())
await sheet.locator('[data-password-field="title"]').fill("Bank of Lighthouse")
await win.keyboard.press("Escape")
check("an unsaved change asks before the sheet closes", await until(() => win.locator("[data-confirm]").isVisible(), 2000))
await win.locator("[data-confirm-ok]").click()
check("… Discard closes it, nothing written", await until(async () => !(await win.locator("dialog[open] [data-password-form]").count()), 2000) && !(await reread()).some((e) => e.title === "Bank of Lighthouse"))

// ---------- a new one, in a group ----------
await win.locator("[data-passwords-group]", { hasText: "Work" }).click()
await win.locator("[data-passwords-new]").click()
await sheet.locator('[data-password-form="new"]').waitFor({ timeout: 5000 })
await sheet.locator('[data-password-field="title"]').fill("Ferry")
await sheet.locator('[data-password-field="username"]').fill("alice")
await sheet.locator('[data-password-field="password"]').fill("ferry-pw")
await sheet.locator('[data-password-field="url"]').fill("ferry.example.com")
await sheet.locator("[data-password-add-url]").click()
await sheet.locator('[data-password-field="url"]').nth(1).fill("https://tickets.ferry.example.com")
await sheet.locator('[data-password-field="title"]').press("Enter")
check("a new one: its sheet shows it", await until(async () => /Ferry/.test(await sheet.locator("[data-password-sheet]").innerText().catch(() => "")), 5000))
const ferry = (await reread()).find((e) => e.title === "Ferry")
check("… in the file, in the group it was made in", ferry?.group === "Work" && ferry.password === "ferry-pw", ferry)
await win.keyboard.press("Escape")
check("… and in the group's list", await until(async () => (await rows()).join() === "Ferry,Lighthouse", 3000), await rows())
await win.locator('[data-passwords-group="all"]').click()

// ---------- delete, Undo ----------
await win.locator('[data-passwords-entry="Ferry"]').click()
await sheet.locator("[data-password-delete]").click()
check("Delete: off the list at once, with Undo", await until(async () => !(await rows()).includes("Ferry"), 3000) && await until(() => toast("to the recycle bin").count(), 2000) > 0, await rows())
check("… in the file's recycle bin", await until(async () => (await reread()).find((e) => e.title === "Ferry")?.group === "Recycle Bin", 3000), (await reread()).map((e) => `${e.title}:${e.group}`))
await toast("to the recycle bin").locator("[data-button]").click()
check("Undo puts it back in its group", await until(async () => (await reread()).find((e) => e.title === "Ferry")?.group === "Work", 5000) && await until(async () => (await rows()).includes("Ferry"), 3000),
  [await win.locator("[data-sonner-toast]").allInnerTexts(), (await reread()).map((e) => `${e.title}:${e.group}`)])

// ---------- the lock ----------
await win.locator('[data-passwords-action="lock"]').click()
check("Lock: the lock screen, its file named, nothing listed", await until(() => win.locator("[data-passwords-lock]").isVisible(), 3000) && !(await rows()).length
  && /Passwords\.kdbx/.test(await win.locator("[data-passwords-lock]").locator("..").innerText()))
await win.locator("[data-passwords-password]").fill("not it")
await win.locator("[data-passwords-password]").press("Enter")
check("a wrong password says so", await until(() => win.locator("[data-passwords-unlock-error]").isVisible(), 3000), await win.locator("[data-passwords-unlock-error]").innerText().catch(() => ""))
await shot("locked")
await win.locator("[data-passwords-password]").fill(PW)
await win.locator("[data-passwords-password]").press("Enter")
check("its password unlocks it", await until(async () => (await rows()).length === 4, 5000), await rows())
await win.locator('[data-passwords-entry="Lighthouse"]').click()
await sheet.locator("[data-password-sheet]").waitFor({ timeout: 5000 })
await engine("passwords:lock")
check("locked while a sheet shows an entry: the sheet shows the lock instead", await until(async () => await sheet.locator("[data-passwords-lock]").count() === 1 && !(await sheet.innerText()).includes("Front desk"), 3000))
await win.keyboard.press("Escape")

// ---------- the clipboard, 30 s on ----------
await engine("passwords:unlock")
await until(async () => (await rows()).length === 4, 5000)
await win.locator('[data-passwords-entry="Bank"]').click({ button: "right" })
await win.getByRole("menuitem", { name: "Copy password" }).click()
check("Copy password from a row's menu", await until(async () => (await clipboard()) === "bank-pw", 3000))
await win.bringToFront()
await wait(31_000)
check("… cleared from the clipboard 30 seconds on", (await clipboard()) === "", await clipboard() === "bank-pw" ? "still there" : "something else")

// ---------- stop using it ----------
await win.locator('[data-passwords-action="more"]').click()
await win.getByRole("menuitem", { name: "Stop using it" }).click()
check("Stop using it: back to choosing a file", await until(() => win.locator("[data-passwords-setup]").isVisible(), 3000))
check("no secret in the app's or the server's output", ![SECRET, PW, "bank-pw", "ferry-pw"].some((s) => output.includes(s)), output.slice(-400))
await app.close()
console.log(errs.length ? `page errors:\n${errs.slice(0, 5).join("\n")}` : "no page errors")
fs.rmSync(TMP, { recursive: true, force: true })
await done()
