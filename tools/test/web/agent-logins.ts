import { check, section } from "../lib.ts"

// ---------- Browser: agents' logins from a KeePass file (electron/browser/keepass.ts, loginform.ts, pagesecrets.ts) ----------
// A made-up agents.kdbx written here; never a real one.
await section("agent logins", async () => {
  const kp = await import("../../../electron/browser/keepass.ts")
  const { loginForm } = await import("../../../electron/browser/loginform.ts")
  const { keep, scrub, scrubDeep } = await import("../../../electron/browser/pagesecrets.ts")
  const { Credentials, Kdbx, ProtectedValue } = await import("../../../electron/browser/kdbx/index.ts")
  const PASSWORD = "correct horse battery staple", SECRET = "Lighthouse-7!pw"
  const db = Kdbx.create(new Credentials(ProtectedValue.fromString(PASSWORD)), "Agents")
  const add = (title: string, fields: Record<string, string>, tags: string[] = [], group = db.getDefaultGroup()) => {
    const e = db.createEntry(group)
    e.fields.set("Title", title)
    for (const [k, v] of Object.entries(fields)) e.fields.set(k, k === "Password" || k === "otp" ? ProtectedValue.fromString(v) : v)
    e.tags = tags
    return e
  }
  add("Lighthouse", { UserName: "alice", Password: SECRET, URL: "https://lighthouse.example.com/login", otp: "otpauth://totp/Lighthouse:alice?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&period=30&digits=6" }, ["agent-free"])
  add("Lighthouse admin", { UserName: "admin", Password: "admin-pw", URL: "lighthouse.example.com" })
  add("Harbor", { UserName: "alice@example.com", Password: "harbor-pw", URL: "https://*.harbor.example.org", KP2A_URL_1: "https://harbor.example.net" })
  const old = add("Old", { UserName: "old", Password: "old-pw", URL: "https://old.example.com" })
  old.times.expires = true
  old.times.expiryTime = new Date(Date.now() - 86400_000)
  const binned = add("Binned", { UserName: "gone", Password: "gone-pw", URL: "https://lighthouse.example.com" })
  db.createRecycleBin()
  db.move(binned, db.getGroup(db.meta.recycleBinUuid!)!)
  const file = new Uint8Array(await db.save())

  const opened = await kp.openDatabase(file, PASSWORD)
  const titles = opened.entries.map((e) => e.title).sort().join()
  check("agent logins: a KeePass file opens with its password, the recycle bin left out", titles === "Harbor,Lighthouse,Lighthouse admin,Old", titles)
  const light = opened.entries.find((e) => e.title === "Lighthouse")!, admin = opened.entries.find((e) => e.title === "Lighthouse admin")!
  check("agent logins: the agent-free tag frees an entry; untagged ones ask the user", light.free && !admin.free)
  check("agent logins: an expired entry says so", opened.entries.find((e) => e.title === "Old")!.expired && !light.expired)
  check("agent logins: entries list no secret (only the fill reads them)", !JSON.stringify(opened.entries).includes(SECRET) && light.otp && !admin.otp)
  const got = opened.secrets(light.id)
  check("agent logins: an entry's secrets, read for the fill", got?.password === SECRET && got.username === "alice" && got.otp !== "steam" && got.otp?.digits === 6, got && { ...got, password: "(hidden)" })
  let wrong = ""
  try { await kp.openDatabase(file, "not it") } catch (e) { wrong = (e as Error).message }
  check("agent logins: a wrong password says so, plainly", /password/i.test(wrong) && !wrong.includes("not it"), wrong)
  let junk = ""
  try { await kp.openDatabase(new TextEncoder().encode("not a database"), PASSWORD) } catch (e) { junk = (e as Error).message }
  check("agent logins: a file that isn't KeePass's says so", /KeePass/.test(junk) && !junk.includes(PASSWORD), junk)

  // Strict matching, as a password manager's: never a lookalike, subdomains only when the entry says so.
  const M: [string, string, boolean][] = [
    ["https://github.com", "https://github.com/login", true],
    ["github.com", "https://github.com/login", true],
    ["https://github.com", "https://www.github.com/", true],
    ["https://github.com", "https://gist.github.com/", false],
    ["https://github.com", "https://github.com.evil.com/", false],
    ["https://github.com", "https://evilgithub.com/", false],
    ["https://github.com", "https://xn--gthub-n4a.com/", false],
    ["https://github.com", "https://github.com@evil.com/", false],
    ["https://github.com", "http://github.com/", false],
    ["http://intranet.example.com", "https://intranet.example.com/", true],
    ["http://intranet.example.com", "http://intranet.example.com/", true],
    ["https://github.com", "https://github.com:8443/", false],
    ["https://github.com:8443", "https://github.com:8443/", true],
    ["https://github.com", "https://github.com./", true],
    ["https://accounts.example.com", "https://accounts.example.com/", true],
    ["https://accounts.example.com", "https://www.accounts.example.com/", false],
    ["https://accounts.example.com", "https://example.com/", false],
    ["https://*.example.com", "https://a.b.example.com/", true],
    ["https://*.example.com", "https://example.com/", true],
    ["https://*.example.com", "https://badexample.com/", false],
    ["https://*.com", "https://example.com/", false],
    ["https://*.co.uk", "https://bank.co.uk/", false],
    ["https://*.github.io", "https://alice.github.io/", false],
    ["https://alice.github.io", "https://alice.github.io/", true],
    ["https://alice.github.io", "https://bob.github.io/", false],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080/login", true],
    ["http://127.0.0.1:8080", "http://127.0.0.2:8080/login", false],
    ["https://github.com", "file:///etc/passwd", false],
    ["", "https://github.com/", false],
    ["https://github.com", "not a url", false],
  ]
  const bad = M.filter(([e, p, want]) => kp.matchesSite(e, p) !== want)
  check("agent logins: an entry's address matches its own site only (lookalikes, other subdomains, http, ports, public suffixes)", !bad.length, bad)
  const forLight = kp.entriesFor(opened, "https://lighthouse.example.com/login?next=/").map((e) => e.title).sort().join()
  check("agent logins: a page's entries are those naming its site", forLight === "Lighthouse,Lighthouse admin", forLight)
  check("agent logins: additional URLs (KeePassXC's KP2A_URL) match too", kp.entriesFor(opened, "https://harbor.example.net/").length === 1
    && kp.entriesFor(opened, "https://eu.harbor.example.org/").length === 1 && !kp.entriesFor(opened, "https://harbor.example.com/").length)
  const near = kp.nearlyFor(opened, "https://auth.example.com/u/login").map((x) => `${x.entry.title}=${x.url}@${x.domain}`).sort().join()
  check("agent logins: a sign-in on another host of an entry's domain names the entry (for the error to say what to add)",
    near === "Lighthouse admin=lighthouse.example.com@example.com,Lighthouse=https://lighthouse.example.com/login@example.com,Old=https://old.example.com@example.com"
    && !kp.nearlyFor(opened, "https://bob.github.io/").length && !kp.nearlyFor(opened, "http://127.0.0.1/").length, near)

  // RFC 6238's vectors (its SHA-1 key, 8 digits), then the forms KeePassXC and KeePass keep a one-time code in.
  const rfc = { key: Buffer.from("12345678901234567890"), period: 30, digits: 8, algorithm: "sha1" as const }
  const codes = [59, 1111111109, 1234567890, 2000000000].map((s) => kp.totp(rfc, s * 1000))
  check("agent logins: one-time codes as RFC 6238 computes them", codes.join() === "94287082,07081804,89005924,69279037", codes)
  const sha256 = kp.totp({ key: Buffer.from("12345678901234567890123456789012"), period: 30, digits: 8, algorithm: "sha256" }, 59_000)
  check("agent logins: SHA-256 codes too", sha256 === "46119246", sha256)
  const B32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"
  const forms = [
    kp.otpOf({ otp: `otpauth://totp/x?secret=${B32}&period=30&digits=8&algorithm=SHA1` }),
    kp.otpOf({ otp: `key=${B32}&step=30&size=8` }),
    kp.otpOf({ "TOTP Seed": B32.toLowerCase().replace(/(.{4})/g, "$1 "), "TOTP Settings": "30;8" }),
    kp.otpOf({ "TimeOtp-Secret-Base32": B32, "TimeOtp-Length": "8" }),
    kp.otpOf({ "TimeOtp-Secret": "12345678901234567890", "TimeOtp-Length": "8" }),
  ]
  const formCodes = forms.map((o) => (o && o !== "steam" ? kp.totp(o, 59_000) : String(o)))
  check("agent logins: codes from otpauth, KeeOtp, KeePassXC's old fields and KeePass's TimeOtp fields", formCodes.every((c) => c === "94287082"), formCodes)
  check("agent logins: Steam's codes are named, not computed wrong", kp.otpOf({ otp: `otpauth://totp/Steam:a?secret=${B32}&encoder=steam` }) === "steam"
    && kp.otpOf({ "TOTP Seed": B32, "TOTP Settings": "30;S" }) === "steam")
  check("agent logins: an entry without a one-time code has none", kp.otpOf({ URL: "https://x.com" }) === null)

  // The page's login form: which inputs get what.
  let n = 0
  const input = (o: Partial<import("../../../electron/browser/loginform.ts").Input>) => ({ id: ++n, type: "text", hint: "", autocomplete: "", form: 0, visible: true, disabled: false, maxLength: -1, ...o })
  const user = input({ type: "email", hint: "email", form: 1 }), pw = input({ type: "password", hint: "password", form: 1 }), search = input({ hint: "search" })
  const f1 = loginForm([search, user, pw])
  check("agent logins: a sign-in form's username and password", f1.kind === "password" && f1.password?.id === pw.id && f1.username?.id === user.id, f1)
  const f2 = loginForm([input({ type: "password", form: 2 }), input({ type: "password", form: 2 })])
  check("agent logins: two password fields in a form is a sign-up or a change, not a login", f2.kind === "none", f2)
  const f3 = loginForm([input({ type: "password", visible: false }), input({ autocomplete: "username" })])
  check("agent logins: a hidden password field doesn't count; a username-first page fills its username", f3.kind === "username" && !!f3.username, f3)
  const code = input({ autocomplete: "one-time-code", inputMode: "numeric" })
  const f4 = loginForm([search, code])
  check("agent logins: a page asking for a one-time code", f4.kind === "otp" && f4.otp.length === 1 && f4.otp[0].id === code.id, f4)
  const boxes = Array.from({ length: 6 }, () => input({ maxLength: 1, form: 3 }))
  const f5 = loginForm([search, ...boxes])
  check("agent logins: a code split in a box per digit", f5.kind === "otp" && f5.otp.length === 6, f5)
  check("agent logins: a page with no login form has none", loginForm([search, input({ type: "checkbox" })]).kind === "none")

  // Your own sign-ins (electron/browser/userlogins.ts): what one offers to save.
  const { saveOffer } = await import("../../../electron/browser/loginform.ts")
  const saved = [{ id: "a", username: "alice@example.com", modified: 1 }, { id: "b", username: "Alice@example.com", modified: 5 }, { id: "c", username: "bob", modified: 3 }]
  check("your logins: a sign-in a site has no entry for offers a new one", JSON.stringify(saveOffer([], "alice", null)) === '{"kind":"new"}' && saveOffer(saved, "carol", new Set())?.kind === "new")
  check("your logins: one whose password an entry of that username has offers nothing", saveOffer(saved, "bob", new Set(["c"])) === null)
  check("your logins: a new password for a username offers to update its newest entry (any case)", JSON.stringify(saveOffer(saved, "alice@EXAMPLE.com", new Set())) === '{"kind":"update","id":"b"}')
  check("your logins: another username's password doesn't count", saveOffer(saved, "bob", new Set(["a"]))?.kind === "update")
  check("your logins: locked, an entry of that username might have it: nothing offered", saveOffer(saved, "bob", null) === null && saveOffer(saved, "dan", null)?.kind === "new")
  check("your logins: no username heard: the site's only entry is the one updated, unless it has it", saveOffer([saved[2]], "", new Set())?.kind === "update"
    && saveOffer([saved[2]], "", new Set(["c"])) === null && saveOffer(saved, "", new Set())?.kind === "new" && saveOffer(saved, "", new Set(["a"])) === null)

  // What agents see of a page that holds a filled secret: never the secret, as is or as an address encodes it.
  const s = "p@ss wörd&1!"
  const encoded = [s, encodeURIComponent(s), encodeURIComponent(s).toLowerCase(), new URLSearchParams([["pw", s]]).toString().slice(3), encodeURI(s)]
  const out = scrub(`Shown: ${encoded.join(" | ")} end`, [s])
  check("agent logins: a secret is scrubbed from text, as is and however an address or a form encodes it", out === `Shown: ${encoded.map(() => "•••").join(" | ")} end`, [out, encoded])
  check("agent logins: text without a secret is unchanged", scrub("nothing here", [s]) === "nothing here" && scrub("p@ss", []) === "p@ss")
  keep("482913", 60_000)
  const answer = scrubDeep({ tab: 3, title: "Code 482913", lines: ["a 482913"], png: "iVBORw0K482913AAAA" })
  check("agent logins: an answer's every string is scrubbed, a picture's bytes left whole", answer.title === "Code •••" && answer.lines[0] === "a •••" && answer.png === "iVBORw0K482913AAAA" && answer.tab === 3, answer)
})
