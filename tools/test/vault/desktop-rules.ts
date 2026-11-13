import fs from "node:fs"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

type Check = VaultTest["check"]
const ROOT = path.resolve(import.meta.dirname, "../../..")

function winspawnFirst(check: Check) {
  const firstImport = (file: string) => /^import\s+(?:[^"']*from\s+)?["']([^"']+)["']/m.exec(fs.readFileSync(path.join(ROOT, file), "utf8"))?.[1]
  check("desktop: winspawn is the first import of the main process and the server, so no program they start opens a console on Windows",
    firstImport("electron/main.ts") === "../core/winspawn.ts" && firstImport("server.ts") === "./core/winspawn.ts", [firstImport("electron/main.ts"), firstImport("server.ts")])
}

async function bridge(check: Check) {
  const { appPage } = await import("../../../electron/apppermissions.ts")
  const o = "http://127.0.0.1:8793"
  check("desktop: the bridge answers the app's own page only, never a vault's file served under its origin",
    appPage(`${o}/`, o) && appPage(`${o}/index.html?x=1#y`, o) &&
    !appPage(`${o}/v/Notes/page.html`, o) && !appPage(`${o}/api/raw?path=a.html`, o) && !appPage(`${o}/index.html/..%2fv/x`, o) &&
    !appPage("http://127.0.0.1:8794/", o) && !appPage("http://127.0.0.1:8793.evil.example/", o) && !appPage("not a url", o))
}

async function clipboard(check: Check) {
  const K = await import("../../../electron/browser/keypress.ts")
  const touches = Object.values(K.MAC_COMMANDS).filter((c) => /copy|cut|paste|yank/i.test(c))
  check("browser agents: no editing key a Mac page takes copies, cuts or pastes", !touches.length, touches)
  const refused = ["Meta+c", "Meta+x", "Meta+v", "Meta+Shift+v", "Control+c", "Ctrl+X", "control+v", "Shift+Insert", "Control+Insert", "Shift+Delete", "Meta + V"]
  const allowed = ["Meta+a", "Control+a", "Backspace", "Enter", "c", "Shift+c", "Alt+c", "Meta+z", "Delete"]
  check("browser agents: copy, cut and paste keys are refused on every platform, other keys aren't",
    refused.every(K.clipboardKey) && !allowed.some(K.clipboardKey), [refused.filter((k) => !K.clipboardKey(k)), allowed.filter(K.clipboardKey)])
  const down = (combo: string, os: NodeJS.Platform) => K.keyEvent(combo, os).down
  check("browser agents: a Mac's editing key goes as its command, elsewhere and for other keys none",
    JSON.stringify(down("Meta+a", "darwin").commands) === '["selectAll"]' && !("commands" in down("Meta+c", "darwin")) && !("commands" in down("Control+a", "linux")) &&
    down("a", "darwin").text === "a" && down("Shift+A", "linux").modifiers === 8)
}

async function snapshots(check: Check) {
  const { axLines } = await import("../../../electron/browser/axlines.ts")
  const S = "hunter2-secret"
  const v = (value: string) => ({ value })
  const nodes = [
    { nodeId: "1", role: v("RootWebArea"), name: v("Log in"), childIds: ["2", "4", "6"] },
    { nodeId: "2", role: v("textbox"), name: v("Password"), value: v(S), backendDOMNodeId: 20, childIds: ["3"] },
    { nodeId: "3", role: v("StaticText"), name: v(S), backendDOMNodeId: 30 },
    { nodeId: "4", role: v("textbox"), name: v("Shown password"), value: v("●●●●●●"), backendDOMNodeId: 40 },
    { nodeId: "6", role: v("textbox"), name: v("Email"), value: v("alice@example.com"), backendDOMNodeId: 60 },
  ]
  const refs = { byRef: new Map<string, number>(), byNode: new Map<number, string>(), n: 0, what: new Map<string, { role: string; name: string }>() }
  const lines = axLines(nodes, refs, (id) => id === 20, (s) => s).join("\n")
  check("browser agents: a snapshot never shows a filled secret, the text inside its field, or a password's length",
    !lines.includes(S) && !lines.includes("●") && /textbox "Password" \[ref=e\d\]: •••/.test(lines) && /textbox "Shown password" \[ref=e\d\]: •••/.test(lines) && lines.includes("alice@example.com"), lines)
  const { mask } = await import("../../../electron/browser/mask.ts")
  check("browser agents: secrets are masked longest first, so one inside another leaves none of it, typed or URL-encoded",
    mask("pw=abcdef", ["abc", "abcdef"]) === "pw=•••" && mask("q=a%20b+c&x=a b c", ["a b c"]) === "q=•••&x=•••" && mask("nothing", []) === "nothing",
    [mask("pw=abcdef", ["abc", "abcdef"]), mask("q=a%20b+c&x=a b c", ["a b c"])])
}

async function accounts(check: Check) {
  const { ACCOUNTS } = await import("../../../electron/siteaccounts.ts")
  const S = "tok_S3CRETxyz123"
  const json = { accessToken: S, token: S, sessionKey: S, csrf: S, email: "alice@example.com",
    user: { email: "alice@example.com", name: "Alice", username: "alice", accessToken: S, token: S, id: S },
    account: { email_address: "alice@example.com", uuid: S }, data: { name: "alice", modhash: S }, result: { email: "alice@example.com", api_token: S },
    form_data: { username: "alice", fb_dtsg: S }, query: { userinfo: { id: 1, name: "Alice", token: S } } }
  const html = `<meta name="csrf-token" content="${S}"><meta name="user-login" content="alice"><script>{"token":"${S}","NAME":"Alice"}</script>`
  const cookie = async () => `alice&${S}`
  const leaks: string[] = []
  for (const [site, rule] of Object.entries(ACCOUNTS)) {
    const said = await Promise.resolve().then(() => rule.read?.(rule.text ? html : json, cookie, `https://${site}/`)).catch(() => null)
    const looked = rule.look ? (() => { try { return rule.look.read({ handle: "alice", avatar: "", phone: S, token: S }) } catch { return null } })() : null
    if (JSON.stringify([said, looked]).includes(S)) leaks.push(site)
    if (Object.keys(rule.headers ?? {}).some((h) => /auth|cookie|token|csrf|secret/i.test(h))) leaks.push(`${site} headers`)
  }
  check("browser: who's signed in to a site never holds a token or a cookie's secret, whatever its answer carries", !leaks.length, leaks)
}

export default async ($: VaultTest) => {
  winspawnFirst($.check)
  for (const t of [bridge, clipboard, snapshots, accounts]) await t($.check)
}
