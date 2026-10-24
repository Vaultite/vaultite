import fs from "node:fs"
import path from "node:path"
import type { Any, VaultTest } from "./harness.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, app, check, read, sleep, vault, write, TOOLS } = $
  const { vau } = $.vars
  // Vault plugins with no code in the server (core/hooks.ts): the made-up Word count (tools/fixtures/wordcount): its
  // manifest's ops (commands), an event hook and a startup command, their environment, log and checks.
  {
    const { eventsOf } = await import("../../../core/events.ts")
    const { hookProblems } = await import("../../../core/hooks.ts")
    const WC = ".vaultite/plugins/wordcount"
    fs.cpSync(path.join(TOOLS, "fixtures", "wordcount"), path.join(VAULT, WC), { recursive: true })
    // (two more ops, for the tests: the environment, and a command that fails)
    const m = JSON.parse(read(`${WC}/manifest.json`))
    m.ops.push({ id: "wordcount.env", summary: "Its environment (a test's).", kind: "read", command: ["node", "-e",
      "const e = process.env; let i = ''; process.stdin.on('data', (d) => i += d).on('end', () => console.log(JSON.stringify({ id: e.VAULTITE_PLUGIN_ID, dir: e.VAULTITE_PLUGIN_DIR, state: e.VAULTITE_PLUGIN_STATE, bin: e.VAULTITE_BIN, url: e.VAULTITE_URL, vault: e.VAULTITE_VAULT, op: e.VAULTITE_OP, params: e.VAULTITE_PARAMS_JSON, stdin: i, cwd: process.cwd(), path: e.PATH })))"],
      params: { n: { type: "integer", default: 2, description: "a number" } } })
    m.ops.push({ id: "wordcount.fail", summary: "Fails (a test's).", kind: "write", params: { why: { type: "string", description: "why" } }, did: "Failed on purpose: {why}",
      command: ["node", "-e", "console.error('first'); console.error('the reason'); process.exit(3)"] })
    m.ops.push({ id: "wordcount.slow", summary: "Too slow (a test's).", kind: "read", timeout: 0.3, command: ["node", "-e", "setTimeout(() => {}, 5000)"] })
    write(`${WC}/manifest.json`, JSON.stringify(m, null, 2))
    const vp = async () => ((await api("GET", "plugins"))[1] as Any[]).find((p) => p.id === "wordcount")
    let wc = await vp()
    check("hooks: a plugin of only a manifest and commands is listed, off", wc && !wc.on && !wc.problems.length && !app.catalog().some((e) => e.id === "wordcount.count"), wc)
    await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: [...(vault.config("plugins").enabled ?? []), "wordcount"] })
    wc = await vp()
    check("hooks: on in the vault alone, none of its commands run until it's allowed here", !wc.loaded && wc.approval && !app.catalog().some((e) => e.id === "wordcount.count"), wc)
    await api("POST", "ops/plugin.allow", { id: "wordcount", edits: true })
    wc = await vp()
    const entry = app.catalog().find((e) => e.id === "wordcount.count")
    check("hooks: on, its ops are in the catalog, with their CLI and MCP names", wc.loaded && entry?.plugin === "wordcount" && entry.cli === "words" && entry.mcp === "wordcount_count", [wc, entry])
    check("hooks: its docs list its ops", (await api("GET", "docs/wordcount"))[1].includes("### wordcount.count"))
    write("Notes/Count me.md", "---\ntype: note\n---\n\none two three\n")
    let [st, body] = await api("POST", "ops/wordcount.count", { folder: "Notes" })
    check("hooks: an op runs its command, its JSON is the answer", st === 200 && body.folder === "Notes" && body.files >= 1 && body.words >= 3, [st, body])
    const cr = await vau("words", "Notes")
    check("hooks: by its CLI name", cr.code === 0 && cr.out.includes("\"words\""), cr)
    ;[st, body] = await api("POST", "ops/wordcount.count", { folder: "Nowhere" })
    check("hooks: a non-zero exit is the op's error, with stderr", st === 500 && body.error.includes("exit 1") && body.error.includes("there's no folder Nowhere"), [st, body])
    ;[st, body] = await api("POST", "ops/wordcount.env", { n: "5" })
    const local = process.env.VAULTITE_LOCAL!
    check("hooks: its environment and stdin (checked params), in its folder", st === 200 && body.id === "wordcount" && body.dir === path.join(VAULT, WC) && body.cwd === fs.realpathSync(path.join(VAULT, WC)) &&
      body.state.startsWith(path.join(local, "plugin-state")) && fs.existsSync(body.state) && fs.existsSync(body.bin) && body.bin.endsWith(path.join("bin", "vau")) && /^http:\/\/127\.0\.0\.1:\d+$/.test(body.url) &&
      body.vault === VAULT && body.op === "wordcount.env" && body.params === "{\"n\":5}" && body.stdin === "{\"n\":5}" &&
      body.path.split(path.delimiter).includes(path.dirname(process.execPath)), body)
    ;[st, body] = await api("POST", "ops/wordcount.changed?as=text", {})
    check("hooks: text that isn't JSON is the answer and its text", st === 200 && typeof body === "string" && !body.includes("```"), [st, body])
    ;[st, body] = await api("POST", "ops/wordcount.fail", {})
    check("hooks: stderr's last lines say why it failed; a write's failure is op.done too", st === 500 && /exit 3\): first\nthe reason$/.test(body.error) && eventsOf(vault).last({ types: ["op.done"] }, 1)[0].id === "wordcount.fail", body)
    check("hooks: a manifest op never holds the vault (its command writes through the API)", app.ops().find((o) => o.op.id === "wordcount.fail")?.op.lock === false)
    const { didOf } = await import("../../../core/ops.ts")
    const did = didOf(app.ops().find((o) => o.op.id === "wordcount.fail")!.op, { why: "a test" })
    check("hooks: a manifest op's did is its params filled in", did?.text === "Failed on purpose: a test", did)
    ;[st, body] = await api("POST", "ops/wordcount.slow", {})
    check("hooks: a command past its timeout is ended", st === 504 && body.error.includes("longer than 0.3 s"), [st, body])
    const tools = (await import("../../../plugins/core/mcp/catalog.ts")).toolsOf(app.catalog())
    check("hooks: an op marked mcp is a tool", tools.some((t) => t.name === "wordcount_count" && t.annotations.readOnlyHint === true))

    // Startup ran once it was on; an event hook runs on a matching event (and not on others).
    const state = body && path.join(local, "plugin-state", fs.readdirSync(path.join(local, "plugin-state"))[0], "wordcount")
    for (let i = 0; i < 100 && !fs.existsSync(path.join(state, "started.json")); i++) await sleep(20)
    check("hooks: startup ran once it was on", fs.existsSync(path.join(state, "started.json")) && JSON.parse(fs.readFileSync(path.join(state, "started.json"), "utf8")).url.startsWith("http://"))
    eventsOf(vault).emit("file.changed", { paths: ["People/Alice Park.md"] })
    eventsOf(vault).emit("file.changed", { paths: ["Notes/Count me.md", "People/Alice Park.md"] })
    const changed = () => { try { return fs.readFileSync(path.join(state, "changed.txt"), "utf8") } catch { return null } }
    for (let i = 0; i < 100 && changed() !== "Notes/Count me.md\n"; i++) await sleep(20)
    await sleep(50) // (time for a wrong second run to show)
    check("hooks: an event hook gets the matching event (its paths narrowed) on stdin", fs.existsSync(path.join(state, "changed.txt")) && fs.readFileSync(path.join(state, "changed.txt"), "utf8") === "Notes/Count me.md\n",
      fs.existsSync(path.join(state, "changed.txt")) && fs.readFileSync(path.join(state, "changed.txt"), "utf8"))
    ;[st, body] = await api("POST", "ops/wordcount.changed?as=text", {})
    check("hooks: what it kept, through its op", body === "- Notes/Count me.md", body)
    ;[st, body] = await api("POST", "ops/vault-plugin.log?as=text", { id: "wordcount" })
    check("hooks: every run is logged (vault-plugin.log)", st === 200 && body.includes("startup: `node started.mjs` exit 0") && body.includes("event file.changed: `node note-changed.mjs` exit 0") &&
      body.includes("wordcount.fail") && body.includes("the reason") && body.includes("timed out after 0.3 s"), body)

    // Checked before it loads: commands are argv arrays, inside its folder; ops in its area; known keys.
    const dir = path.join(VAULT, WC)
    const probs = hookProblems({ id: "wordcount", ops: [
      { id: "other.thing", summary: "x", kind: "read", command: ["node", "count.mjs"] },
      { id: "wordcount.shell", summary: "x", kind: "read", command: "node count.mjs" },
      { id: "wordcount.up", summary: "x", kind: "write", command: ["../../escape.sh"] },
      { id: "wordcount.nope", summary: "x", kind: "maybe", command: ["./missing.sh"], params: { x: { type: "string" } }, extra: 1, did: 3 },
    ], events: [{ on: "File Changed", command: ["node"] }], startup: [["node", "x.mjs"]] }, dir)
    const has = (s: string) => probs.some((p) => p.includes(s))
    check("hooks: the manifest's problems", has("'other.thing' should start with 'wordcount.'") && has("argv array of strings") && has("outside the plugin's folder") && has("isn't in the plugin's folder") &&
      has("kind is read, write or destructive") && has("param 'x' has no description") && has("'extra' isn't a key of an op") && has("did is what a call did") && has("events[0]: on is an event type") && has("startup[0] must be"), probs)
    check("hooks: the fixture has none", hookProblems(JSON.parse(fs.readFileSync(path.join(TOOLS, "fixtures", "wordcount", "manifest.json"), "utf8")), path.join(TOOLS, "fixtures", "wordcount")).length === 0)
    m.ops.push({ id: "wordcount.bad", summary: "x", kind: "read", command: "rm -rf /" })
    write(`${WC}/manifest.json`, JSON.stringify(m, null, 2))
    wc = await vp()
    check("hooks: a bad command keeps the plugin from loading, saying why", !wc.loaded && wc.problems.some((p: string) => p.includes("ops[5]: command must be an argv array")) && !app.catalog().some((e) => e.plugin === "wordcount"), wc.problems)
    await api("PUT", "config/plugins", { ...vault.config("plugins"), enabled: (vault.config("plugins").enabled ?? []).filter((x: string) => x !== "wordcount") })
  }
}
