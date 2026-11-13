import {
  activeFile, appDevice, askMicrophone, attachmentFolder, cell, choose, createFile, currentFile, dismissNotice, folderOf, get, getStore,
  insertOnOwnLine, newNoteFolder, notify, notifyError, openFile, pasteAttachments, phoneVoiceNote, post, put, readFile, reload, stem, trackUnderway,
} from "@vaultite"

export type Status =
  | { state: "idle" }
  | { state: "starting" }
  | { state: "recording" | "paused"; since: number; before: number; note: string | null
      voice?: boolean }
  | { state: "saving" }

const status = cell<Status>({ state: "idle" })
const set = status.set
export const { get: getStatus, use: useStatus } = status
export const recording = () => getStatus().state === "recording" || getStatus().state === "paused"

let rec: MediaRecorder | null = null
let stream: MediaStream | null = null
let chunks: Blob[] = []
let started = new Date()
let lock: { release: () => Promise<void> } | null = null
export let level = () => 0

/** Safari and iPhones record only MP4. */
const TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
const pickType = () => TYPES.find((t) => { try { return MediaRecorder.isTypeSupported(t) } catch { return false } })
export const extOf = (type: string) => (/mp4|aac|m4a/.test(type) ? "m4a" : /ogg/.test(type) ? "ogg" : /wav/.test(type) ? "wav" : "webm")

const p2 = (n: number) => String(n).padStart(2, "0")
export const recordingName = (d: Date) =>
  `Recording ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}`

export function elapsed(s = getStatus()) {
  if (s.state !== "recording" && s.state !== "paused") return 0
  return s.before + (s.state === "recording" ? (Date.now() - s.since) / 1000 : 0)
}

let held = false
export async function start(note?: string | null, voice = false) {
  if (getStatus().state !== "idle") return
  if (!held) { trackUnderway(() => getStatus().state !== "idle"); held = true }
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
    const name = e instanceof DOMException ? e.name : ""
    const why = name === "NotAllowedError" ? "the microphone isn't allowed for this page" : name === "NotFoundError" ? "no microphone found" : e
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
  // A phone's sleep ends a recording; a wake lock request may never answer.
  const wl = "wakeLock" in navigator ? navigator.wakeLock : undefined
  wl?.request("screen").then((l) => { if (recording()) lock = l; else void l.release().catch(() => {}) }, () => {})
}

export function pause() {
  const s = getStatus()
  if (s.state !== "recording" || !rec) return
  rec.pause()
  set({ ...s, state: "paused", before: elapsed() })
}
export function resume() {
  const s = getStatus()
  if (s.state !== "paused" || !rec) return
  rec.resume()
  set({ ...s, state: "recording", since: Date.now() })
}

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

function meter(s: MediaStream) {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    void ctx.resume().catch(() => {}) // (iPhones start an AudioContext suspended outside a tap)
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

const newNotePath = (name: string) => {
  const folder = newNoteFolder(getStore(), currentFile())
  return `${folder ? `${folder}/` : ""}${name}.md`
}

function savedPath(embed: string, from: string) {
  const wiki = /^!\[\[([^\]]+)\]\]$/.exec(embed.trim())
  if (wiki) { const dir = attachmentFolder(getStore(), from); return `${dir ? `${dir}/` : ""}${wiki[1]}` }
  const md = /\]\(([^)]+)\)$/.exec(embed.trim())
  return md ? decodeURIComponent(md[1]) : ""
}

function taken() {
  const type = rec?.mimeType || chunks[0]?.type || "audio/webm"
  const blob = new Blob(chunks, { type })
  rec = null
  chunks = []
  stop_tracks()
  return { blob, type, file: new File([blob], `${recordingName(started)}.${extOf(type)}`, { type }) }
}

const keep = (why: unknown, blob: Blob, file: File) => notifyError(why, "Couldn't save the recording", {
  duration: Infinity,
  action: { label: "Download", run: () => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = file.name; a.click() } },
})

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
    await reload()
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

async function sendVoice() {
  const { blob, type, file } = taken()
  set({ state: "idle" })
  if (tooShort()) return
  const id = "voice-note"
  notify("Sending your voice note…", { id, duration: Infinity })
  try {
    if (!blob.size) throw new Error("nothing was recorded")
    const from = matchMedia("(pointer: coarse)").matches ? "Phone" : "Computer"
    const res = await fetch(`api/audio-recorder/voice?ext=${extOf(type)}&from=${encodeURIComponent(from)}`, { method: "POST", headers: { "Content-Type": blob.type || "application/octet-stream", "X-Vaultite-Client": `app/${appDevice}` }, body: blob })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error || res.statusText)
    let job: Job = body
    while (job.state === "queued" || job.state === "running") {
      await new Promise((r) => setTimeout(r, 1500))
      try { job = await get<Job>(`audio-recorder/jobs/${job.id}`) } catch { /* asked again */ }
    }
    if (job.state === "failed") throw new Error(job.error ?? "it failed")
    dismissNotice(id)
    const r = job.note.replace(/\.md$/, "")
    notify(job.kept ? `In your inbox as a recording, not transcribed: ${job.kept}` : `In your inbox: ${r.split("/").pop()}`,
      { id: `inbox-${r}`, action: { label: "Open", run: () => openFile(job.note) } })
  } catch (e) {
    dismissNotice(id)
    keep(e, blob, file)
  }
}

type Transcriber = { available: boolean; name?: string; why?: string; auto?: boolean }
let known: Transcriber | null = null
let asked = 0
export async function transcriber(): Promise<Transcriber> {
  if (!known || Date.now() - asked > 60_000) {
    asked = Date.now()
    known = await get<Transcriber>("audio-recorder/transcriber").catch(() => known ?? { available: false })
  }
  return known
}
export function canTranscribe() {
  if (!known || Date.now() - asked > 60_000) void transcriber()
  return !!known?.available
}

type Job = { id: string; path: string; note: string; state: "queued" | "running" | "done" | "failed"; error?: string; kept?: string }

export async function voiceNote() {
  if (phoneVoiceNote()) return
  void transcriber()
  await start(null, true)
}

export async function transcribe(audio: string, note?: string) {
  const file = audio.split("/").pop()!
  const id = `transcribe-${audio}`
  notify(`Transcribing ${file}…`, { id, duration: Infinity })
  let job: Job
  try {
    job = await post<Job>("audio-recorder/transcribe", { path: audio, note })
  } catch (e) {
    dismissNotice(id)
    if (note || !/no note embeds/.test(String(e))) { notifyError(e, `Couldn't transcribe ${file}`); return }
    const made = await createFile(newNoteFolder(getStore(), currentFile()), stem(file).replace(/\.[^.]+$/, ""), `![[${file}]]\n`)
    openFile(made.path)
    return transcribe(audio, made.path)
  }
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

const AUDIO = /\.(mp3|m4a|m4b|aac|wav|ogg|oga|opus|flac|webm|weba|aiff?|caf)$/i
export const isAudio = (path: string) => AUDIO.test(path)

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
