// Sending an export from the app: pick the file, send it (a small one whole, a big one 8 MB at a time, so no request runs
// for minutes and a phone shows how far it got), then follow the import job, all in one toast that updates itself.
import { notify, openFile, post } from "@vaultite"
import type { Job } from "./chat"

const CHUNK = 8 << 20
const TOAST = "ai-import"
const HEADERS = { "X-Vaultite-Client": "app" }

/** Ask for the export (the zip ChatGPT or Claude emailed, or its conversations.json) and import it. */
export function pickExport() {
  const input = document.createElement("input")
  input.type = "file"
  input.accept = ".zip,.dms,.json,application/zip,application/json"
  input.style.display = "none"
  input.addEventListener("change", () => {
    const f = input.files?.[0]
    input.remove()
    if (f) void importFile(f)
  })
  document.body.append(input)
  input.click()
}

async function send(url: string, body: Blob, type = "application/octet-stream") {
  const res = await fetch(url, { method: "POST", body, headers: { ...HEADERS, "Content-Type": type } })
  const out = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(out?.error ?? `${res.status}`)
  return out
}

const pct = (a: number, b: number) => `${Math.min(100, Math.floor((a / Math.max(1, b)) * 100))}%`
const name = (j: Job) => (j.source === "claude" ? "Claude" : j.source === "chatgpt" ? "ChatGPT" : "the export")

/** Upload `file` and follow its import until it's done. Resolves with the finished job. */
export async function importFile(file: File): Promise<Job | null> {
  const say = (text: string) => notify(text, { id: TOAST, duration: Infinity })
  try {
    let job: Job
    const q = `name=${encodeURIComponent(file.name)}`
    if (file.size <= CHUNK) {
      say(`Sending ${file.name}…`)
      job = await send(`api/ai-import?${q}`, file)
    } else {
      let id = ""
      for (let at = 0; at < file.size; at += CHUNK) {
        say(`Sending ${file.name}… ${pct(at, file.size)}`)
        const r = await send(`api/ai-import/upload?${id ? `id=${id}&offset=${at}` : ""}`, file.slice(at, at + CHUNK))
        id = r.id
      }
      job = await send("api/ai-import", new Blob([JSON.stringify({ upload: id, name: file.name })]), "application/json")
    }
    for (;;) {
      if (job.state === "done" || job.state === "failed") break
      say(job.state === "queued" ? "Waiting for the import before it…" : `Importing from ${name(job)}… ${job.chats} chats, ${pct(job.read, job.total)}`)
      await new Promise((r) => setTimeout(r, 800))
      job = await fetch(`api/ai-import/jobs/${job.id}`, { headers: HEADERS }).then((r) => r.json())
    }
    finished(job)
    return job
  } catch (e) {
    notify(`Couldn't import ${file.name}: ${(e as Error).message}`, { id: TOAST, kind: "error" })
    return null
  }
}

/** One line for what an import did. */
export function summary(j: Job) {
  if (j.state === "failed") return `Couldn't import ${j.name}: ${j.error ?? "it failed"}`
  const parts = [`${j.created} new`]
  if (j.updated) parts.push(`${j.updated} updated`)
  if (j.unchanged) parts.push(`${j.unchanged} already here`)
  if (j.skipped) parts.push(`${j.skipped} short one${j.skipped === 1 ? "" : "s"} skipped`)
  const extra = [j.projects ? `${j.projects} project${j.projects === 1 ? "" : "s"}` : "", j.images ? `${j.images} image${j.images === 1 ? "" : "s"}` : "",
    j.memories ? `${j.memories} memor${j.memories === 1 ? "y" : "ies"} to review` : ""].filter(Boolean)
  return `${name(j)}: ${j.chats} chats (${parts.join(", ")})${extra.length ? `, ${extra.join(", ")}` : ""}.`
}

function finished(j: Job) {
  if (j.state === "failed") { notify(summary(j), { id: TOAST, kind: "error" }); return }
  const review = j.review
  notify(summary(j), { id: TOAST, duration: 12000, action: review ? { label: "Review memories", run: () => openFile(review) } : undefined })
}

/** Add a review list's ticked memories (the op ai-import.apply, on the server) and say how it went. */
export async function applyReview(path: string) {
  try {
    const r = await post<{ added: number; failed: number; results: { fact: string; error?: string }[] }>("ops/ai-import.apply", { path })
    if (!r.added && !r.failed) notify("Nothing ticked to add")
    else if (!r.failed) notify(`Added ${r.added} memor${r.added === 1 ? "y" : "ies"}`)
    else notify(`Added ${r.added}; ${r.failed} couldn't be (why is under each)`, { kind: "error" })
  } catch (e) {
    notify(`Couldn't add them: ${(e as Error).message}`, { kind: "error" })
  }
}
