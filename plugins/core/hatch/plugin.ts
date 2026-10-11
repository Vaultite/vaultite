// Hatch: what a Hatch agent (a personal AI on its own VM, like one named Muse) keeps in its home folder, read live
// through an agent machine's file agent (Machines) or on this machine (HATCH_HOME): who it is, its runs, what it learned,
// its dreams, its feed and its scheduled jobs. Nothing is written to the vault; what's new reaches the Inbox.
import os from "node:os"
import { ago } from "../../../core/codingagents.ts"
import { bullets as list, HTTPError, Plugin, section } from "../../../core/plugins.ts"
import { bullets, connectors, conversation, cronJob, dailyNote, dreamText, feedFile, frontmatter, type Home, isHatch, localHome, nameOf, pool,
  remoteHome, runOf, type Run, slotOf, unfilled } from "./home.ts"

export const plugin = new Plugin(import.meta.url)

const str = (v: unknown) => (typeof v === "string" ? v : "")
const iso = (ms: number | null | undefined) => (ms ? new Date(ms).toISOString() : "")
const PERSONA = ["IDENTITY.md", "SOUL.md", "USER.md", "MEMORY.md", "PROACTIVE_PREFERENCES.md", "HEARTBEAT.md", "AGENTS.md", "TOOLS.md"]
const DAY = /^\d{4}-\d\d-\d\d\.md$/

type Machine = { id: string; label: string; online: boolean; dial?: boolean; home?: string }
const machines = async () => ((await plugin.ask<Machine[]>("machines", [])) ?? []).filter((m) => m.dial)

/** The file agent's answer, its errors kept (plugin.ask would hide them). */
function agentFs(machine: string) {
  return async (rest: string, q: Record<string, string>) => {
    const fn = plugin.service("machines:fs")
    if (typeof fn !== "function") throw new HTTPError(409, "Turn on Machines to read an agent machine's files")
    return fn(machine, rest, q)
  }
}

/** A home on an agent machine, its root its home folder. */
async function remote(m: Machine): Promise<Home> {
  if (!m.online) throw new HTTPError(502, `${m.label} isn't connected: start its file agent`)
  const ask = agentFs(m.id)
  const root = m.home || str((await ask("fs/list", { path: "~" })).path)
  return remoteHome(m.id, root, ask)
}

/** Which home a block or route reads: `machine`'s, else HATCH_HOME or this machine's home folder when it's Hatch's, else
 *  the first agent machine with one. */
async function homeOf(machine: unknown): Promise<{ home: Home; label: string }> {
  const id = str(machine).trim()
  if (id) {
    const m = (await machines()).find((x) => x.id === id)
    if (!m) throw new HTTPError(404, `No agent machine '${id}' in Machines`)
    return { home: await remote(m), label: m.label }
  }
  const env = process.env.HATCH_HOME?.trim()
  if (env) return { home: localHome(env), label: "" }
  const here = localHome(os.homedir())
  if (isHatch(await here.list(""))) return { home: here, label: "" }
  const found = await plugin.memo(600, async function hatchMachine() {
    for (const m of (await machines()).filter((x) => x.online)) {
      try { const h = await remote(m); if (isHatch(await h.list(""))) return m.id } catch { /* not this one */ }
    }
    return ""
  })
  if (!found) throw new HTTPError(404, "No Hatch agent here or on an agent machine")
  return homeOf(found)
}

// ---------- what's in it (each remembered a minute: an agent machine answers over the internet)

async function identity(h: Home) {
  return nameOf((await h.read("IDENTITY.md"))?.text) || "Hatch"
}

/** Who it is and how it's set up: its persona files (and what's left to fill in them), connectors, jobs, objectives. */
async function overview(h: Home, label: string) {
  const top = (await h.list("")) ?? []
  const files = (await pool(PERSONA.filter((n) => top.some((e) => e.name === n)), 8, async (name) => {
    const f = await h.read(name)
    return f ? { name, text: f.text, modified: iso(f.mtime), unfilled: unfilled(f.text) } : null
  })).filter((f) => !!f)
  const skills = await h.read("config/skills.yaml")
  const cadences = ((await h.list("workspace/cron.d")) ?? []).filter((e) => e.dir && e.name !== "_invalid")
  const jobFiles = (await pool(cadences, 8, async (c) => ((await h.list(`workspace/cron.d/${c.name}`)) ?? [])
    .filter((e) => !e.dir && e.name.endsWith(".md")).map((e) => ({ dir: c.name, name: e.name })))).flat()
  const jobs = (await pool(jobFiles, 8, async (j) => {
    const f = await h.read(`workspace/cron.d/${j.dir}/${j.name}`)
    return f ? cronJob(f.text, j.name, j.dir === "_archive") : null
  })).filter((j) => !!j).sort((a, b) => Number(a.archived) - Number(b.archived) || Number(b.enabled) - Number(a.enabled) || a.id.localeCompare(b.id))
  const objs = ((await h.list("workspace/self_improvement/objectives")) ?? []).filter((e) => e.dir)
  const objectives = (await pool(objs, 8, async (o) => {
    const f = await h.read(`workspace/self_improvement/objectives/${o.name}/CURRENT.md`)
    if (!f) return null
    const { fm } = frontmatter(f.text)
    return { id: o.name, outcome: str(fm.worker_outcome), at: str(fm.created_at) }
  })).filter((o) => !!o)
  const [agents, dreamed, noted] = await Promise.all(["agents", "dreams", "memory"].map((d) => h.list(d)))
  const counts = { runs: (agents ?? []).filter((e) => e.dir && e.name.startsWith("agent-")).length,
    dreams: (dreamed ?? []).filter((e) => DAY.test(e.name)).length, notes: (noted ?? []).filter((e) => DAY.test(e.name)).length }
  return { machine: h.machine, label, home: h.root, name: nameOf(files.find((f) => f.name === "IDENTITY.md")?.text) || "Hatch", files,
    connectors: skills ? connectors(skills.text) : [], jobs, objectives, counts }
}

// A run's summary, kept while its transcript is the same size (one being written grows); without sizes, ten minutes.
const summaries = new Map<string, { key: string; at: number; run: Run }>()

async function runs(h: Home, limit: number) {
  const dirs = ((await h.list("agents")) ?? []).filter((e) => e.dir && e.name.startsWith("agent-"))
  const recent = await h.recent("agents", 400)
  const files = recent
    ? recent.filter((f) => f.path.endsWith(".jsonl")).map((f) => ({ id: f.path.split("/").pop()!.slice(0, -6), size: f.size as number | null, mtime: f.mtime }))
    : dirs.map((d) => ({ id: d.name.slice(6), size: null as number | null, mtime: d.mtime ?? 0 }))
  files.sort((a, b) => b.mtime - a.mtime)
  const list = await pool(files.slice(0, limit), 6, async (f) => {
    const key = `${h.machine}:${f.id}`, stamp = `${f.size}:${f.mtime}`, hit = summaries.get(key)
    if (hit && hit.key === stamp && (f.size !== null || Date.now() - hit.at < 600_000)) return hit.run
    const dir = `agents/agent-${f.id}/sessions`
    const t = await h.read(`${dir}/${f.id}.jsonl`, 8 << 20)
    if (!t) return null
    const run = runOf(f.id, t.text, (await h.read(`${dir}/sessions.json`))?.text ?? null)
    summaries.set(key, { key: stamp, at: Date.now(), run })
    if (summaries.size > 2000) summaries.delete(summaries.keys().next().value!)
    return run
  })
  return { total: dirs.length, runs: list.filter((r) => !!r) }
}

/** What it learned: MEMORY.md, its latest daily notes' facts, and its memory bank. */
async function memory(h: Home, notes: number) {
  const days = ((await h.list("memory")) ?? []).filter((e) => !e.dir && DAY.test(e.name)).map((e) => e.name).sort().reverse()
  const daily = (await pool(days.slice(0, notes), 6, async (name) => {
    const f = await h.read(`memory/${name}`)
    return f ? { date: name.slice(0, 10), modified: iso(f.mtime), ...dailyNote(f.text) } : null
  })).filter((d) => !!d)
  const main = await h.read("MEMORY.md")
  const bank = (await pool(((await h.list("memory/bank")) ?? []).filter((e) => !e.dir && e.name.endsWith(".md")), 6, async (e) => {
    const f = await h.read(`memory/bank/${e.name}`)
    return f ? { name: e.name.slice(0, -3), items: bullets(f.text), modified: iso(f.mtime) } : null
  })).filter((b) => !!b)
  const people = ((await h.list("memory/people")) ?? []).filter((e) => !e.dir && e.name.endsWith(".md") && e.name !== "INDEX.md").length
  return { facts: main ? bullets(main.text) : [], modified: iso(main?.mtime), days: daily, bank, people, notes: days.length }
}

/** Its nightly dreams (newest first) and what it thinks it understands of the user (alignment synthesis). */
async function dreams(h: Home, n: number) {
  const names = ((await h.list("dreams")) ?? []).filter((e) => !e.dir && DAY.test(e.name)).map((e) => e.name).sort().reverse()
  const list = (await pool(names.slice(0, n), 6, async (name) => {
    const f = await h.read(`dreams/${name}`)
    return f ? { date: name.slice(0, 10), text: dreamText(f.text), modified: iso(f.mtime), path: f.path } : null
  })).filter((d) => !!d)
  const s = await h.read("dreams/alignment/derived/ALIGNMENT_SYNTHESIS.md")
  return { dreams: list, total: names.length, synthesis: s ? { text: s.text.replace(/^#\s.*\n+/, "").trim(), modified: iso(s.mtime) } : null }
}

/** Its feed's latest write-ups, each story with its links. */
async function feed(h: Home, n: number) {
  const feeds = ((await h.list("workspace/feed/research")) ?? []).filter((e) => e.dir)
  const slots = (await pool(feeds, 6, async (f) => ((await h.list(`workspace/feed/research/${f.name}`)) ?? [])
    .filter((e) => e.dir && slotOf(e.name)).map((e) => ({ dir: `workspace/feed/research/${f.name}/${e.name}`, name: e.name, mtime: e.mtime ?? 0 })))).flat()
  slots.sort((a, b) => b.name.slice(0, 10).localeCompare(a.name.slice(0, 10)) || b.mtime - a.mtime)
  const stories: { title: string; text: string; links: { url: string; note: string }[]; beat: string; date: string; part: string; path: string }[] = []
  for (const s of slots) {
    if (stories.length >= n) break
    const files = ((await h.list(s.dir)) ?? []).filter((e) => !e.dir && e.name.endsWith(".md"))
    for (const file of files) {
      const f = await h.read(`${s.dir}/${file.name}`)
      if (!f) continue
      const parsed = feedFile(f.text), slot = slotOf(s.name)!
      for (const st of parsed.stories) stories.push({ ...st, beat: parsed.beat || file.name.slice(0, -3), ...slot, path: f.path })
    }
  }
  return { stories: stories.slice(0, n), slots: slots.length }
}

async function session(h: Home, id: string, limit: number) {
  if (!/^[\w-]{8,80}$/.test(id)) throw new HTTPError(400, "a run's id")
  const dir = `agents/agent-${id}/sessions`
  const t = await h.read(`${dir}/${id}.jsonl`, 8 << 20)
  if (!t) throw new HTTPError(404, "No such run")
  const run = runOf(id, t.text, (await h.read(`${dir}/sessions.json`))?.text ?? null)
  const entries = conversation(t.text), start = Math.max(0, entries.length - limit)
  return { id: h.machine ? `${h.machine}:${id}` : id, speaker: await identity(h), title: `${run.kind}: ${run.title}`, project: run.kind, cwd: "", model: run.model, first: run.first,
    last: run.last, branch: "", start, total: entries.length, entries: entries.slice(start) }
}

const memo = <T>(ttl: number, name: string, fn: (h: Home, label: string) => Promise<T>) => async (machine: unknown, ...key: unknown[]) => {
  const { home, label } = await homeOf(machine)
  return plugin.memo(ttl, ({ [name]: async (_m: string, _k: string) => fn(home, label) })[name], `${home.machine}:${home.root}`, JSON.stringify(key))
}
const num = (v: unknown, d: number, max: number) => {
  const n = v === undefined || v === null || v === "" ? NaN : Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.floor(n))) : d
}
const getOverview = memo(120, "overview", overview)
const getRuns = (machine: unknown, limit: number) => memo(60, "runs", (h) => runs(h, limit))(machine, limit)
const getMemory = (machine: unknown, notes: number) => memo(120, "memory", (h) => memory(h, notes))(machine, notes)
const getDreams = (machine: unknown, n: number) => memo(300, "dreams", (h) => dreams(h, n))(machine, n)
const getFeed = (machine: unknown, n: number) => memo(300, "feed", (h) => feed(h, n))(machine, n)

// ---------- routes: only this machine's owner (an agent's memory is about them)

async function owner(req: { http?: import("node:http").IncomingMessage }) {
  const why = req.http ? await plugin.refusal(req.http, "Reading a Hatch agent's files") : ""
  if (why) throw new HTTPError(403, why)
}
plugin.route("GET", "hatch", async (req) => { await owner(req); return getOverview(req.query.machine) }, { lock: false })
plugin.route("GET", "hatch/runs", async (req) => { await owner(req); return getRuns(req.query.machine, num(req.query.limit, 10, 100)) }, { lock: false })
plugin.route("GET", "hatch/memory", async (req) => { await owner(req); return getMemory(req.query.machine, num(req.query.notes, 3, 30)) }, { lock: false })
plugin.route("GET", "hatch/dreams", async (req) => { await owner(req); return getDreams(req.query.machine, num(req.query.dreams, 2, 30)) }, { lock: false })
plugin.route("GET", "hatch/feed", async (req) => { await owner(req); return getFeed(req.query.machine, num(req.query.stories, 6, 50)) }, { lock: false })
/** A run read back: `<machine>:<run id>` (or the run id, this machine's). */
plugin.route("GET", "hatch/session/*", async (req) => {
  await owner(req)
  const full = req.arg(0), at = full.lastIndexOf(":")
  const { home } = await homeOf(at < 0 ? "" : full.slice(0, at))
  return session(home, at < 0 ? full : full.slice(at + 1), num(req.query.limit, 150, 5000))
}, { lock: false })

// ---------- blocks as text (GET /api/render)

const named = async (machine: unknown) => { const { home } = await homeOf(machine); return plugin.memo(600, identity, home) }
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`

plugin.block("hatch", async (ctx) => {
  const o = await getOverview(ctx.options.machine)
  const todo = o.files.filter((f) => f.unfilled.length).map((f) => `${f.name}: ${f.unfilled.join(", ")}`)
  return section(o.name, `Hatch agent${o.label ? ` on ${o.label}` : ""} (${o.home}).`,
    list(o.files.map((f) => `${f.name}, changed ${ago(f.modified)}`)), todo.length ? `Left to fill in:\n\n${list(todo)}` : "")
})

plugin.block("hatch-runs", async (ctx) => {
  const [name, r] = await Promise.all([named(ctx.options.machine), getRuns(ctx.options.machine, num(ctx.options.recent, 10, 100))])
  return section(`${name}'s runs`, list(r.runs.map((x) => `${x.kind}: ${x.title} (${ago(x.last || x.first)}, ${plural(x.tools, "tool call")}${x.model ? `, ${x.model}` : ""})`), "No runs yet."),
    `${plural(r.total, "run")} in all.`)
})

plugin.block("hatch-memory", async (ctx) => {
  const [name, m] = await Promise.all([named(ctx.options.machine), getMemory(ctx.options.machine, num(ctx.options.notes, 3, 30))])
  return section(`What ${name} knows`, m.facts.length ? `### MEMORY.md\n\n${list(m.facts)}` : "_MEMORY.md has nothing yet._",
    ...m.days.map((d) => `### ${d.date}\n\n${list([...d.facts.map((f) => `${f.text} (${f.kind}, ${f.confidence})`), ...d.notes], "Nothing noted.")}`))
})

plugin.block("hatch-dreams", async (ctx) => {
  const [name, d] = await Promise.all([named(ctx.options.machine), getDreams(ctx.options.machine, num(ctx.options.dreams, 2, 30))])
  return section(`${name}'s dreams`, ...d.dreams.map((x) => `### ${x.date}\n\n${x.text}`), d.dreams.length ? "" : "_No dreams yet._",
    d.synthesis ? `### What it understands of you\n\n${d.synthesis.text}` : "")
})

plugin.block("hatch-feed", async (ctx) => {
  const [name, f] = await Promise.all([named(ctx.options.machine), getFeed(ctx.options.machine, num(ctx.options.stories, 6, 50))])
  return section(`${name}'s feed`, ...f.stories.map((s) => `### ${s.title}\n\n${s.date}, ${s.part}, ${s.beat}. ${s.text}\n\n${list(s.links.map((l) => l.url))}`),
    f.stories.length ? "" : "_Nothing in its feed yet._")
})

plugin.block("hatch-setup", async (ctx) => {
  const o = await getOverview(ctx.options.machine)
  const on = o.connectors.filter((c) => c.status === "connected").map((c) => c.name)
  return section(`How ${o.name} is set up`,
    `### Scheduled jobs\n\n${list(o.jobs.map((j) => `${j.id}: ${j.schedule}${j.archived ? ", archived" : j.enabled ? "" : ", off"}${j.task ? `: "${j.task}"` : ""}`), "None.")}`,
    `### Connectors\n\n${on.length ? `Connected: ${on.join(", ")}. ` : "None connected. "}${plural(o.connectors.length - on.length, "more")} available.`,
    `### Objectives\n\n${list(o.objectives.map((x) => `${x.id}: ${x.outcome || "not run"}${x.at ? ` (${ago(x.at)})` : ""}`), "None.")}`)
})

// ---------- what's new, to the Inbox: a dream, what it learned today, a feed story (once each, per agent machine)

type Seen = Record<string, { dream?: string; facts?: string; story?: string }>

async function news() {
  if (plugin.settings({}).inbox === false) return
  const seen = ((plugin.readCache({}) ?? {}).seen ?? {}) as Seen
  let changed = false
  for (const m of (await machines()).filter((x) => x.online)) {
    let home: Home
    try { home = await remote(m); if (!isHatch(await home.list(""))) continue } catch { continue }
    const name = await identity(home), was = seen[m.id], now = { ...was }
    const [d, mem, f] = await Promise.all([dreams(home, 1), memory(home, 1), feed(home, 1)])
    const dream = d.dreams[0], day = mem.days[0], story = f.stories[0]
    now.dream = dream?.date ?? ""
    now.facts = day ? `${day.date}:${day.facts.length}` : ""
    now.story = story ? `${story.date}:${story.title}` : ""
    const file = (p: string) => `view:machine-files/${m.id}|${p.slice(0, p.lastIndexOf("/"))}|${p}`
    // (the first look only notes where things are: nothing old is announced)
    if (was) {
      if (dream && now.dream !== was.dream) await event(m.id, `dream-${dream.date}`, `${name} dreamt`, dream.text, file(dream.path))
      if (day?.facts.length && now.facts !== was.facts) {
        await event(m.id, `facts-${day.date}`, `${name} learned ${plural(day.facts.length, "thing")} on ${day.date}`, day.facts.map((x) => `- ${x.text}`).join("\n"),
          file(`${home.root}/memory/${day.date}.md`))
      }
      if (story && now.story !== was.story) await event(m.id, `feed-${story.date}-${story.part}`, `${name}'s feed: ${story.title}`, story.text, story.links[0]?.url ?? file(story.path))
    }
    if (JSON.stringify(now) !== JSON.stringify(was)) { seen[m.id] = now; changed = true }
  }
  if (changed) plugin.writeCache({ seen })
}
const event = (machine: string, key: string, title: string, body: string, link: string) =>
  plugin.ask("inbox:event", null, { source: "hatch", kind: "info", title, body: body.slice(0, 4000), link, key: `${machine}-${key}`.slice(0, 60) })

plugin.every("news", { every: "30m" }, news)
plugin.exports.news = news
