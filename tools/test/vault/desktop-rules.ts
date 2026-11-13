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

async function hangs(check: Check) {
  const H = await import("../../../electron/hang.ts")
  const machine = { load: 3.2, freeMB: 120, totalMB: 8192 }
  const at = (t: number, stack: string, cpuSeconds: number | null) => ({ at: t, stack, cpuSeconds, memoryMB: 900 })
  const run = (samples: ReturnType<typeof at>[], how: "recovered" | "reloaded" | "gone" | "still" = "recovered", frames: Parameters<typeof H.hangReport>[4] = []) =>
    H.hangReport("MyVault", samples.reduce(H.sampled, H.hangStarted(0)), { at: 42_000, how }, machine, frames)
  const loop = "at render (http://127.0.0.1:8793/assets/main.js:1:2)", other = "at parse (http://127.0.0.1:8793/assets/state.js:3:4)"
  const inScript = run([at(0, other, 0), at(3000, loop, 3), at(6000, loop, 6)])
  check("hangs: a script caught running says so, its most frequent stack first so Errors groups by it",
    inScript.message === "MyVault's page stopped responding (in its script)" && inScript.stack.startsWith(loop) && inScript.stack.includes(`also, 1 of 3 times:\n${other}`) &&
    inScript.stack.includes("42 s, then came back") && inScript.stack.includes("100% CPU, 900 MB"), inScript)
  check("hangs: no script caught, the renderer's CPU over the hang tells busy from waiting",
    run([at(0, "", 10), at(3000, "", 12.7)]).message.endsWith("(busy outside its script: layout, style or garbage collection)") &&
    run([at(0, "", 10), at(3000, "", 10.1)]).message.endsWith("(idle: waiting on something)") &&
    run([at(0, "", null)]).message.endsWith("(its script's stack unknown)") && run([]).message.endsWith("(its script's stack unknown)"))
  const framed = run([at(0, "", 1)], "recovered", [{ ms: 41_000, blockingMs: 40_950, scripts: [{ ms: 40_900, where: "TimerHandler:setTimeout tick http://127.0.0.1:8793/assets/main.js:120" }] }])
  check("hangs: how it ended, the machine, and the long frame that held it with its script",
    framed.stack.includes("this machine: load 3.2, 120 of 8192 MB free") && framed.stack.includes("a 41000 ms frame (40950 ms blocking):\n  40900 ms TimerHandler:setTimeout tick") &&
    run([], "reloaded").stack.includes("until it was reloaded") && run([], "still").stack.includes("and still not"), framed.stack)
  check("hangs: at most a few looks are kept", Array.from({ length: 30 }, (_, i) => at(i, "", null)).reduce(H.sampled, H.hangStarted(0)).samples.length === H.MAX_SAMPLES)
}

async function cloudSessions(check: Check) {
  const C = await import("../../../electron/cloud.ts")
  const read = C.RAW_SESSION.safeParse
  const of = (r: ReturnType<typeof read>) => (r.success ? C.sessionOf(r.data, "p1", "org1") : null)
  const full = of(read({ id: "session_abc", title: "  Fix   the\nbug ", session_status: "requires_action", updated_at: "2026-11-12T10:00:00Z", unread: true, origin: "ios", environment_kind: "bridge",
    external_metadata: { post_turn_summary: { status_category: "need_input", needs_action: "Which branch?" } },
    session_context: { outcomes: [{ git_info: { repo: "alice/lighthouse", branches: ["feat/x"] } }, { git_info: { repo: "bad repo" } }, null, { git_info: { repo: "alice/other", branches: ["bad branch!"] } }],
      sources: [{ url: "https://github.com/alice/web.git" }, { url: 5 }] } }))
  check("cloud sessions: claude.ai's session read into ours, what's malformed in it left out",
    JSON.stringify(full) === JSON.stringify({ id: "session_abc", title: "Fix the bug", state: "waiting", updated: Date.parse("2026-11-12T10:00:00Z"), url: "https://claude.ai/code/session_abc", profile: "p1", account: "org1",
      summary: "Which branch?", outcome: "input", unread: true, repos: [{ repo: "alice/lighthouse", branch: "feat/x" }, { repo: "alice/other" }, { repo: "alice/web" }], origin: "phone", remote: true }), full)
  const bare = of(read({ id: "session_c", title: 3, post_turn_summary: { status_category: "review_ready", recent_action: "Opened a PR" }, origin: "claude_code_cli", session_context: { outcomes: "x" } }))
  check("cloud sessions: a session with little in it, and none without an id",
    JSON.stringify(bare) === JSON.stringify({ id: "session_c", title: "Claude Code session", state: "idle", updated: 0, url: "https://claude.ai/code/session_c", profile: "p1", account: "org1", summary: "Opened a PR", outcome: "review", origin: "cli" }) &&
    of(read({ title: "x" })) === null && of(read(null)) === null, bare)
}

export default async ($: VaultTest) => {
  winspawnFirst($.check)
  for (const t of [bridge, clipboard, snapshots, accounts, hangs, cloudSessions]) await t($.check)
}
