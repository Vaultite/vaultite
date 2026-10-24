import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { IncomingMessage } from "node:http"
import type { VaultTest } from "./harness.ts"
import { standIn } from "../lib.ts"

export default async ($: VaultTest) => {
  const { VAULT, api, check, exists, read, sleep, tmp, write } = $
  // ---------- Audio recorder: transcripts as jobs, written under the recording's embed ----------
  {
    // (outside the vault: a program in it is never run)
    const fake = standIn(tmp, "fake-transcriber.sh", 'console.log(`Heard ${process.argv[2].replace(/^.*[\\\\/]/, "")}.\\n\\nSecond paragraph.`)')
    const settings = ".vaultite/plugins/audio-recorder/data.json"
    // Which program runs is this machine's (data/config.json), never the vault's.
    const config = path.join(process.env.VAULTITE_LOCAL!, "config.json")
    const configWas = fs.existsSync(config) ? fs.readFileSync(config, "utf8") : null
    const local = (command: string) => {
      fs.mkdirSync(path.dirname(config), { recursive: true })
      fs.writeFileSync(config, JSON.stringify({ ...(configWas ? JSON.parse(configWas) : {}), "audio-recorder": { command } }))
    }
    write(settings, JSON.stringify({ command: "/bin/echo {file}", whisper: "/bin/echo" }))
    local(`"${fake}" {file}`)
    write("Attachments/memo.m4a", "not really audio")
    write("Notes/Memo.md", "---\ntype: note\n---\n\nBefore\n![[memo.m4a]]\nAfter\n")
    let [st, tr] = await api("GET", "audio-recorder/transcriber")
    check("audio: a transcriber from this machine's config, not the vault's settings", st === 200 && tr.available && tr.name === path.basename(fake) && tr.auto === true, tr)
    const [s1, job] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/memo.m4a" })
    check("audio: a transcript is a job, for the note that embeds the file", s1 === 202 && job.note === "Notes/Memo.md" && ["queued", "running"].includes(job.state), job)
    let j = job
    for (let i = 0; i < 50 && (j.state === "queued" || j.state === "running"); i++) { await sleep(100); [, j] = await api("GET", `audio-recorder/jobs/${job.id}`) }
    check("audio: the job is done", j.state === "done", j)
    check("audio: the transcript is under the embed, as a folded callout", read("Notes/Memo.md").endsWith(
      "Before\n![[memo.m4a]]\n> [!quote]- Transcript\n> Heard memo.m4a.\n>\n> Second paragraph.\n\nAfter\n"), read("Notes/Memo.md"))
    const [s2] = await api("POST", "audio-recorder/transcribe", { path: "Notes/Memo.md" })
    const [s3] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/memo.m4a", note: "Notes/Nope.md" })
    write("Attachments/loose.m4a", "x")
    const [s4, e4] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/loose.m4a" })
    check("audio: only audio, into a note that's there; a file no note embeds needs one named", s2 === 400 && s3 === 404 && s4 === 400 && /no note embeds/.test(e4.error), [s2, s3, s4, e4])
    // A voice note (Record a voice note for your inbox): transcribed, then inbox.voice, the recording kept above its words.
    // (the recording as the body, any size, as the app sends it)
    const { Readable } = await import("node:stream")
    const sent = (b: Buffer) => Object.assign(Readable.from([b]), { headers: { "content-type": "audio/webm" } }) as unknown as IncomingMessage
    const [s6, vj] = await api("POST", "audio-recorder/voice?ext=webm&from=Computer", {}, sent(Buffer.from("not really audio")))
    let v = vj
    for (let i = 0; i < 50 && (v.state === "queued" || v.state === "running"); i++) { await sleep(100); [, v] = await api("GET", `audio-recorder/jobs/${vj.id}`) }
    check("audio: a voice note is transcribed into the inbox, from where it was said", s6 === 202 && v.state === "done" && v.note.startsWith("Inbox/Heard voice") &&
      read(v.note).includes("from: Computer") && read(v.note).includes("Heard voice.webm.\n\nSecond paragraph."), [v, v.note && read(v.note)])
    const heard = v.note ? /^!\[\[(Voice note [^\]]+\.webm)\]\]$/m.exec(read(v.note))?.[1] : undefined
    check("audio: a voice note's recording is kept, embedded above its words", !!heard && read(`Attachments/${heard}`) === "not really audio" &&
      read(v.note).includes(`![[${heard}]]\n\nHeard voice.webm.`), v.note && read(v.note))
    if (heard) fs.rmSync(path.join(VAULT, "Attachments", heard))
    check("audio: a voice note leaves no temporary copy", !fs.readdirSync(os.tmpdir()).some((f) => f.startsWith("vaultite-voice-")), fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith("vaultite-voice-")))
    const [s7] = await api("POST", "audio-recorder/voice", {}, sent(Buffer.alloc(0)))
    check("audio: a voice note needs its recording", s7 === 400, s7)
    if (v.note) fs.rmSync(path.join(VAULT, v.note))
    const inVault = path.join(VAULT, path.basename(fake))
    fs.copyFileSync(fake, inVault); fs.chmodSync(inVault, 0o755)
    local(`"${inVault}" {file}`)
    ;[, tr] = await api("GET", "audio-recorder/transcriber")
    check("audio: a program inside the vault is never run", !tr.available && /inside the vault/.test(tr.why), tr)
    // A transcriber that fails says why, not its progress bar (redrawn with \r, all one line).
    const failing = standIn(tmp, "failing-transcriber.sh", 'process.stderr.write(" 10%|#  | 1/10 [00:01<00:09]\\r 20%|##  | 2/10 [00:02<00:08]\\rout of memory\\n"); process.exitCode = 1')
    local(`"${failing}" {file}`)
    {
      const [, fj] = await api("POST", "audio-recorder/voice?ext=m4a&from=Computer", {}, sent(Buffer.from("not really audio")))
      let f = fj
      for (let i = 0; i < 50 && (f.state === "queued" || f.state === "running"); i++) { await sleep(100); [, f] = await api("GET", `audio-recorder/jobs/${fj.id}`) }
      check("audio: a transcriber's failure is its reason, not its progress bar", /out of memory/.test(f.kept ?? "") && !/%\|/.test(f.kept ?? ""), f)
      const audio = f.note ? /!\[\[(Voice note [^\]]+\.m4a)\]\]/.exec(read(f.note))?.[1] : null
      if (f.note) fs.rmSync(path.join(VAULT, f.note))
      if (audio) fs.rmSync(path.join(VAULT, "Attachments", audio))
    }
    if (configWas === null) fs.rmSync(config); else fs.writeFileSync(config, configWas)
    write(settings, JSON.stringify({ model: "../Attachments/model.pt", engine: "whisper" }))
    ;[, tr] = await api("GET", "audio-recorder/transcriber")
    check("audio: a model is a name, never a path (whisper would load it)", !tr.available, tr)
    write(settings, JSON.stringify({ transcribe: false }))
    ;[, tr] = await api("GET", "audio-recorder/transcriber")
    const [s5] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/memo.m4a" })
    check("audio: transcribe: false turns it off", !tr.available && s5 === 409, [tr, s5])
    // A voice note this machine can't transcribe is kept in the inbox as the recording, saying why.
    write(settings, JSON.stringify({ engine: "apple", language: "xx" }))
    ;[, tr] = await api("GET", "audio-recorder/transcriber")
    check("audio: no transcriber says why, not what to install", !tr.available && !/install/i.test(tr.why) && /Apple/.test(tr.why), tr)
    {
      const [sk, kj] = await api("POST", "audio-recorder/voice?ext=m4a&from=Computer", {}, sent(Buffer.from("not really audio")))
      let k = kj
      for (let i = 0; i < 50 && (k.state === "queued" || k.state === "running"); i++) { await sleep(100); [, k] = await api("GET", `audio-recorder/jobs/${kj.id}`) }
      const kept = k.note ? read(k.note) : ""
      const audio = /!\[\[(Voice note [^\]]+\.m4a)\]\]/.exec(kept)?.[1]
      check("audio: a voice note it can't transcribe is kept in the inbox, the recording embedded", sk === 202 && k.state === "done" && !!k.kept &&
        k.note.startsWith("Inbox/Voice note ") && kept.includes("_Not transcribed: ") && !!audio && exists(`Attachments/${audio}`), [k, kept])
      if (k.note) fs.rmSync(path.join(VAULT, k.note))
      if (audio) fs.rmSync(path.join(VAULT, "Attachments", audio))
    }
    // Apple's speech recognition (macOS 26): nothing to install; a recording transcribed under its embed.
    write(settings, JSON.stringify({ engine: "apple", language: "en" }))
    ;[, tr] = await api("GET", "audio-recorder/transcriber")
    if (process.platform === "darwin" && Number(os.release().split(".")[0]) >= 25) {
      check("audio: Apple's speech recognition on macOS 26", tr.available && tr.name === "Apple's speech recognition", tr)
      const { execFileSync } = await import("node:child_process")
      execFileSync("/usr/bin/say", ["-o", path.join(VAULT, "Attachments", "said.m4a"), "--file-format=m4af", "--data-format=aac", "Water the plants on Sunday."])
      write("Notes/Said.md", "---\ntype: note\n---\n\n![[said.m4a]]\n")
      const [, sj] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/said.m4a" })
      let sd = sj
      for (let i = 0; i < 300 && (sd.state === "queued" || sd.state === "running"); i++) { await sleep(100); [, sd] = await api("GET", `audio-recorder/jobs/${sj.id}`) }
      check("audio: Apple's transcript under the embed", sd.state === "done" && /water the plants on sunday/i.test(read("Notes/Said.md")), [sd, read("Notes/Said.md")])
      for (const f of ["Attachments/said.m4a", "Notes/Said.md"]) fs.rmSync(path.join(VAULT, f))
    } else check("audio: Apple's needs macOS 26, and says so", !tr.available && /macOS 26/.test(tr.why), tr)
    // whisper.cpp, where it's installed with a model (~/.cache/whisper.cpp): before openai-whisper, on the GPU.
    write(settings, JSON.stringify({ engine: "whisper", language: "en" }))
    ;[, tr] = await api("GET", "audio-recorder/transcriber")
    if (process.platform === "darwin" && /^whisper\.cpp /.test(tr.name ?? "")) {
      const { execFileSync } = await import("node:child_process")
      execFileSync("/usr/bin/say", ["-o", path.join(VAULT, "Attachments", "said.m4a"), "--file-format=m4af", "--data-format=aac", "Water the plants on Sunday."])
      write("Notes/Said.md", "---\ntype: note\n---\n\n![[said.m4a]]\n")
      const [, wj] = await api("POST", "audio-recorder/transcribe", { path: "Attachments/said.m4a" })
      let wd = wj
      for (let i = 0; i < 1200 && (wd.state === "queued" || wd.state === "running"); i++) { await sleep(100); [, wd] = await api("GET", `audio-recorder/jobs/${wj.id}`) }
      check("audio: whisper.cpp's transcript under the embed", wd.state === "done" && /water the plants on sunday/i.test(read("Notes/Said.md")), [wd, read("Notes/Said.md")])
      for (const f of ["Attachments/said.m4a", "Notes/Said.md"]) fs.rmSync(path.join(VAULT, f))
    }
    if (process.platform !== "darwin") {
      write(settings, "{}")
      ;[, tr] = await api("GET", "audio-recorder/transcriber")
      check("audio: off a Mac, Apple's isn't tried, and it says what to install", tr.available || (/pipx install openai-whisper|ffmpeg/.test(tr.why) && !/Apple/.test(tr.why)), tr)
    }
    for (const f of [settings, "Attachments/memo.m4a", "Attachments/loose.m4a", "Notes/Memo.md", path.basename(fake)]) fs.rmSync(path.join(VAULT, f))
  }
}
