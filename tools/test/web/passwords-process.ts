import fs from "node:fs"
import path from "node:path"
import { check, section, sleep, tempDir } from "../lib.ts"
import { diskTree, graphOf } from "../../../core/update/closure.ts"
import type { Child } from "../../../electron/browser/kdbxclient.ts"
import { messageOf } from "../../../electron/browser/messageof.ts"

const ROOT = path.resolve(import.meta.dirname, "../../..")
const MAIN = "made-up main password", SHARE = "made-up share password"
const bytes = (s: string) => new TextEncoder().encode(s)
const said = (p: Promise<unknown>) => p.then(() => "", (e) => messageOf(e))
const until = async (is: () => boolean) => { for (let i = 0; i < 400 && !is(); i++) await sleep(10); return is() }
const { openDatabase } = await import("../../../electron/browser/keepass.ts")
const { KdbxFiles } = await import("../../../electron/browser/kdbxfile.ts")
const dir = tempDir("vau-passwords-process-")
const FILE = path.join(dir, "Main.kdbx"), BACKUPS = path.join(dir, "backups")
const main = () => ({ file: FILE, password: bytes(MAIN) })
const passwordNow = async (id: string) => (await openDatabase(fs.readFileSync(FILE), MAIN)).secrets(id)?.password
{
  const { Credentials, Kdbx, ProtectedValue } = await import("../../../electron/browser/kdbx/index.ts")
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString(MAIN)), "Main")
  const agents = db.createGroup(db.getDefaultGroup(), "Agents"), b64 = (s: string) => Buffer.from(s).toString("base64")
  const ref = `<?xml version="1.0"?><KeeShare><Type><Export/></Type><Group>${Buffer.from(agents.uuid.bytes).toString("base64")}</Group><Path>${b64("agents.kdbx")}</Path><Password>${b64(SHARE)}</Password><KeepGroups>True</KeepGroups></KeeShare>`
  agents.customData = new Map([["KeeShare/Reference", { value: b64(ref) }]])
  for (const [group, title, pw, url] of [[db.getDefaultGroup(), "Bank", "bank-pw", "https://bank.example.com"], [agents, "Lighthouse", "light-pw", "https://lighthouse.example.com"]] as const) {
    const e = db.createEntry(group)
    e.fields.set("Title", title); e.fields.set("UserName", "alice"); e.fields.set("Password", ProtectedValue.fromString(pw)); e.fields.set("URL", url)
  }
  fs.writeFileSync(FILE, Buffer.from(await db.save()))
}

await section("passwords process: the file", async () => {
  const f = new KdbxFiles(BACKUPS)
  check("passwords process: locked, a call with no password says so", await said(f.list({ file: FILE })) === "locked")
  const rows = await f.entriesForUrl(main(), "https://bank.example.com/login")
  check("passwords process: a locked call with its password answers for itself alone", rows.length === 1 && rows[0].title === "Bank" && await said(f.list({ file: FILE })) === "locked", rows)
  const given = main()
  await f.check(given)
  check("passwords process: a call's password is zeroed once used", given.password.every((b) => b === 0))
  check("passwords process: which entries have a password", (await f.samePassword(main(), [rows[0].id], "bank-pw")).length === 1 && (await f.samePassword(main(), [rows[0].id], "nope")).length === 0)
  check("passwords process: a wrong password opens nothing", /doesn't open it/.test(await said(f.unlock({ file: FILE, password: bytes("nope") }))) && await said(f.list({ file: FILE })) === "locked")
  const held = bytes(MAIN)
  await f.unlock({ file: FILE, password: held })
  check("passwords process: unlocked, calls need no password", (await f.list({ file: FILE })).entries.length === 2)
  const was = fs.readFileSync(FILE), first = (await f.list({ file: FILE })).entries[0]
  await new KdbxFiles(BACKUPS).keepSecret(main(), "Written elsewhere", "x")
  check("passwords process: what another app wrote is read at once", (await f.list({ file: FILE })).entries.length === 3)
  fs.writeFileSync(FILE, was)
  check("passwords process: … and its old copy put back too", (await f.list({ file: FILE })).entries.length === 2 && (await f.get({ file: FILE }, first.id))?.title === first.title)
  check("passwords process: the file held open is that file only", await said(f.list({ file: path.join(dir, "Other.kdbx") })) === "locked")
  f.lock()
  check("passwords process: a lock zeroes the password held, and calls need it again", held.every((b) => b === 0) && await said(f.list({ file: FILE })) === "locked")
  const opening = f.unlock(main())
  f.lock()
  check("passwords process: an unlock a lock overtook stays locked", await said(opening) === "locked" && await said(f.list({ file: FILE })) === "locked")
  const s = await f.keepSecret(main(), "Made-up API key", "key-2"), again = await f.keepSecret(main(), "Made-up API key", "key-3")
  check("passwords process: a secret kept while locked, the same prompt changing it", s.id === again.id && await passwordNow(s.id) === "key-3")
  const made = await f.saveLogin(main(), { url: "https://www.harbor.example.org/x", username: "bob", given: "harbor-pw" })
  check("passwords process: a login saved while locked", await passwordNow(made.id) === "harbor-pw")
  check("passwords process: only a web page's login", /only a web page/.test(await said(f.saveLogin(main(), { url: "file:///etc", username: "", given: "x" }))))
  const shared = await openDatabase(fs.readFileSync(path.join(dir, "agents.kdbx")), SHARE)
  check("passwords process: each save writes the KeeShare export", shared.entries.map((e) => e.title).join() === "Lighthouse")

  const copies = fs.readdirSync(BACKUPS).length
  const [theirs, ours] = await Promise.all([new KdbxFiles(BACKUPS), f].map((x, i) => x.saveLogin(main(), { url: `https://both-${i}.example.com`, username: "t", given: `pw-${i}` })))
  check("passwords process: a write that came in meanwhile is kept, ours applied on it", await passwordNow(theirs.id) === "pw-0" && await passwordNow(ours.id) === "pw-1")
  check("passwords process: the old copy is kept", fs.readdirSync(BACKUPS).length > copies)
  for (let i = 0; i < 40; i++) fs.writeFileSync(path.join(BACKUPS, `${1000 + i}-Main.kdbx`), "")
  await f.delete(main(), { ids: [made.id], forever: false })
  check("passwords process: the last 30 old copies are kept, no more", fs.readdirSync(BACKUPS).length === 30, fs.readdirSync(BACKUPS).length)
  check("passwords process: nothing half-written is left beside it", !fs.readdirSync(dir).some((n) => n.endsWith(".tmp")))
  check("passwords process: the agents' file is read, never held open", (await f.agents({ file: path.join(dir, "agents.kdbx"), password: bytes(SHARE) }, (db) => db.entries)).length === 1)
})

await section("passwords process: started, ended", async () => {
  const { serving } = await import("../../../electron/browser/kdbxserve.ts")
  const { KdbxClient } = await import("../../../electron/browser/kdbxclient.ts")
  const { OPS } = await import("../../../electron/browser/kdbxwire.ts")
  type Kid = { ended: boolean; die: () => void; asks: string[]; files: InstanceType<typeof KdbxFiles> }
  const kids: Kid[] = [], asked = (what: string) => until(() => !!kids.at(-1)?.asks.some((x) => x.includes(what)))
  function start(): Child {
    const files = new KdbxFiles(BACKUPS), answer = serving(files)
    let heard: Parameters<Child["onMessage"]>[0] = () => {}, left = () => {}
    const kid: Kid = { ended: false, asks: [], files, die: () => { if (!kid.ended) { kid.ended = true; setImmediate(() => left()) } } }
    kids.push(kid)
    return {
      postMessage: (m) => {
        const copy = structuredClone(m)
        kid.asks.push(JSON.stringify(copy))
        void answer(copy).then((a) => { if (a && !kid.ended) heard(structuredClone(a)) })
      },
      onMessage: (fn) => { heard = fn }, onExit: (fn) => { left = fn }, kill: kid.die,
    }
  }
  let crashes = 0
  const c = new KdbxClient(start, () => { crashes++ }, 30), file = FILE, url = "https://bank.example.com"
  c.lock()
  check("passwords process: none till it's asked something, a lock included", kids.length === 0 && !c.running())
  await c.call(OPS.entriesForUrl, { ...main(), url })
  check("passwords process: started at the first ask, ended once idle while locked", kids.length === 1 && await until(() => kids[0].ended) && !c.running())
  const wrong = await said(c.call(OPS.unlock, { file, password: bytes("nope") }))
  check("passwords process: an error is its words alone", wrong === "the password doesn't open it" && !c.unlocked(), wrong)
  await c.call(OPS.unlock, main())
  await sleep(120)
  const open = kids.at(-1)!
  check("passwords process: unlocked, it stays and holds the file open", c.unlocked() && !open.ended && (await c.call(OPS.list, { file })).entries.length > 1)
  check("passwords process: an ask after the unlock carries no password", !open.asks.at(-1)!.includes('"password":'), open.asks.at(-1))
  c.lock()
  check("passwords process: a lock clears it and ends it", !c.unlocked() && await until(() => open.ended) && await said(open.files.list({ file })) === "locked")
  await c.call(OPS.unlock, main())
  const saving = c.call(OPS.keepSecret, { file, title: "Late", value: "late-1" })
  await asked("keepSecret")
  c.lock()
  const next = c.call(OPS.entriesForUrl, { ...main(), url })
  const late = await saving.catch((e) => ({ id: messageOf(e) }))
  check("passwords process: a save under way at a lock finishes first", await passwordNow(late.id) === "late-1", late)
  check("passwords process: the next ask waits for the old one's end", (await next).length === 1 && kids.filter((k) => !k.ended).length <= 1)
  const opening = c.call(OPS.unlock, main())
  await asked("unlock")
  c.lock()
  check("passwords process: an unlock a lock overtook isn't one", await said(opening) === "locked" && !c.unlocked())
  await c.call(OPS.unlock, main())
  kids.at(-1)!.die()
  check("passwords process: ended by itself while unlocked, the app locks", await until(() => crashes === 1) && !c.unlocked())
  const answer = serving(new KdbxFiles(BACKUPS))
  check("passwords process: asks it doesn't know are refused, what isn't an ask gets no answer", /not a thing/.test(JSON.stringify(await answer({ id: 1, op: "eval", args: "1" }))) && await answer("hello") === null)
})

await section("passwords: what locked calls go by, and the lock's time", async () => {
  const { indexedFor, indexedSame, indexOf, fingerprint, newSalt } = await import("../../../electron/browser/passwordsindex.ts")
  const salt = newSalt(), x = indexOf(JSON.stringify({ file: FILE, salt, rows: await new KdbxFiles(BACKUPS).index(main(), salt) }))!
  const bank = indexedFor(x, "https://bank.example.com/login")
  check("passwords index: a site's logins, with no secret nor fingerprint", bank.length === 1 && bank[0].title === "Bank" && !("fp" in bank[0]) && !indexedFor(x, "https://bank.example.org").length && !/bank-pw|light-pw|late-1/.test(JSON.stringify(x)))
  check("passwords index: whether a sign-in's password is the saved one", indexedSame(x, [bank[0].id], "bank-pw").length === 1 && !indexedSame(x, [bank[0].id], "bank-pw2").length)
  check("passwords index: a fingerprint is 16 bits, its entry's own", /^[0-9a-f]{4}$/.test(fingerprint(salt, "a", "p")) && new Set(["a", "b", "c", "d"].map((id) => fingerprint(salt, id, "p"))).size > 1)
  check("passwords index: what isn't one reads as none", indexOf("{}") === null && indexOf("nope") === null)
  const { openFor } = await import("../../../electron/browser/passwordslock.ts")
  let lapsed = 0
  const t = openFor(200, () => { lapsed++ })
  check("passwords lock: shut till opened", !t.isOpen() && !t.close())
  t.open()
  await sleep(120)
  t.open()
  await sleep(120)
  check("passwords lock: each use gives it its whole time again", t.isOpen() && lapsed === 0)
  check("passwords lock: its time up, it locks by itself", await until(() => lapsed === 1) && t.close())
  t.open()
  t.close()
  await sleep(300)
  check("passwords lock: locked by hand, no timer is left", lapsed === 1)
})

await section("passwords process: what each side can reach", () => {
  const g = graphOf(diskTree(ROOT), { entries: [
    { id: "main", label: "main", from: ["electron/shell/boot.mjs"], mode: "node", cut: ["electron/browser/kdbxproc.ts"] },
    { id: "proc", label: "proc", from: ["electron/browser/kdbxproc.ts"], mode: "node" },
  ] })
  const all = [...g.reach("main").files.keys()], proc = [...g.reach("proc").files.keys()].filter((f) => /\.[cm]?[jt]s$/.test(f))
  const opens = /^electron\/browser\/(kdbx\/|argon2|(keepass|kdbxedit|kdbxfile|kdbxserve)\.ts)/
  check("passwords process: the main process loads nothing that opens a KeePass file", all.includes("electron/browser/passwords.ts") && !all.some((f) => opens.test(f)), all.filter((f) => opens.test(f)))
  check("passwords process: it opens them, and is only the browser's own files", proc.some((f) => f.startsWith("electron/browser/kdbx/")) && proc.every((f) => f.startsWith("electron/browser/")), proc.filter((f) => !f.startsWith("electron/browser/")))
  const reaching = proc.filter((f) => /from "(electron|(node:)?(net|tls|dns|https?|http2|dgram|child_process|cluster)(\/[a-z]+)?)"|\b(fetch|WebSocket)\(/.test(fs.readFileSync(path.join(ROOT, f), "utf8")))
  check("passwords process: no network, no programs, no Electron", !reaching.length, reaching)
})
