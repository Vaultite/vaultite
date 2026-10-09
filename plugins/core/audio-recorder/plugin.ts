// Transcribing audio on this machine as jobs, a small edit into the note: Apple's speech recognition, else whisper. A program
// is data/config.json's, never the vault's (it syncs, AIs write it); a model is a name, never a path (whisper unpickles).
import { execFile } from "node:child_process"
import crypto from "node:crypto"
import fs from "node:fs"
import type { IncomingMessage } from "node:http"
import os from "node:os"
import path from "node:path"
import { HTTPError, LOCAL, Plugin, reply, type Who, whoOf } from "../../../core/plugins.ts"
import { writeAtomic } from "../../../core/vault.ts"
import { embedsAudio, paragraphs, type Segment, textParagraphs, withTranscript } from "./transcript.ts"

export const plugin = new Plugin(import.meta.url)

const AUDIO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|weba|mp4|m4v|mov|aiff?|caf)$/i
const HOME = os.homedir()

type Transcriber =
  | { kind: "command"; name: string; argv: string[] }
  | { kind: "apple"; name: string; bin: string; language: string }
  | { kind: "whisper"; name: string; bin: string; ffmpeg: string; model: string; language: string }
type Found = { available: boolean; name?: string; why?: string; t?: Transcriber }

/** Where programs are looked for: PATH (launchd's is short), then the usual places. */
const dirs = () => [...new Set([...(process.env.PATH ?? "").split(":"), "/opt/homebrew/bin", "/usr/local/bin", `${HOME}/.local/bin`,
  `${HOME}/miniforge3/bin`, `${HOME}/mambaforge/bin`, `${HOME}/miniconda3/bin`, `${HOME}/anaconda3/bin`, "/usr/bin"].filter(Boolean))]
const runnable = (p: string) => { try { fs.accessSync(p, fs.constants.X_OK); return fs.statSync(p).isFile() } catch { return false } }
const which = (name: string) => dirs().map((d) => path.join(d, name)).find(runnable) ?? null

/** Not a program in the vault. */
function outsideVault(p: string) {
  let real = p, root = plugin.vault.path
  try { real = fs.realpathSync(p) } catch { /* checked by runnable */ }
  try { root = fs.realpathSync(root) } catch { /* not there */ }
  return real !== root && !real.startsWith(root + path.sep)
}

/** "my-tool --x {file}" as arguments: spaces split them, quotes ("a b", 'a b') keep them together. */
export function splitCommand(cmd: string): string[] {
  const out: string[] = []
  for (const m of cmd.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

const MODELS = ["small", "base", "tiny"]
function defaultModel() {
  const dir = path.join(process.env.XDG_CACHE_HOME || path.join(HOME, ".cache"), "whisper")
  return MODELS.find((m) => fs.existsSync(path.join(dir, `${m}.pt`))) ?? "base"
}

// ---------- Apple's speech recognition: transcribe.swift, built the first time (the desktop app ships it built)

const SWIFT = path.join(import.meta.dirname, "transcribe.swift")
/** The helper's file name: its source's hash, so a changed source is built again. */
export const helperName = () => `transcribe-${crypto.createHash("sha1").update(fs.readFileSync(SWIFT)).digest("hex").slice(0, 12)}`
const quiet = (bin: string, args: string[], timeout = 120_000) => new Promise<{ ok: boolean; out: string; err: string }>((done) =>
  execFile(bin, args, { timeout }, (e, out, err) => done({ ok: !e, out: String(out).trim(), err: String(err).trim() })))

/** Build the helper into `dir` (Xcode's Command Line Tools: never /usr/bin/swiftc without them, which asks to install),
 *  for this Mac, or one file for each of `archs` (the desktop app's: both, as it ships for Apple silicon and Intel). */
export async function buildHelper(dir: string, archs: string[] = []): Promise<string> {
  const out = path.join(dir, helperName())
  if (runnable(out)) {
    const built = (await quiet("/usr/bin/lipo", ["-archs", out])).out.split(" ")
    if (archs.every((a) => built.includes(a))) return out
  }
  if (!(await quiet("/usr/bin/xcode-select", ["-p"])).ok) throw new Error("it needs Xcode's Command Line Tools to be built here")
  fs.mkdirSync(dir, { recursive: true })
  const tmp = `${out}.${process.pid}`
  const slices = archs.map((a) => [`${tmp}-${a}`, "-target", `${a}-apple-macos26`])
  try {
    for (const [file, ...target] of slices.length ? slices : [[tmp]]) {
      const r = await quiet("/usr/bin/xcrun", ["swiftc", "-O", ...target, SWIFT, "-o", file], 300_000)
      if (!r.ok) throw new Error(`it didn't build: ${r.err.split("\n").slice(-2).join(" ")}`)
    }
    if (slices.length) {
      const r = await quiet("/usr/bin/xcrun", ["lipo", "-create", ...slices.map((s) => s[0]), "-output", tmp])
      if (!r.ok) throw new Error(`lipo: ${r.err}`)
    }
    fs.renameSync(tmp, out)
  } finally { for (const f of [tmp, ...slices.map((s) => s[0])]) fs.rmSync(f, { force: true }) }
  return out
}

/** Apple's on-device transcriber for `language` (the Mac's when ""), or why this machine has none: it's macOS 26's. */
async function apple(language: string): Promise<{ bin: string } | { why: string }> {
  if (process.platform !== "darwin" || Number(os.release().split(".")[0]) < 25) return { why: "Apple's speech recognition needs macOS 26." }
  let bin = path.join(import.meta.dirname, "bin", helperName())
  if (!runnable(bin)) {
    try { bin = await buildHelper(path.join(LOCAL, "bin")) } catch (e) { return { why: `Apple's speech recognition: ${(e as Error).message}.` } }
  }
  const r = await quiet(bin, ["--check", ...(language ? ["--language", language] : [])], 30_000)
  return r.ok ? { bin } : { why: r.err || "Apple's speech recognition isn't available here." }
}

/** What transcribes here, from the settings (or found), or why nothing does. */
async function find(_key: string): Promise<Found> {
  const s = plugin.settings()
  const local = (plugin.secrets()[plugin.id] ?? {}) as Record<string, unknown>
  if (s.transcribe === false) return { available: false, why: "Transcription is off (transcribe: false in its settings)." }
  if (typeof local.command === "string" && local.command.trim()) {
    const argv = splitCommand(local.command.trim())
    const bin = argv[0].includes("/") ? argv[0].replace(/^~(?=\/)/, HOME) : which(argv[0])
    if (!bin || !runnable(bin)) return { available: false, why: `Can't run ${argv[0]} (its command setting).` }
    if (!outsideVault(bin)) return { available: false, why: "A transcriber inside the vault isn't run." }
    const name = path.basename(bin)
    return { available: true, name, t: { kind: "command", name, argv: [bin, ...argv.slice(1)] } }
  }
  const language = typeof s.language === "string" ? s.language.trim() : ""
  if (language && !/^[a-z]{2,3}([-_][a-z0-9]{2,8})*$|^[a-z]+( [a-z]+)?$/i.test(language)) return { available: false, why: `"${language}" isn't a language.` }
  const named = typeof local.whisper === "string" && local.whisper.trim() ? local.whisper.trim().replace(/^~(?=\/)/, HOME) : null
  // Apple's first (built in, on the device), unless whisper is asked for: the setting engine, or its program named.
  const engine = s.engine === "whisper" || s.engine === "apple" ? s.engine : named ? "whisper" : "auto"
  let why = ""
  // (Apple's is a Mac's: elsewhere it's never tried, nor named in why nothing transcribes)
  if (engine !== "whisper" && (process.platform === "darwin" || engine === "apple")) {
    const a = await apple(/^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(language) ? language : "")
    if ("bin" in a) return { available: true, name: "Apple's speech recognition", t: { kind: "apple", name: "Apple's speech recognition", bin: a.bin, language } }
    why = a.why
    if (engine === "apple") return { available: false, why }
  }
  const bin = named ?? which("whisper")
  if (!bin || !runnable(bin)) {
    const how = process.platform === "darwin" ? why || "no transcriber." : "install ffmpeg and whisper (pipx install openai-whisper), or set its command to another transcriber."
    return { available: false, why: bin ? `Can't run ${bin} (its whisper setting).` : `This machine can't transcribe: ${how}` }
  }
  if (!outsideVault(bin)) return { available: false, why: "A transcriber inside the vault isn't run." }
  const ffmpeg = which("ffmpeg")
  if (!ffmpeg) return { available: false, why: `Whisper needs ffmpeg, which isn't installed${process.platform === "linux" ? " (sudo apt install ffmpeg)" : ""}.` }
  const model = typeof s.model === "string" && s.model.trim() ? s.model.trim() : defaultModel()
  if (!/^[a-z0-9][a-z0-9.-]*$/i.test(model)) return { available: false, why: `"${model}" isn't a whisper model's name.` }
  const name = `whisper ${model}`
  return { available: true, name, t: { kind: "whisper", name, bin, ffmpeg, model, language } }
}
/** (Looked up again when its settings change, else at most every 30 s.) */
const transcriber = () => plugin.memo(30, find, JSON.stringify([plugin.settings(), plugin.secrets()[plugin.id] ?? null]))

const run = (bin: string, args: string[], env: NodeJS.ProcessEnv, timeout: number) =>
  new Promise<string>((ok, fail) => {
    execFile(bin, args, { env, timeout, maxBuffer: 64 << 20, killSignal: "SIGKILL" }, (err, stdout, stderr) => {
      if (!err) return ok(stdout)
      const said = String(stderr || "").trim().split("\n").filter((l) => !/^\s*\d+%\|/.test(l)).slice(-3).join(" ")
      fail(new Error((err as { killed?: boolean }).killed ? "it took too long" : said || err.message))
    })
  })

/** The file's transcript, as paragraphs, and the language whisper heard. */
async function transcribe(t: Transcriber, abs: string): Promise<{ paras: string[]; language?: string }> {
  const timeout = 3 * 3600_000
  if (t.kind === "apple") {
    const lang = /^[a-z]{2,3}([-_][a-z0-9]{2,8})*$/i.test(t.language) ? ["--language", t.language] : []
    return { paras: textParagraphs(await run(t.bin, [abs, ...lang], process.env, timeout)), ...(t.language ? { language: t.language } : {}) }
  }
  if (t.kind === "command") {
    const args = t.argv.slice(1)
    const at = args.findIndex((a) => a.includes("{file}"))
    const argv = at < 0 ? [...args, abs] : args.map((a) => a.replaceAll("{file}", abs))
    return { paras: textParagraphs(await run(t.argv[0], argv, process.env, timeout)) }
  }
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-transcribe-"))
  try {
    const env = { ...process.env, PATH: [path.dirname(t.ffmpeg), path.dirname(t.bin), process.env.PATH].filter(Boolean).join(":"), PYTHONWARNINGS: "ignore" }
    const args = [abs, "--model", t.model, "--output_format", "json", "--output_dir", out, "--verbose", "False",
      ...(t.language ? ["--language", /^[a-z]{2,3}[-_]/i.test(t.language) ? t.language.split(/[-_]/)[0] : t.language] : [])]
    await run(t.bin, args, env, timeout)
    const file = fs.readdirSync(out).find((f) => f.endsWith(".json"))
    if (!file) throw new Error("whisper wrote no transcript")
    const j = JSON.parse(fs.readFileSync(path.join(out, file), "utf8")) as { text?: string; segments?: Segment[]; language?: string }
    const paras = j.segments?.length ? paragraphs(j.segments) : textParagraphs(j.text ?? "")
    return { paras, language: j.language }
  } finally {
    fs.rmSync(out, { recursive: true, force: true })
  }
}

type Job = { id: string; path: string; note: string; state: "queued" | "running" | "done" | "failed"; error?: string
  language?: string; started: number; finished?: number; kept?: string }
const jobs: Job[] = []
let queue: Promise<unknown> = Promise.resolve()
let n = 0

/** The notes that embed the file (newest first). */
function notesEmbedding(rel: string) {
  return [...plugin.vault.entries.values()].filter((e) => e.body.split("\n").some((l) => embedsAudio(l, rel)))
    .sort((a, b) => Number(b.stat.ns - a.stat.ns)).map((e) => e.rel)
}

async function work(job: Job) {
  job.state = "running"
  try {
    const found = await transcriber()
    if (!found.t) throw new Error(found.why ?? "no transcriber")
    const vault = plugin.vault
    const abs = vault.abs(job.path)
    if (!fs.existsSync(abs)) throw new Error(`${job.path} isn't there any more`)
    const { paras, language } = await transcribe(found.t, abs)
    job.language = language
    // Into the note as it is now (the user may have typed meanwhile): a small edit, written while no other write runs.
    await vault.lock(async () => {
      await vault.sync()
      const note = vault.abs(job.note)
      if (!fs.existsSync(note)) throw new Error(`${job.note} isn't there any more`)
      const text = fs.readFileSync(note, "utf8")
      const next = withTranscript(text, job.path, paras)
      if (next !== text) writeAtomic(note, next)
      await vault.sync()
    })
    job.state = "done"
  } catch (e) {
    job.state = "failed"
    job.error = String((e as Error)?.message ?? e)
  }
  job.finished = Date.now()
}

const clean = (p: unknown) => String(p ?? "").replace(/^\/+/, "")

plugin.route("GET", "audio-recorder/transcriber", async () => {
  const { available, name, why } = await transcriber()
  return { available, name, why, auto: plugin.settings().auto !== false }
})

plugin.route("POST", "audio-recorder/transcribe", async (req) => {
  const rel = clean(req.body.path)
  if (!rel || rel.split("/").some((p) => p === ".." || p.startsWith("."))) throw new HTTPError(400, "path must be a file in the vault")
  if (!AUDIO.test(rel)) throw new HTTPError(400, `${rel} isn't an audio file`)
  if (!fs.existsSync(plugin.vault.abs(rel))) throw new HTTPError(404, `no file ${rel}`)
  const found = await transcriber()
  if (!found.available) throw new HTTPError(409, found.why ?? "no transcriber here")
  let note = clean(req.body.note)
  if (note) {
    if (!plugin.vault.entries.has(note)) throw new HTTPError(404, `no note ${note}`)
  } else {
    note = notesEmbedding(rel)[0] ?? ""
    if (!note) throw new HTTPError(400, `no note embeds ${rel.split("/").pop()}: say which (note)`)
  }
  const job: Job = { id: `${Date.now().toString(36)}-${++n}`, path: rel, note, state: "queued", started: Date.now() }
  jobs.unshift(job)
  jobs.splice(50)
  queue = queue.then(() => work(job))
  return reply(202, job)
})

/** A voice note: transcribed, then inbox.voice with its words and the recording (kept above them), as who recorded it;
 *  one this Mac can't transcribe is kept in the inbox as the recording alone (`kept`: why), never lost. */
async function voice(job: Job, dir: string, file: string, from: string, who: Who, http: IncomingMessage | undefined) {
  job.state = "running"
  let why = ""
  try {
    const found = await transcriber()
    if (!found.t) why = found.why ?? "no transcriber"
    else {
      try {
        const { paras, language } = await transcribe(found.t, file)
        job.language = language
        const text = paras.join("\n\n").trim()
        if (!text) throw new Error("nothing was heard")
        const r = await plugin.runOp("inbox.voice", { text, from, audio: fs.readFileSync(file).toString("base64"), ext: path.extname(file).slice(1) }, who, http)
        job.note = String((r.result as { path?: unknown })?.path ?? "")
      } catch (e) {
        if (job.note) throw e
        why = `${found.name} couldn't: ${String((e as Error)?.message ?? e).replace(/\.$/, "")}.`
      }
    }
    if (why) {
      const d = new Date(), p2 = (n: number) => String(n).padStart(2, "0")
      const when = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`
      const up = await plugin.runOp("file.upload", { data: fs.readFileSync(file).toString("base64"), name: `Voice note ${when}${path.extname(file)}` }, who, http)
      const saved = String((up.result as { path?: unknown })?.path ?? "")
      const r = await plugin.runOp("inbox.add", { title: `Voice note ${when}`, from, body: `![[${path.posix.basename(saved)}]]\n\n_Not transcribed: ${why}_` }, who, http)
      job.note = String((r.result as { path?: unknown })?.path ?? "")
      job.kept = why
    }
    job.state = "done"
  } catch (e) {
    job.state = "failed"
    job.error = String((e as Error)?.message ?? e)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  job.finished = Date.now()
}

plugin.route("POST", "audio-recorder/voice", async (req) => {
  const data = typeof req.body.data === "string" ? Buffer.from(req.body.data, "base64") : null
  if (!data?.length) throw new HTTPError(400, "data: the recording, base64")
  const ext = /^[a-z0-9]{1,5}$/i.test(String(req.body.ext ?? "")) ? String(req.body.ext) : "webm"
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-voice-"))
  const file = path.join(dir, `voice.${ext}`)
  fs.writeFileSync(file, data)
  const h = (k: string) => { const v = req.http?.headers[k]; return typeof v === "string" ? v : null }
  const who = whoOf(h("x-vaultite-client"), h("x-vaultite-agent"))
  const job: Job = { id: `${Date.now().toString(36)}-${++n}`, path: "", note: "", state: "queued", started: Date.now() }
  jobs.unshift(job)
  jobs.splice(50)
  queue = queue.then(() => voice(job, dir, file, String(req.body.from ?? "").trim(), who, req.http))
  return reply(202, job)
}, { lock: false })

plugin.route("GET", "audio-recorder/jobs", () => jobs)
plugin.route("GET", "audio-recorder/jobs/*", (req) => {
  const job = jobs.find((j) => j.id === req.arg(0))
  if (!job) throw new HTTPError(404, `no job ${req.arg(0)}`)
  return job
})
