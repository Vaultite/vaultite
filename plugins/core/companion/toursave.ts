import fs from "node:fs"
import os from "node:os"
import nodePath from "node:path"
import { type Machine, MACHINE_CLIENT, OpError, onTailnet, type Plugin, serverUrl } from "../../../core/plugins.ts"
import { safeName } from "../../../core/vault.ts"
import { z } from "zod"
import { messageOf } from "./errors.ts"
import { nativeSteps, parseTour, type Step, type Tour, tourFromAnswer, tourText } from "./tour.ts"
import { fileTitle } from "../../../core/desktop/names.ts"
import { saveFiles } from "./vaultfiles.ts"
import { proofUrl, recordProof } from "./proofvideo.ts"

const local = (p: string) => p.replace(/^~(?=\/)/, os.homedir())
function recordable(url: string) {
  const u = URL.parse(url)
  if (!u) throw new OpError(`record: an address (http://127.0.0.1:<port>), not ${url}`)
  if (!/^https?:$/.test(u.protocol)) throw new OpError(`record: an http address, not ${url}`)
  const here = ["127.0.0.1", "localhost", "[::1]", os.hostname().toLowerCase()].includes(u.hostname.toLowerCase())
  if (here && (u.port || (u.protocol === "https:" ? "443" : "80")) === String(process.env.PORT ?? "8793"))
    throw new OpError("record: that's the user's own app, where your change isn't yet: record on your own copy (your worktree's dev server, or a sandbox server: vau sandbox, then npm start on a free port)", 409)
}

const SavedThere = z.object({ path: z.string().optional(), error: z.string().optional() })
const SavedHome = z.record(z.string(), z.unknown()).and(z.object({ path: z.string().optional(), steps: z.number().optional(), job: z.string().optional(),
  video: z.string().optional(), size: z.string().optional(), seconds: z.number().optional(), warning: z.string().optional(), error: z.string().optional() }))

export type Answer = { text: string; ctx: Parameters<typeof tourFromAnswer>[2] & {} }
export function tourSaving(plugin: Plugin, o: { who: (p: { as?: unknown }) => string; lastAnswer: Map<string, Answer> }) {
  const { lastAnswer } = o
  const recording = (record: string, open: string, title: string, steps: Step[], out: string) =>
    recordProof({ url: proofUrl(record, open), tour: { title, steps }, out, pic: (src) => (nodePath.isAbsolute(src) ? src : plugin.vault.abs(src)) })
      .catch((e) => { throw new OpError(`couldn't record it: ${messageOf(e)}`, 409) })
  const isHere = async (url: string) => url === serverUrl() || url === ((await plugin.ask<Machine[]>("machines", [])).find((m) => m.self)?.url ?? "").replace(/\/+$/, "")
  async function saveHome(home: string, o: { title: string; job: string; tour: Tour; record: string; given: string; open: string; text: string; app?: unknown; site?: unknown; times?: unknown }) {
    if (!onTailnet(home)) throw new OpError(`home: a server on the tailnet, not ${home}`)
    if (!o.text.trim()) throw new OpError("text: a proof saved on its job's home names its steps (your last answer here isn't theirs)")
    const send = async (from: string, name: string) => {
      const r = await fetch(`${home}/api/ops/companion.job-file?${new URLSearchParams({ job: o.job, name })}`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/octet-stream" },
        body: fs.readFileSync(from), signal: AbortSignal.timeout(120_000) }).catch((e) => { throw new OpError(`its home (${home}) doesn't answer: ${messageOf(e)}`, 502) })
      const a = SavedThere.safeParse(await r.json().catch(() => ({}))).data ?? {}
      if (!r.ok || !a.path) throw new OpError(`its home couldn't keep ${name}: ${a.error ?? r.status}`, r.status >= 400 ? r.status : 502)
      return a.path
    }
    let text = o.text
    for (const st of o.tour.steps) for (const [which, src] of [["before", st.before], ["after", st.after]] as const) {
      if (!src || !nodePath.isAbsolute(local(src))) continue
      if (!fs.existsSync(local(src))) throw new OpError(`step ${st.n}: ${which}: ${src} isn't a picture here`)
      text = text.split(src).join(await send(local(src), `${which} ${st.n}${nodePath.extname(src).toLowerCase()}`))
    }
    let video = "", times = Array.isArray(o.times) ? o.times.map(Number) : undefined
    if (o.record) {
      const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "vaultite-proof-out-")), out = nodePath.join(tmp, `${safeName(o.title)}.mp4`)
      try { times = (await recording(o.record, o.open, o.title, o.tour.steps, out)).times; video = await send(out, nodePath.basename(out)) } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
    } else if (o.given) video = await send(o.given, `${safeName(o.title)}${nodePath.extname(o.given).toLowerCase()}`)
    const r = await fetch(`${home}/api/ops/companion.tour-save`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" }, signal: AbortSignal.timeout(60_000),
      body: JSON.stringify({ title: o.title, text, job: o.job, ...(o.open ? { open: o.open } : {}), ...(typeof o.app === "string" ? { app: o.app } : {}), ...(typeof o.site === "string" ? { site: o.site } : {}),
        ...(video ? { video, ...(times?.length ? { times } : {}) } : {}) }) }).catch((e) => { throw new OpError(`its home (${home}) doesn't answer: ${messageOf(e)}`, 502) })
    const a = SavedHome.safeParse(await r.json().catch(() => ({}))).data ?? {}
    if (!r.ok) throw new OpError(`its home: ${String(a.error ?? r.status)}`, r.status)
    return { ...a, home }
  }

  plugin.op({
    id: "companion.tour-save",
    cli: "companion tour-save",
    summary: "Save a walkthrough as a tour (Guides/<title>.md): your last answer on screen, its pointing sentences its steps, or the steps given; a job's proof with its video.",
    help: `"Save that as a tour": with no text, your last answer is saved, its ids (a3) as the words of what they were. Give
text to write it yourself, a step a numbered line with its tags, (wait: click) and (do: click "Send").

A job's proof (--job) is a video by default: --record <address> plays its steps there, on your own copy of the change
(your worktree's dev server or a sandbox server, never the user's live app), in a headless Chrome with no sound, each
step's words as a caption and its marks drawn in, and keeps the mp4 beside it (Guides/Proofs/<title>/). A step's
(before: <png>) flips over its thing; (after: <png>) shows a still of the Mac's own UI (the menu bar, the notch), which
no browser shows, as a before and after slide. --video keeps an mp4 you recorded yourself instead.

  vau companion tour-save "Start a chat"
  vau companion tour-save "Start a chat" --text '1. Start one here [ring "New chat"]. (wait: click)'
  vau companion tour-save "the blue save button" --job j3k9x2a --record http://127.0.0.1:8811 --open Notes/Idea.md \\
    --text '1. Save is blue now [ring "Save"]. (before: /tmp/save-before.png)'`,
    kind: "write",
    lock: false,
    params: {
      title: { type: "string", required: true, description: "its name (its file's)" },
      text: { type: "string", description: "its steps (else your last answer)" },
      app: { type: "string", description: "the app it's for (a bundle id; vaultite for the app itself)" },
      site: { type: "string", description: "the site it's for (a host)" },
      job: { type: "string", description: "the job it's the proof of (its id, as its prompt gives it): saved in Guides/Proofs, it's what Show me plays once the job is ready" },
      open: { type: "string", description: "with job: where the change shows (a note's path or a page's address), which Show me opens before it plays, and a recording opens on its server" },
      record: { type: "string", description: "with job: the address of your own copy of the change (http://127.0.0.1:<port>: your dev server or a sandbox server) to record its video on, headless" },
      video: { type: "string", description: "with job: an mp4 of it you recorded yourself (a file here), kept as its video" },
      times: { type: "array", items: { type: "number" }, description: "with video: when each step starts in it (ms)" },
      home: { type: "string", env: "VAULTITE_HOME", description: "with job: the job's home server (filled in from VAULTITE_HOME in a job's terminal on another machine): it's recorded here and saved there" },
      as: { type: "string", description: "the agent (another than the companion)" },
    },
    args: ["title"],
    run: async (p, ctx) => {
      const name = o.who(p), title = fileTitle(String(p.title), 80)
      if (!title) throw new OpError("give the tour a title")
      const last = lastAnswer.get(name)
      let tour: Tour
      if (typeof p.text === "string" && p.text.trim()) {
        const [t, problems] = parseTour({}, p.text, title)
        if (problems.length) throw new OpError(problems.join("; "))
        tour = t
      } else if (last) tour = tourFromAnswer(last.text, title, last.ctx)
      else throw new OpError("nothing to save: you haven't answered on screen lately; give its steps (text)", 409)
      const app = typeof p.app === "string" && p.app.trim() ? [p.app.trim()] : null, site = typeof p.site === "string" && p.site.trim() ? [p.site.trim().toLowerCase()] : null
      const open = typeof p.open === "string" ? p.open.trim() : ""
      tour = { ...tour, ...(app ? { app } : {}), ...(site ? { site } : {}), ...(open ? { open } : {}), ...(!app && !site && !tour.app.length && !tour.site.length && last ? { app: last.ctx.app ? [last.ctx.app] : [], site: last.ctx.site ? [last.ctx.site] : [] } : {}) }
      if (!tour.steps.length) throw new OpError("nothing to save: no steps")
      const job = typeof p.job === "string" ? p.job.trim() : ""
      if (job && !/^[\w-]{1,40}$/.test(job)) throw new OpError(`job: a job's id (j3k9x2a), not ${job}`)
      const record = typeof p.record === "string" ? p.record.trim() : "", given = typeof p.video === "string" ? local(p.video.trim()) : ""
      if ((record || given) && !job) throw new OpError("record and video are a job's proof: give its job too")
      if (record && given) throw new OpError("record or video, not both")
      if (record) recordable(record)
      if (given && (!/\.(mp4|m4v|mov|webm)$/i.test(given) || !fs.existsSync(given))) throw new OpError(`video: ${p.video} isn't a video here (an mp4, mov or webm file)`)
      const home = typeof p.home === "string" ? p.home.trim().replace(/\/+$/, "") : ""
      if (job && home && !(await isHere(home))) return await saveHome(home, { title, job, tour, record, given, open, text: typeof p.text === "string" ? p.text : "", app: p.app, site: p.site, times: p.times })
      const theirs = (rel: string) => { try { return !new RegExp(`^job: ${job}$`, "m").test(fs.readFileSync(plugin.vault.abs(rel), "utf8")) } catch { return false } }
      let base = job ? `Guides/Proofs/${title}` : `Guides/${title}`
      for (let n = 2; job && theirs(`${base}.md`); n++) base = `Guides/Proofs/${title} ${n}`
      const path = `${base}.md`
      const keep = async (from: string, name: string) => {
        if (fs.existsSync(plugin.vault.abs(`${base}/${name}`))) await ctx.api("DELETE", `file?path=${encodeURIComponent(`${base}/${name}`)}`)
        return (await saveFiles(ctx, base, [{ from, name }]))[0]
      }
      const picture = async (n: number, which: "before" | "after", src?: string) => {
        if (!src || !nodePath.isAbsolute(local(src))) return src
        const from = local(src), ext = nodePath.extname(from).toLowerCase()
        if (!/^\.(png|jpe?g|gif|webp|heic)$/.test(ext) || !fs.existsSync(from)) throw new OpError(`step ${n}: ${which}: ${src} isn't a picture here (png, jpg, gif, webp)`)
        return keep(from, `${which} ${n}${ext}`)
      }
      const steps = await Promise.all(tour.steps.map(async (st) => {
        const before = await picture(st.n, "before", st.before), after = await picture(st.n, "after", st.after)
        return { ...st, ...(before ? { before } : {}), ...(after ? { after } : {}) }
      }))
      let video: { path: string; times?: number[]; bytes: number; ms?: number } | null = null
      if (record || given) {
        const ext = record ? ".mp4" : nodePath.extname(given).toLowerCase(), file = `${safeName(title)}${ext}`
        if (record) {
          const tmp = fs.mkdtempSync(nodePath.join(os.tmpdir(), "vaultite-proof-out-")), out = nodePath.join(tmp, file)
          try {
            const r = await recording(record, open, title, steps, out)
            video = { path: await keep(out, file), times: r.times, bytes: r.bytes, ms: r.ms }
          } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
        } else {
          const times = Array.isArray(p.times) ? p.times.map(Number).filter((t: number) => Number.isFinite(t) && t >= 0) : []
          video = { path: await keep(given, file), bytes: fs.statSync(given).size, ...(times.length ? { times } : {}) }
        }
      }
      await ctx.api("PUT", "file", { path, text: tourText({ ...tour, steps, ...(job ? { job } : {}), ...(video ? { video: video.path, ...(video.times ? { times: video.times } : {}) } : {}) }) })
      const native = nativeSteps(tour).filter((n) => !steps.find((s) => s.n === n)?.after)
      const warning = [native.length ? `step${native.length > 1 ? "s" : ""} ${native.join(", ")} name${native.length > 1 ? "" : "s"} the Mac's own UI (the menu bar, the notch, a notification), which neither a recording nor Vaultite's window shows: give ${native.length > 1 ? "each" : "it"} an (after: <png>) still of it (and a (before: <png>)), and say in its words what to open to see it live` : "",
        job && !video ? "no video: a proof is one by default (--record on your own copy of the change, or --video), so the user sees it before it's merged" : "",
        video && video.bytes > 12 << 20 ? `its video is ${Math.round(video.bytes / (1 << 20))} MB: keep a proof short (fewer, shorter steps)` : ""].filter(Boolean).join("; ")
      return { path, steps: tour.steps.length, ...(job ? { job } : {}), ...(video ? { video: video.path, size: video.bytes < 1 << 20 ? `${Math.max(1, Math.round(video.bytes / 1024))} KB` : `${Math.round(video.bytes / 104857.6) / 10} MB`, ...(video.ms ? { seconds: Math.round(video.ms / 1000) } : {}) } : {}), ...(warning ? { warning } : {}) }
    },
    text: (r) => `${r.job ? `Saved ${r.path}${r.home ? ` on its home, ${r.home}` : ""} (${r.steps} steps), the proof of ${r.job}${r.video ? `, with its video ${r.video} (${r.seconds ? `${r.seconds} s, ` : ""}${r.size}: embed it in your report, --video)` : ""}: Show me plays it once the job is ready.` : `Saved ${r.path} (${r.steps} steps): play it with companion tour "${r.path}".`}${r.warning ? ` Warning: ${r.warning}.` : ""}`,
  })
}
