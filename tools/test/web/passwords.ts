import fs from "node:fs"
import path from "node:path"
import { check, section, skip, tempDir } from "../lib.ts"
import type { Enclave } from "../../../electron/browser/masterkey.ts"
import { messageOf } from "../../../electron/browser/messageof.ts"

// ---------- Browser: your passwords, the user's own KeePass file (electron/browser/kdbxedit.ts) ----------
// A made-up main file with a KeeShare-exported Agents group, as KeePassXC writes it; never a real one.
await section("your passwords", async () => {
  const kp = await import("../../../electron/browser/keepass.ts")
  const ed = await import("../../../electron/browser/kdbxedit.ts")
  const { Credentials, Kdbx, ProtectedValue } = await import("../../../electron/browser/kdbx/index.ts")
  const MAIN = "made-up main password", SHARE = "made-up share password"
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString(MAIN)), "Main")
  const agents = db.createGroup(db.getDefaultGroup(), "Agents")
  const b64 = (s: string) => Buffer.from(s).toString("base64")
  const ref = `<?xml version="1.0"?><KeeShare><Type><Export/></Type><Group>${Buffer.from(agents.uuid.bytes).toString("base64")}</Group><Path>${b64("agents.kdbx")}</Path><Password>${b64(SHARE)}</Password><KeepGroups>True</KeepGroups></KeeShare>`
  agents.customData = new Map([["KeeShare/Reference", { value: b64(ref) }]])
  const bank = db.createEntry(db.getDefaultGroup())
  bank.fields.set("Title", "Bank"); bank.fields.set("UserName", "alice"); bank.fields.set("Password", ProtectedValue.fromString("bank-pw"))
  db.createGroup(agents, "Projects")
  let file = new Uint8Array(await db.save())

  let main = await kp.loadKdbx(file, MAIN)
  const shares = ed.sharesOf(main, path.resolve("/made/up/Main.kdbx"))
  check("your passwords: KeePassXC's KeeShare export is found, its path against the file's folder", shares.length === 1 && shares[0].path === path.resolve("/made/up/agents.kdbx") && shares[0].password === SHARE && shares[0].keepGroups, shares.map((s) => s.path))
  const agentsId = shares[0].group, projects = ed.listOf(main, "/f").groups.find((g) => g.name === "Projects")!.id
  const id = ed.applyChange(main, { group: agentsId, title: "Lighthouse", username: "alice", password: "pw-1", urls: ["https://lighthouse.example.com", "https://auth.lighthouse.example.com"], tags: ["agent-free"], notes: "n" })
  const inSub = ed.applyChange(main, { group: projects, title: "Harbor", username: "bob", password: "pw-h", urls: ["harbor.example.org"], tags: [], notes: "" })
  file = new Uint8Array(await main.save())
  main = await kp.loadKdbx(file, MAIN)
  const list = ed.listOf(main, "/f")
  const light = list.entries.find((e) => e.id === id)!
  check("your passwords: a new entry keeps its addresses, tags and group", light.urls.length === 2 && light.free && light.group === agentsId && light.shared, light)
  check("your passwords: entries in the exported group (and its subgroups) are for agents, others aren't", list.entries.find((e) => e.id === inSub)!.shared && !list.entries.find((e) => e.title === "Bank")!.shared)
  check("your passwords: the list has no secret", !JSON.stringify(list).includes("pw-1") && !JSON.stringify(list).includes("bank-pw"))
  ed.applyChange(main, { id, title: "Lighthouse", username: "alice", password: "pw-2", urls: ["https://lighthouse.example.com"], tags: [], notes: "n" })
  const full = ed.fullOf(main, "/f", id)!
  const entry = ed.entryById(main, id)!
  check("your passwords: an edit changes it and keeps the old one in its history", kp.fieldsOf(entry).Password === "pw-2" && !full.free && full.urls.length === 1 && entry.history.length === 1 && full.history[0].changed.join() === "password,website,tags" && kp.fieldsOf(entry.history[0]).Password === "pw-1")

  const out = await kp.openDatabase(new Uint8Array(await ed.exportOf(main, shares[0])), SHARE)
  const ids = out.entries.map((e) => e.id).sort().join()
  check("your passwords: the export is what agents read, with the same entry ids, subgroups too", ids === [id, inSub].sort().join() && out.secrets(id)?.password === "pw-2", out.entries.map((e) => e.title))
  check("your passwords: nothing outside the exported group reaches agents", !out.entries.some((e) => e.title === "Bank"))

  ed.removeEntry(main, inSub)
  const binned = ed.listOf(main, "/f")
  check("your passwords: deleting goes to the recycle bin first", binned.groups.find((g) => g.id === binned.entries.find((e) => e.id === inSub)?.group)?.bin === true)
  ed.removeEntry(main, inSub, true)
  check("your passwords: deleting from the bin removes it", !ed.listOf(main, "/f").entries.some((e) => e.id === inSub))
  const after = await kp.openDatabase(new Uint8Array(await ed.exportOf(main, shares[0])), SHARE)
  check("your passwords: a deleted entry leaves the export", !after.entries.some((e) => e.id === inSub))
})

const MAIN = "made-up main password", OTHER = "made-up other password"
const bytes = (s: string) => new TextEncoder().encode(s)
const text = (b: Uint8Array | null) => b && new TextDecoder().decode(b)
const said = (p: Promise<unknown>) => p.then(() => "", (e) => messageOf(e))
const dir = tempDir("vau-passwords-"), FILE = path.join(dir, "Main.kdbx")

const { MasterKey, CANT } = await import("../../../electron/browser/masterkey.ts")
const flip = (b: Uint8Array) => Buffer.from(b.map((x) => x ^ 0x5a))
const asked: string[] = []
let refuses = "", n = 0
const enclave = (ready: boolean, broken = false): Enclave => ({ ready: () => ready, seal: (s) => { if (broken) throw new Error("broken"); return Uint8Array.from(s).reverse() },
  open: async (s, reason) => { asked.push(reason); if (refuses) throw new Error(refuses); return Uint8Array.from(s).reverse() } })
const computer = (o: { keyring?: boolean; enclave?: Enclave; finger?: boolean }) => {
  const at = path.join(dir, `master-${n++}`), keyring = o.keyring !== false
  fs.mkdirSync(at)
  const c = { enclave: o.enclave ?? null, disk: () => fs.readFileSync(path.join(at, "passwords.json"), "utf8"), launch: () => new MasterKey({
    dir: at, safe: { isEncryptionAvailable: () => keyring, encryptString: (s) => flip(Buffer.from(s)), decryptString: (b) => flip(b).toString() },
    enclave: async () => c.enclave, unsealed: (why) => { asked.push(`not sealed: ${why}`) }, finger: { can: () => o.finger !== false, ask: async (r) => { asked.push(`app: ${r}`); return true } } }) }
  return c
}

await section("where the master password comes from", async () => {
  const mac = computer({ enclave: enclave(true) }), key = mac.launch()
  await key.keep(FILE, bytes(MAIN))
  check("master password: on a Mac with Touch ID it's sealed, with no question, nothing else of it on disk", key.gated() && key.config()?.key === null && !mac.disk().includes(MAIN) && !asked.length)
  check("master password: sealed, nothing gives it with no finger, a new launch neither", key.silent() === null && mac.launch().silent() === null)
  check("master password: the finger is macOS's question, saying what for", text(await mac.launch().ask("unlock your passwords")) === MAIN && asked.join() === "unlock your passwords")
  const both = await Promise.all([key.ask("a"), key.ask("b")])
  check("master password: one question at a time, each asker its own copy", both.every((b) => text(b) === MAIN) && both[0] !== both[1] && asked.length === 2, asked)
  refuses = CANT.cancelled
  check("master password: a refused finger gives nothing", await said(key.ask("x")) === CANT.cancelled)
  refuses = ""
})

await section("the master password moved behind Touch ID", async () => {
  const mac = computer({ enclave: enclave(true) }), key = mac.launch()
  await key.keep(FILE, bytes(MAIN))
  mac.enclave = null
  check("master password: no Enclave to ask: the file's password is typed", await said(key.ask("x")) === CANT.unavailable)
  await key.keep(FILE, bytes(MAIN))
  check("master password: typed with Touch ID away (a lid closed), it stays behind it", key.gated() && key.silent() === null)
  await key.keep(path.join(dir, "Other.kdbx"), bytes(OTHER))
  check("master password: another file's, the keyring keeps it till Touch ID can", !key.gated() && text(key.silent()) === OTHER)
  const before = key.config()?.key ?? "?"
  mac.enclave = enclave(true)
  asked.length = 0
  const was = await key.ask("unlock your passwords"), moves = await key.couldBeGated()
  await key.keep(FILE, was)
  check("master password: one the keyring kept moves behind Touch ID at an unlock, its old copy gone", moves && asked.join() === "app: unlock your passwords" && key.gated() && !mac.disk().includes(before) && !await key.couldBeGated())
  check("master password: … and opens from there", text(await mac.launch().ask("again")) === OTHER)
})

await section("the master password with no Secure Enclave", async () => {
  const shut = computer({ enclave: enclave(false) }).launch()
  await shut.keep(FILE, bytes(MAIN))
  check("master password: Touch ID not there now (a lid closed): the keyring, till it is", !shut.gated() && text(shut.silent()) === MAIN && !await shut.couldBeGated())
  const broken = computer({ enclave: enclave(true, true) }), kept = broken.launch()
  asked.length = 0
  await kept.keep(FILE, bytes(MAIN))
  check("master password: an Enclave that won't seal (a locked Mac): the keyring, said, to be moved", text(kept.silent()) === MAIN && asked.join() === "not sealed: broken" && await kept.couldBeGated())
  const win = computer({ finger: false })
  await win.launch().keep(FILE, bytes(MAIN))
  check("master password: Windows and Linux, the keyring, and no finger to ask", text(win.launch().silent()) === MAIN && await said(win.launch().ask("x")) === CANT.unavailable)
  const bare = computer({ keyring: false, finger: false, enclave: enclave(true) }), only = bare.launch()
  await only.keep(FILE, bytes(MAIN))
  check("master password: no keyring, it's only held: not on disk, not after a launch", only.onlyHeld() && text(only.silent()) === MAIN && bare.launch().silent() === null && bare.disk() === JSON.stringify({ file: FILE, key: null }))
  only.forget()
  check("master password: forgotten", only.config() === null && only.silent() === null)
})

if (process.platform !== "darwin") skip("the Secure Enclave", "a Mac's")
else await section("the Secure Enclave", async () => {
  const { loadEnclave } = await import("../../../electron/enclave.ts")
  const { enclaveSwift } = await import("../../../electron/swiftbuild.ts")
  const file = await enclaveSwift.build(path.join(dir, "bin")), open = loadEnclave(file, false), gated = loadEnclave(file, true)
  if (!open.ready()) return skip("the Secure Enclave", "this Mac has none")
  let sealed: Uint8Array
  try { sealed = open.seal(bytes(MAIN)) } catch (e) { if (messageOf(e).includes("-25308")) return skip("the Secure Enclave", "this Mac is locked"); throw e }
  const cut = Uint8Array.from(sealed)
  check("enclave: what's sealed has none of it, and opens as it was", !Buffer.from(sealed).includes(MAIN) && text(await open.open(sealed, "x", true)) === MAIN)
  check("enclave: sealed again, another key", !Buffer.from(open.seal(bytes(MAIN))).equals(Buffer.from(sealed)))
  cut[cut.length - 1] ^= 1
  check("enclave: changed, it doesn't open", await said(open.open(cut, "x", true)) === CANT.invalid)
  check("enclave: what isn't one doesn't open", await said(open.open(bytes("nope"), "x", true)) === CANT.invalid && await said(open.open(Uint8Array.of(1, 255, 255, 0), "x", true)) === CANT.invalid)
  if (!gated.ready()) return skip("enclave: behind Touch ID", "Touch ID can't be used here now")
  check("enclave: sealed behind Touch ID with no question asked, never opened with no finger", await said(gated.open(gated.seal(bytes(MAIN)), "x", true)) === CANT.unavailable)
})

// ---------- Browser: a login sealed for another Mac's app (electron/browser/sealed.ts) ----------
await section("sealed logins", async () => {
  const sl = await import("../../../electron/browser/sealed.ts")
  const m1 = sl.newKeys(), m4 = sl.newKeys()
  const login = { names: ["example.com"], cookies: [{ name: "session", value: "s3cret", domain: ".example.com", path: "/" }], at: 1 }
  const box = sl.seal(m1.pub, login, "vaultite login for c-agents")
  check("sealed: what the servers pass on holds no cookie", !box.includes("s3cret") && !box.includes("session"))
  const opened = sl.open(m1, box, "vaultite login for c-agents")
  check("sealed: the app it's for opens it as it was", JSON.stringify(opened.data) === JSON.stringify(login) && opened.from.length > 20, opened)
  const fails = (f: () => unknown) => { try { f(); return false } catch { return true } }
  check("sealed: another app's key doesn't open it", fails(() => sl.open(m4, box, "vaultite login for c-agents")))
  check("sealed: it doesn't open for another set of logins", fails(() => sl.open(m1, box, "vaultite login for c-work")))
  const b = JSON.parse(box), ct = Buffer.from(b.ct, "base64url")
  ct[0] ^= 1
  check("sealed: a box changed on the way doesn't open", fails(() => sl.open(m1, JSON.stringify({ ...b, ct: ct.toString("base64url") }), "vaultite login for c-agents")))
  check("sealed: each box has a key of its own", JSON.parse(sl.seal(m1.pub, login, "x")).from !== b.from)
  check("sealed: what isn't a box, or a key, is refused", fails(() => sl.open(m1, "{}", "x")) && fails(() => sl.open(m1, "not json", "x")) && fails(() => sl.seal("nope", login, "x")))
})
