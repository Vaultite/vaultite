// vau secret (secret.ask, core/coreops/secret.ts; the window's answer in components/ConfirmDialog.tsx): a dialog with a
// hidden field, Send off until something's typed; Enter sends it, printed exactly (no newline when piped); Esc fails with
// nothing printed; --file sends a text file as is and a binary one as base64; a timeout closes the dialog. Opens the app
// in headless Chrome. With another machine's server sharing the vault (listed in Machines), the ask shows in a window
// open only there, and its answer comes back. WRITES: nothing in the vault.
//   node web/qa/secret.mjs <base url> [<other machine's base url>]
import { spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { CHROME, qa, ROOT, wait } from "./lib/qa.mjs"

if (!fs.existsSync(CHROME)) { console.log("secret: skipped (no Google Chrome here)"); process.exit(0) }
const { args: [arg, other], browser, check, done } = await qa(import.meta.url)
const base = arg.endsWith("/") ? arg : `${arg}/`
/** vau running in the background, stdout piped: its exit status and output once it ends. */
const vau = (args) => new Promise((resolve) => {
  const p = spawn(process.execPath, [path.join(ROOT, "bin/vau"), ...args], { env: { ...process.env, VAULTITE_URL: base.replace(/\/$/, "") } })
  let stdout = "", stderr = ""
  p.stdout.on("data", (d) => { stdout += d })
  p.stderr.on("data", (d) => { stderr += d })
  p.on("close", (status) => resolve({ status, stdout, stderr }))
  p.stdin.end()
})

try {
  let r = await vau(["secret", "Wi-Fi password"])
  check("no window open: says so, exit 1", r.status === 1 && r.stderr.includes("no app window is open"), r)

  for (const [name, viewport] of [["desktop", { width: 1280, height: 800 }], ["phone", { width: 390, height: 844 }]]) {
    const ctx = await browser.newContext({ viewport, ...(name === "phone" ? { isMobile: true, hasTouch: true } : {}) })
    const page = await ctx.newPage()
    await page.goto(base)
    await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
    await wait(1500)
    const dialog = () => page.locator("dialog[data-confirm]")
    const shown = () => page.waitForSelector("dialog[data-confirm][open]", { timeout: 5000 }).then(() => true, () => false)
    const send = () => dialog().locator("[data-confirm-ok]")

    let run = vau(["secret", "Wi-Fi password"])
    check(`${name}: the dialog shows`, await shown(), null)
    const text = await dialog().innerText()
    check(`${name}: the prompt and who asks`, text.includes("Wi-Fi password") && text.includes("asks for this"), text)
    check(`${name}: a hidden field, focused, Send off until typed`, await dialog().locator("input[type=password]").evaluate((e) => e === document.activeElement) && await send().isDisabled(), null)
    await page.keyboard.type("hunter2 x")
    await wait(400)
    await page.screenshot({ path: `/tmp/secret-${name}.png` }).catch(() => {})
    await page.keyboard.press("Enter")
    r = await run
    check(`${name}: Enter sends it, printed exactly`, r.status === 0 && r.stdout === "hunter2 x", r)
    check(`${name}: the dialog is gone`, (await dialog().count()) === 0 || !(await dialog().evaluate((d) => d.open)), null)

    run = vau(["secret", "Something"])
    await shown()
    await page.keyboard.press("Escape")
    r = await run
    check(`${name}: Esc fails, nothing printed`, r.status === 1 && r.stdout === "" && r.stderr.includes("didn't give it"), r)

    const pem = "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----\n"
    run = vau(["secret", "The key", "--file"])
    await shown()
    await dialog().locator("input[type=file]").setInputFiles({ name: "AuthKey.p8", mimeType: "application/octet-stream", buffer: Buffer.from(pem) })
    await wait(200)
    check(`${name}: the file's name shown`, (await dialog().innerText()).includes("AuthKey.p8"), await dialog().innerText())
    await send().click()
    r = await run
    check(`${name}: a text file as is`, r.status === 0 && r.stdout === pem, r)

    const bin = Buffer.from([0x30, 0x82, 0xff, 0xfe, 0x00, 0x01])
    run = vau(["secret", "The certificate", "--file"])
    await shown()
    await dialog().locator("input[type=file]").setInputFiles({ name: "cert.p12", mimeType: "application/x-pkcs12", buffer: bin })
    await wait(200)
    await send().click()
    r = await run
    check(`${name}: a binary file as base64`, r.status === 0 && r.stdout === bin.toString("base64"), r)
    await ctx.close()
  }

  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto(base)
  await page.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
  await wait(1500)
  r = await vau(["secret", "Late", "--timeout", "5"])
  await wait(300)
  check("timeout: exit 1, and the dialog closes", r.status === 1 && (await page.locator("dialog[data-confirm][open]").count()) === 0, r)
  await ctx.close()

  if (other) {
    const there = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const phone = await there.newPage()
    await phone.goto(other)
    await phone.waitForFunction(() => document.querySelector("#root > *"), null, { timeout: 20000 })
    await wait(1500)
    const run = vau(["secret", "From the other machine"])
    const shown = await phone.waitForSelector("dialog[data-confirm][open]", { timeout: 10000 }).then(() => true, () => false)
    check("another machine: the ask shows in its window", shown, null)
    check("another machine: it says which machine asks", shown && / on \S/.test(await phone.locator("dialog[data-confirm]").innerText()), shown && await phone.locator("dialog[data-confirm]").innerText())
    await phone.keyboard.type("from afar")
    await phone.keyboard.press("Enter")
    r = await run
    check("another machine: its answer comes back here, exactly", r.status === 0 && r.stdout === "from afar", r)
    await there.close()
  }
} finally {
  await done()
}
