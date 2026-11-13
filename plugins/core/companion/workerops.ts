import fs from "node:fs"
import path from "node:path"
import { type Machine, OpError, type Plugin } from "../../../core/plugins.ts"
import { marksIn } from "./jobgit.ts"
import { str } from "./jobs.ts"
import type { Machines } from "./jobmachines.ts"
import { type jobPlaces, Placed } from "./jobplace.ts"
import type { Read, workerLinks } from "./links.ts"
import type { Seen } from "./workers.ts"
import { dropTree, tilde } from "./where.ts"

const PICTURE_MAX = 40 << 20, PROOF_MAX = 200 << 20, PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function workerOps(plugin: Plugin, o: { places: ReturnType<typeof jobPlaces>; machines: Machines; links: ReturnType<typeof workerLinks>; seenHere: (id: string, r?: Read) => Promise<Seen> }) {
  const { placeHere } = o.places, { labelOf, capacity } = o.machines, { links, seenHere } = o, atMachine = links.atMachine
  plugin.op({
    id: "companion.where",
    cli: "companion where",
    owner: "the companion's jobs",
    summary: "Where a job asked over a page, an app's window or a note would run on this machine: the folder, its repo, why (another machine's companion asks it too).",
    help: `Where a repo is on each machine, read there (each keeps its repos in its own folders): say what it answers, never
a guess from a look at one machine's folders.

  vau companion where --url http://localhost:5173
  vau companion where --url https://github.com/lighthouse/site
  vau companion where --repo site --machine studio`,
    kind: "read",
    params: { url: { type: "string", description: "the page's address" }, app: { type: "string", description: "the app (its bundle id)" }, title: { type: "string", description: "its window's title" },
      path: { type: "string", description: "a note's path" }, cwd: { type: "string", description: "a folder, as given (another machine's path to a repo finds this one's own checkout of it)" },
      repo: { type: "string", description: "a repo, by GitHub's owner/name or its folder's name (vaultite): this machine's own checkout of it" },
      machine: { type: "string", description: "ask that machine instead (its id, as Machines lists them)" } },
    run: async (p) => {
      const machine = str(p.machine).trim(), self = machine ? (await plugin.ask<Machine | null>("machines:machine", null, machine))?.self : true
      const { machine: _, ...rest } = p
      const r = self ? await placeHere({ url: str(p.url) || undefined, app: str(p.app) || undefined, title: str(p.title) || undefined, path: str(p.path) || undefined }, str(p.cwd), str(p.repo))
        : Placed.parse(await atMachine(machine, "companion.where", rest, 8))
      return { ...r, label: await labelOf(self ? "" : machine) }
    },
    text: (r) => r.missing ? `On ${r.label}: ${r.why} (looked in ${r.looked ?? "its project folders"}). Its checkouts: ${r.have || "none"}.`
      : `On ${r.label}: ${tilde(r.cwd)}${r.repo ? ` (${r.repo})` : ""}: ${r.why}${r.refused ? `. Refused: ${r.refused}` : ""}`,
  })

  plugin.op({
    id: "companion.worker",
    cli: "companion worker",
    owner: "the companion's jobs",
    summary: "A job's worker terminal on this machine as Vaultite reads it: running, its state and title; turn: its last turn, and the diff since base in cwd.",
    kind: "read",
    params: { id: { type: "string", required: true, description: "its terminal's id" }, turn: { type: "boolean", description: "its last turn and the diff too" },
      session: { type: "string", description: "its agent's session (its turn read from it, the terminal ended or not)" },
      cwd: { type: "string", description: "its folder (the diff's)" }, base: { type: "string", description: "the commit the diff counts from" },
      tree: { type: "string", description: "its own worktree: the diff's once it exists" }, branch: { type: "string", description: "its own branch (whether it's on main)" },
      said: { type: "string", description: "its words (whether a commit they name is on main)" }, context: { type: "boolean", description: "how full its agent's context is too" },
      marks: { type: "object", description: "its change's marks read before ({whole, each}: patch-ids), for once its branch is gone" } },
    args: ["id"],
    run: async (p) => seenHere(str(p.id), { turn: p.turn === true, session: str(p.session), cwd: str(p.cwd), base: str(p.base), tree: str(p.tree), branch: str(p.branch), said: str(p.said), context: p.context === true,
      ...(marksIn(p.marks) ? { marks: marksIn(p.marks)! } : {}) }),
  })

  plugin.op({
    id: "companion.worktree-drop",
    owner: "the companion's jobs",
    summary: "Remove a closed job's worktree on this machine (another machine's companion, its home, asks), and its branch once on the checkout's upstream; kept, saying why, while it has changes or commits no remote has.",
    kind: "write",
    lock: false,
    params: { cwd: { type: "string", required: true, description: "the checkout it's beside" }, tree: { type: "string", required: true, description: "the job's worktree" },
      branch: { type: "string", description: "its branch" } },
    run: async (p) => ({ why: await dropTree(str(p.cwd), str(p.tree), str(p.branch)) }),
  })

  plugin.op({
    id: "companion.worker-start",
    owner: "the companion's jobs",
    summary: "Start a job's worker in a terminal on this machine for another machine's companion, its home: its vau tells the user through home (VAULTITE_HOME), and this machine counts it among its jobs.",
    kind: "write",
    lock: false,
    params: { agent: { type: "string", required: true, description: "its agent (claude, codex; claude_personal: in that account)" },
      cwd: { type: "string", required: true, description: "its folder here" }, name: { type: "string", required: true, description: "its name (the job's title)" },
      prompt: { type: "string", description: "its first words: the task" }, session: { type: "string", description: "its conversation to resume instead" },
      model: { type: "string", description: "its model" }, effort: { type: "string", description: "its effort" }, mode: { type: "string", description: "its permission mode" },
      home: { type: "object", description: "its home ({url, as}: the server that handed it, and this machine's id there)" } },
    run: async (p, ctx) => {
      const h: unknown = p.home
      const home = h instanceof Object && "url" in h && "as" in h && typeof h.url === "string" && typeof h.as === "string" ? { url: h.url, as: h.as } : undefined
      return { id: await links.startHere(ctx, { agent: str(p.agent), cwd: str(p.cwd), name: str(p.name), ...(str(p.prompt) ? { prompt: str(p.prompt) } : {}), ...(str(p.session) ? { session: str(p.session) } : {}),
        ...(str(p.model) ? { model: str(p.model) } : {}), ...(str(p.effort) ? { effort: str(p.effort) } : {}), ...(str(p.mode) ? { mode: str(p.mode) } : {}) }, home) }
    },
  })

  plugin.op({
    id: "companion.capacity",
    cli: "companion capacity",
    owner: "the companion's jobs",
    summary: "What this machine says of its jobs, where they're placed: the workers it runs now and how many it takes (the setting jobs_cap), the repos it has checked out, the agents it runs and their accounts.",
    kind: "read",
    run: () => capacity(),
    text: (r) => `${r.jobs} of ${r.cap} jobs running. Agents: ${r.agents.join(", ") || "none"}${r.accounts ? ` (accounts: ${r.accounts.join(", ")})` : ""}. Repos: ${r.repos.join(", ") || "none"}.`,
  })

  plugin.op({
    id: "companion.job-file",
    owner: "the companion's jobs",
    summary: "Keep a file a job's worker on another machine sends for its proof (a video, a picture) on this machine, its home: answers its path here.",
    kind: "write",
    lock: false,
    input: "the file",
    params: { job: { type: "string", required: true, description: "the job's id" }, name: { type: "string", required: true, description: "its file name (demo.mp4, before 1.png)" } },
    run: async (p, ctx) => {
      const job = str(p.job), name = path.basename(str(p.name))
      if (!/^[\w-]{1,40}$/.test(job)) throw new OpError(`job: a job's id, not ${job}`)
      if (!/\.(mp4|m4v|mov|webm|png|jpe?g|gif|webp|heic)$/i.test(name)) throw new OpError(`'${name}' isn't a video or a picture`)
      if (!ctx.input) throw new OpError("send the file's bytes as the request's body")
      const root = path.join(plugin.localDir(), "job-files"), dir = path.join(root, job)
      fs.mkdirSync(dir, { recursive: true })
      for (const d of fs.readdirSync(root)) { try { if (Date.now() - fs.statSync(path.join(root, d)).mtimeMs > 86_400_000) fs.rmSync(path.join(root, d), { recursive: true }) } catch { /* gone */ } }
      const to = path.join(dir, name), chunks: Buffer[] = []
      let n = 0
      for await (const c of ctx.input) { n += c.length; if (n > PROOF_MAX) throw new OpError("the file is too large", 413); chunks.push(c) }
      fs.writeFileSync(to, Buffer.concat(chunks))
      return { path: to }
    },
  })

  plugin.op({
    id: "companion.picture-take",
    owner: "the companion's jobs",
    summary: "Keep a picture of the user's screen on this machine for a job here (another machine's companion hands an ask's pictures on this way): answers its path.",
    kind: "write",
    lock: false,
    input: "the picture (PNG)",
    params: { name: { type: "string", required: true, description: "its file name, as the helper named it (display-746-1794124886020.png)" } },
    run: async (p, ctx) => {
      const name = str(p.name)
      if (!/^(?:window|display|close)-\d+-\d+\.png$/.test(name)) throw new OpError(`'${name}' isn't a picture of the screen's name (display-<n>-<n>.png)`)
      if (!ctx.input) throw new OpError("send the picture's bytes as the request's body")
      const chunks: Buffer[] = []
      let n = 0
      for await (const c of ctx.input) { n += c.length; if (n > PICTURE_MAX) throw new OpError("the picture is too large", 413); chunks.push(c) }
      const bytes = Buffer.concat(chunks)
      if (!bytes.subarray(0, 8).equals(PNG)) throw new OpError("that isn't a PNG")
      const dir = path.join(plugin.localDir(), "screens")
      fs.mkdirSync(dir, { recursive: true })
      for (const f of fs.readdirSync(dir)) { try { if (Date.now() - fs.statSync(path.join(dir, f)).mtimeMs > 86_400_000) fs.rmSync(path.join(dir, f)) } catch { /* gone */ } }
      fs.writeFileSync(path.join(dir, name), bytes)
      return { path: path.join(dir, name) }
    },
  })
}
