// The web app's logic that needs no browser, on Node (`@/` resolves to web/src; server, page and desktop modules stubbed):
// by area (tools/test/web/).   node tools/test_web.ts [area...] | --list
import fs from "node:fs"
import { registerHooks } from "node:module"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { exit, summary, tempDir } from "./test/lib.ts"
import { AREAS } from "./test/web/index.ts"
const t0 = Date.now()

const argv = process.argv.slice(2)
if (argv.includes("--list")) {
  for (const a of AREAS) {
    const text = fs.readFileSync(path.join(import.meta.dirname, "test", "web", `${a}.ts`), "utf8")
    const first = /^\/\/ (?:-+ )?(.*?)(?: -+)?$/m.exec(text)?.[1] ?? /(?:section|check)\("([^"]*)"/.exec(text)?.[1] ?? ""
    console.log(`${a.padEnd(16)} ${first.slice(0, 100)}`)
  }
  process.exit(0)
}
const unknown = argv.filter((n) => !AREAS.includes(n))
if (unknown.length) { console.error(`no area ${unknown.join(", ")} (--list lists them)`); process.exit(2) }

const ROOT = path.dirname(import.meta.dirname)
const WEB = path.join(ROOT, "web", "src")
const STUBS: Record<string, string> = {
  "@/core/data": "export const put = async () => { throw new Error('no server in tools/test_web.ts') }; export const getStore = () => null",
  "@/core/http": "export const put = async () => { throw new Error('no server in tools/test_web.ts') }",
  "@/core/files": "export const readFile = async () => { throw new Error('no server in tools/test_web.ts') }; export const splitFm = () => ({ fm: '', body: '' })",
  "@/core/prefs": "export const getPrefs = () => ({ disabled: [] })",
  "@/core/appearance": "export const onLook = () => () => {}",
  "@/core/desktop": "export const webPages = null; export const keyboardTakes = () => 0; export const pageTakenSince = () => null",
  "@/core/askers": "export const answerUi = (kind, fn) => { (globalThis.__answerUi ??= {})[kind] = fn }",
  "@/core/pagelock": "export const relockScroll = () => {}",
}
// Autosave's server, reads, toasts and connection: the made-up ones its section sets on globalThis.__autosave.
const AUTOSAVE_STUBS: Record<string, string> = {
  "@/core/http": "const f = () => globalThis.__autosave; export const request = (...a) => f().request(...a); export const get = (p) => f().get(p); export const post = async (p, b) => { globalThis.__autosave.posts?.push([p, b]); return {} }; export const put = (p, b) => f().putJson(p, b)",
  "@/core/files": `export const deletedHere = () => false; export const gone = (e) => /^Error: no file /.test(String(e)); export const moveMark = () => 0; export const whereNow = (p) => p
    export const readFile = (p) => globalThis.__autosave.readFile(p); export const stem = (p) => p.replace(/^.*\\//, "").replace(/\\.md$/, "")
    export const splitFm = (t) => { const m = /^---\\n[\\s\\S]*?\\n---\\n/.exec(t); return m ? { fm: m[0], body: t.slice(m[0].length) } : { fm: "", body: t } }`,
  "@/core/live": "export const useVaultChange = () => {}; export const onReconnect = (fn) => { globalThis.__autosave.back.add(fn); return () => globalThis.__autosave.back.delete(fn) }",
  "@/core/notify": "export const errorReason = (e) => e?.message ?? null; export const notify = (text) => { globalThis.__autosave.toasts.push(text) }",
  "@/core/drafts": "export const keepDraft = () => {}; export const dropDraft = () => {}",
}
// Co-typing's socket, editors and app (plugins/core/companion/cotype.ts): the made-up ones on globalThis.__cotype, its
// hold on a note the app's own (core/cosync.ts, as autosave has it).
const COTYPE_STUBS: Record<string, string> = {
  "./live": `const f = () => globalThis.__cotype; export const getState = () => f().state; export const say = (m) => f().say(m)
    export const setPeople = () => {}; export const setRooms = (r) => { f().rooms = r }; export const subscribe = (fn) => { f().subs.add(fn); return () => f().subs.delete(fn) }`,
  "@vaultite": `export { keepLive } from ${JSON.stringify(pathToFileURL(path.join(WEB, "core", "cosync.ts")).href)}
    export { merge3 } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "core", "textedit.ts")).href)}
    export const notify = () => {}; export const settleFile = (p) => globalThis.__cotype.settleFile(p)`,
  "@codemirror/view": "export const ViewPlugin = { define: (create) => ({ create }) }; export const EditorView = { scrollIntoView: () => null }",
  "y-codemirror.next": "export const ySyncAnnotation = {}; export const yCollab = (ytext) => ({ ytext })",
  "./text": `export * from ${JSON.stringify(pathToFileURL(path.join(ROOT, "plugins", "core", "companion", "text.ts")).href)}`,
}
const WEB_VIEWER_APP_IDLE = `export { cell } from ${JSON.stringify(pathToFileURL(path.join(WEB, "core", "signal.ts")).href)}
export const webPages = null; export const currentWorkspace = () => null; export const notifyError = () => {}; export const viewsChanged = () => {}
export const pluginSettings = () => ({ get: () => ({}), ready: async () => {} })`
const ON_WEB_VIEWER_APP_IDLE = ["state.ts", "layers.ts"].map((f) => `/plugins/core/web-viewer/${f}`)
// (plugins import the app as "@vaultite": here, only what their editing commands use)
const shim = path.join(tempDir("vau-shim-"), "vaultite.ts")
fs.writeFileSync(shim, `export { blockPieces, paragraphAt } from ${JSON.stringify(pathToFileURL(path.join(WEB, "core", "highlights.ts")).href)}
export { joinText } from ${JSON.stringify(pathToFileURL(path.join(ROOT, "core", "dictationtext.ts")).href)}
export const notify = (...a) => globalThis.__learn?.toasts.push(a); export const op = async (id, p) => globalThis.__learn ? globalThis.__learn.op(id, p) : null`)
registerHooks({
  resolve(spec, context, next) {
    if (spec in COTYPE_STUBS && context.parentURL?.endsWith("/plugins/core/companion/cotype.ts")) return { url: `data:text/javascript,${encodeURIComponent(COTYPE_STUBS[spec])}`, shortCircuit: true }
    if (spec === "@vaultite" && ON_WEB_VIEWER_APP_IDLE.some((f) => context.parentURL?.endsWith(f))) return { url: `data:text/javascript,${encodeURIComponent(WEB_VIEWER_APP_IDLE)}`, shortCircuit: true }
    if (spec === "@vaultite") return { url: pathToFileURL(shim).href, shortCircuit: true }
    if (spec in AUTOSAVE_STUBS && context.parentURL?.endsWith("/web/src/core/autosave.ts")) return { url: `data:text/javascript,${encodeURIComponent(AUTOSAVE_STUBS[spec])}`, shortCircuit: true }
    if (spec in STUBS) return { url: `data:text/javascript,${encodeURIComponent(STUBS[spec])}`, shortCircuit: true }
    if (spec.startsWith("@/")) {
      const base = path.join(WEB, spec.slice(2))
      const file = [".ts", ".tsx", ""].map((x) => base + x).find((f) => fs.existsSync(f) && fs.statSync(f).isFile())
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    // A relative import without its extension, the way Vite resolves it (core/markdown.ts -> ./richmd).
    if (spec.startsWith(".") && !/\.[a-z]+$/i.test(spec) && context.parentURL?.startsWith(pathToFileURL(WEB).href)) {
      const base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), spec)
      const file = [".ts", ".tsx"].map((x) => base + x).find((f) => fs.existsSync(f))
      if (file) return { url: pathToFileURL(file).href, shortCircuit: true }
    }
    return next(spec, context)
  },
})

for (const a of argv.length ? AREAS.filter((n) => argv.includes(n)) : AREAS) await import(`./test/web/${a}.ts`)

await exit(summary("web", t0))
