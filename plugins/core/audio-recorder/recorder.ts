// Recording: one at a time for the whole app, saved as an attachment of its note and embedded, then transcribed when
// the server can. Indicator.tsx draws what's recording.
import {
  activeFile, appDevice, askMicrophone, attachmentFolder, choose, createFile, currentFile, dismissNotice, folderOf, get, getStore, insertOnOwnLine,
  newNoteFolder, notify, notifyError, openFile, pasteAttachments, phoneVoiceNote, post, put, readFile, reload, stem,
} from "@vaultite"

export type Status =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "recording" | "paused"; since: number; before: number; note: string | null
      /** A voice note for the inbox (Record a voice note), not a recording in a note. */
      voice?: boolean }
  | { state: "saving" }

let status: Status = { state: "idle" }
const subs = new Set<() => void>()
const set = (s: Status) => { status = s; subs.forEach((f) => f()) }
export const getStatus = () => status
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f) } }
export const recording = () => status.state === "recording" || status.state === "paused"

let rec: MediaRecorder | null = null
let stream: MediaStream | null = null
let chunks: Blob[] = []
let started = new Date()
let lock: { release: () => Promise<void> } | null = null
/** The input's level, 0..1, while recording (Indicator.tsx draws it). */
export let level = () => 0

/** What the browser records in, best first: AAC in MP4 plays everywhere (Safari and iPhones record only MP4). */
const TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
const pickType = () => TYPES.find((t) => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } })
export const extOf = (type: string) => (/mp4|aac|m4a/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : "webm")

const p2 = (n: number) => String(n).padStart(2, "0")
/** "Recording 2026-10-01 14.03.12" (local time, when it started). */
export const recordingName = (d: Date) =>
  `Recording ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`

/** Seconds recorded so far (pauses left out). */
export function elapsed(s = status) {
  if (s.state !== "recording" && s.state !== "paused") return 0
  return s.before + (s.state === "recording" ? (Date.now() - s.since) / 1000 : 0)
}

/** Start recording, for `note` (the file being edited, when left out), or (`voice`) a voice note for the inbox. */
export async function start(note?: string | null, voice = false) {
  if (status.state !== "idle") return
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
    notify(location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1"
      ? "This browser can't record audio." : "Recording needs the app opened over https.", { kind: "error" })
    return
  }
  const target = note === undefined ? activeFile()?.path ?? null : note
  set({ state: "starting" })
  try {
    if (!(await askMicrophone())) throw new Error("Vaultite isn't allowed to use the microphone (System Settings, Privacy and security, Microphone)")
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
    const type = pickType()
    rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
  } catch (e) {
    stop_tracks()
    set({ state: "idle" })
    const why = (e as Error)?.name === "NotAllowedError" ? "the microphone isn't allowed for this page" : (e as Error)?.name === "NotFoundError" ? "no microphone found" : e
    notifyError(why, "Couldn't start recording")
    return
  }
  chunks = []
  started = new Date()
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data) }
  rec.onstop = () => void (voice ? sendVoice() : finish(target))
  rec.start(1000)
  meter(stream)
  set({ state: "recording", since: Date.now(), before: 0, note: voice ? null : target, voice })
  // The screen kept on (going to sleep would end it on a phone); never waited for (it may not answer at all).
  const wl = (navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } }).wakeLock
  wl?.request("screen").then((l) => { if (recording()) lock = l; else void l.release().catch(() => {}) }, () => {})
}

export function pause() {
  if (status.state !== "recording" || !rec) return
  rec.pause()
  set({ ...status, state: "paused", before: elapsed() })
}
export function resume() {
  if (status.state !== "paused" || !rec) return
  rec.resume()
  set({ ...status, state: "recording", since: Date.now() })
}

/** Stop and save (MediaRecorder's last data arrives, then `finish`). */
export function stop() {
  if (!recording() || !rec) return
  set({ state: "saving" })
  rec.stop()
}

function stop_tracks() {
  stream?.getTracks().forEach((t) => t.stop())
  stream = null
  level = () => 0
  void lock?.release().catch(() => {})
  lock = null
}

/** The input's loudness, for the indicator's meter (nothing when the page can't have an AudioContext yet). */
function meter(s: MediaStream) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    void ctx.resume().catch(() => {}) // (iPhones start it suspended outside a tap)
    const an = ctx.createAnalyser()
    an.fftSize = 512
    ctx.createMediaStreamSource(s).connect(an)
    const buf = new Uint8Array(an.fftSize)
    level = () => {
      an.getByteTimeDomainData(buf)
      let sum = 0
      for (const v of buf) sum += ((v - 128) / 128) ** 2
      return Math.min(1, Math.sqrt(sum / buf.length) * 4)
    }
    s.getTracks()[0]?.addEventListener("ended", () => void ctx.close().catch(() => {}))
    const end = () => { if (!stream) void ctx.close().catch(() => {}); else setTimeout(end, 1000) }
    setTimeout(end, 1000)
  } catch { /* no meter */ }
}

/** Where a new note for a recording goes (no note was being edited). */
const newNotePath = (name: string) => {
  const folder = newNoteFolder(getStore(), currentFile())
  return `${folder ? `${folder}/` : ""}${name}.md`
}

/** The saved file's vault path, from what pasteAttachments typed for it. */
function savedPath(embed: string, from: string) {
  const wiki = /^!\[\[([^\]]+)\]\]$/.exec(embed.trim())
  if (wiki) { const dir = attachmentFolder(getStore(), from); return `${dir ? `${dir}/` : ""}${wiki[1]}` }
  const md = /\]\(([^)]+)\)$/.exec(embed.trim())
  return md ? decodeURIComponent(md[1]) : ""
}

/** What was recorded, as a file named for when it started; the recorder let go. */
function taken() {
  const type = rec?.mimeType || chunks[0]?.type || "audio/webm"
  const blob = new Blob(chunks, { type })
  rec = null
  chunks = []
  stop_tracks()
  return { blob, type, file: new File([blob], `${recordingName(started)}.${extOf(type)}`, { type }) }
}

/** Never lose a recording: offer it as a download. */
const keep = (why: unknown, blob: Blob, file: File) => notify(`Couldn't save the recording: ${String((why as Error)?.message ?? why)}`, {
  kind: "error", duration: Infinity,
  action: { label: "Download", run: () => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click() } },
})

/** A tap by mistake (under 0.7 s, as on the phone and watch): not saved, and said so. */
function tooShort() {
  if (Date.now() - started.getTime() >= 700) return false
  notify("Too short, not saved", { duration: 2000 })
  return true
}

async function finish(note: string | null) {
  const { blob, file } = taken()
  if (tooShort()) { set({ state: "idle" }); return }
  const name = recordingName(started)
  const s = getStore()
  try {
    if (!s) throw new Error("the app isn't ready")
    if (!blob.size) throw new Error("nothing was recorded")
    const from = note ?? newNotePath(name)
    const embed = await pasteAttachments(s, from, [file])
    const audio = savedPath(embed, from)
    await reload() // (the store has the file before the embed is drawn)
    let target = note
    if (note && activeFile()?.path === note) insertOnOwnLine(embed)
    else if (note) {
      const f = await readFile(note)
      await put("file", { path: note, text: f.text + (f.text && !f.text.endsWith("\n") ? "\n" : "") + `${embed}\n`, base: f.text })
    } else {
      const made = await createFile(folderOf(from), name, `${embed}\n`)
      target = made.path
      openFile(made.path)
    }
    set({ state: "idle" })
    if (target && audio && (await transcriber()).auto) await transcribe(audio, target)
    else notify(`Saved ${file.name}`)
  } catch (e) {
    set({ state: "idle" })
    keep(e, blob, file)
  }
}

/** A voice note as the phone's widget sends one: transcribed on the server and put in the inbox (inbox.voice), the
 *  recording kept above its words (alone, when it couldn't be transcribed). */
async function sendVoice() {
  const { blob, type, file } = taken()
  set({ state: "idle" })
  if (tooShort()) return
  const id = "voice-note"
  notify("Sending your voice note…", { id, duration: Infinity })
  try {
    if (!blob.size) throw new Error("nothing was recorded")
    const from = matchMedia("(pointer: coarse)").matches ? "Phone" : "Computer"
    // (the recording as it is, any length: streamed from the page, never base64)
    const res = await fetch(`api/audio-recorder/voice?ext=${extOf(type)}&from=${encodeURIComponent(from)}`, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream", "X-Vaultite-Client": `app/${appDevice}` }, body: blob })
    let job = await res.json() as Job
    if (!res.ok) throw new Error((job as unknown as { error?: string }).error || res.statusText)
    while (job.state === "queued" || job.state === "running") {
      await new Promise((r) => setTimeout(r, 1500))
      try { job = await get<Job>(`audio-recorder/jobs/${job.id}`) } catch { /* asked again */ }
    }
    if (job.state === "failed") throw new Error(job.error ?? "it failed")
    dismissNotice(id)
    // (the id Inbox's own toast for a new result has: one toast, not two)
    const r = job.note.replace(/\.md$/, "")
    notify(job.kept ? `In your inbox as a recording, not transcribed: ${job.kept}` : `In your inbox: ${r.split("/").pop()}`,
      { id: `inbox-${r}`, action: { label: "Open", run: () => openFile(job.note) } })
  } catch (e) {
    dismissNotice(id)
    keep(e, blob, file)
  }
}

// ---------- transcripts (plugin.ts runs them) ----------

type Transcriber = { available: boolean; name?: string; why?: string; auto?: boolean }
let known: Transcriber | null = null
let asked = 0
/** What transcribes on the server (asked again after a minute). */
export async function transcriber(): Promise<Transcriber> {
  if (!known || Date.now() - asked > 60_000) {
    asked = Date.now()
    known = await get<Transcriber>("audio-recorder/transcriber").catch(() => known ?? { available: false })
  }
  return known
}
/** The last answer, for menus and `when` (which can't wait); asks again in the background. */
export function canTranscribe() {
  if (!known || Date.now() - asked > 60_000) void transcriber()
  return !!known?.available
}

type Job = { id: string; path: string; note: string; state: "queued" | "running" | "done" | "failed"; error?: string; kept?: string }

/** "Record a voice note": the iPhone app's own (what its widgets open), else one recorded here, which needs the
 *  server to transcribe it. */
export async function voiceNote() {
  if (phoneVoiceNote()) return
  void transcriber() // (one the server can't transcribe is kept in the inbox as a recording)
  await start(null, true)
}

/** Transcribe `audio` into `note` (left out: the notes that embed it; none: a new note for it), telling the user how it
 *  went. The server writes the transcript, so it lands even if this page is closed meanwhile. */
export async function transcribe(audio: string, note?: string) {
  const file = audio.split("/").pop()!
  let job: Job
  try {
    job = await post<Job>("audio-recorder/transcribe", { path: audio, note })
  } catch (e) {
    if (note || !/no note embeds/.test(String(e))) { notifyError(e, `Couldn't transcribe ${file}`); return }
    // No note has it yet: a new one, with it.
    const made = await createFile(newNoteFolder(getStore(), currentFile()), stem(file).replace(/\.[^.]+$/, ""), `![[${file}]]\n`)
    openFile(made.path)
    return transcribe(audio, made.path)
  }
  const id = `transcribe-${job.id}`
  notify(`Transcribing ${file}…`, { id, duration: Infinity })
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000))
    try { job = await get<Job>(`audio-recorder/jobs/${job.id}`) } catch { continue }
    if (job.state === "done") {
      const here = activeFile()?.path === job.note
      notify(`Transcribed ${file}`, { id, duration: 4000, action: here ? undefined : { label: "Open", run: () => openFile(job.note) } })
      return
    }
    if (job.state === "failed") { notify(`Couldn't transcribe ${file}: ${job.error ?? "it failed"}`, { id, kind: "error", duration: 8000 }); return }
  }
}

const AUDIO = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|webm|weba|aiff?|caf)$/i
export const isAudio = (path: string) => AUDIO.test(path)

/** The audio files a note embeds (vault paths). */
export function audioIn(text: string): string[] {
  const s = getStore()
  if (!s) return []
  const out = new Set<string>()
  for (const m of text.matchAll(/!\[\[([^\]|#\n]+)(?:[|#][^\]\n]*)?\]\]|!\[[^\]\n]*\]\(<?([^)>\n]+)>?\)/g)) {
    let t = (m[1] ?? m[2]).trim()
    try { t = decodeURIComponent(t) } catch { /* as written */ }
    if (!AUDIO.test(t)) continue
    const low = t.toLowerCase().replace(/^\.?\//, "")
    const hit = s.files.others.find((o) => o.path.toLowerCase() === low || o.path.split("/").pop()!.toLowerCase() === low)
    if (hit) out.add(hit.path)
  }
  return [...out]
}

/** "Transcribe audio": the audio file that's open, or one the note being edited embeds (asked which, when several). */
export function transcribeHere() {
  const cur = currentFile()
  if (cur && isAudio(cur)) return void transcribe(cur)
  const f = activeFile()
  const list = f ? audioIn(f.text()) : []
  if (!f || !list.length) { notify("Open an audio file, or a note with a recording in it."); return }
  if (list.length === 1) return void transcribe(list[0], f.path)
  choose({
    title: "Transcribe audio", placeholder: "Transcribe which recording…",
    items: list.map((p) => ({ id: p, label: p.split("/").pop()!, detail: folderOf(p) || undefined })),
    onPick: (it) => void transcribe(it.id, f.path),
  })
}
