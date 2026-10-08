// `vau import <export>`: a command, not an op, because the file is on vau's computer and streamed (exports run to
// GBs); it then follows the job. An export already in the vault: the op ai-import.run.
import fs from "node:fs"
import path from "node:path"
import { CliError, done, flag, need, type PluginCli } from "../../../core/cli.ts"

/** The file streamed as a request's body; the answer's JSON. */
async function upload(url: string, file: string, headers: Record<string, string>) {
  const u = new URL(url)
  const { request } = u.protocol === "https:" ? await import("node:https") : await import("node:http")
  const size = fs.statSync(file).size
  return new Promise<{ status: number; body: Record<string, unknown> }>((resolve, reject) => {
    const req = request(u, { method: "POST", headers: { ...headers, "Content-Type": "application/octet-stream", "Content-Length": String(size) } }, (res) => {
      const chunks: Buffer[] = []
      res.on("data", (c: Buffer) => chunks.push(c))
      res.on("error", reject)
      res.on("end", () => {
        let body: Record<string, unknown> = {}
        try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")) } catch { /* not JSON */ }
        resolve({ status: res.statusCode ?? 0, body })
      })
    })
    req.on("error", reject)
    fs.createReadStream(file).on("error", reject).pipe(req)
  })
}

export const cli: PluginCli = {
  commands: [{
    name: "import",
    after: "clip",
    summary: "Import ChatGPT's or Claude's export: a note per chat, and their memories as a list to review.",
    usage: "vau import <export.zip> [--min-messages <n>] [--no-images] [--folder <folder>] [--no-wait]",
    bool: ["no-images", "no-wait"],
    help: `Sends the export's zip (or its conversations.json) to the running server, which imports it as a job: every chat
a note in Chats/ChatGPT/ or Chats/Claude/ (Claude's projects in Chats/Claude/Projects/), small images from ChatGPT in
their Attachments/, and what the AI remembered about you added to Chats/<AI>/Memories to review.md, never straight to
ME.md: tick the ones to keep there and press Add (or vau ai-import.apply <path>). Importing again updates chats that
changed and never makes a second copy. Waits and prints what it did (--no-wait: just starts it). An export already
in the vault: vau ai-import.run <path>.

  ChatGPT: Settings > Data controls > Export data (a link by email to a zip).
  Claude:  Settings > Privacy > Export data (a zip, sometimes named .dms).

  vau import ~/Downloads/chatgpt-export.zip
  vau import ~/Downloads/data-2026-10-01.dms --min-messages 4
  vau import conversations.json --folder Archive/Chats`,
    run: async (a, c) => {
      const file = path.resolve(need(a._[0], "the export (a zip or conversations.json)", "vau import <export.zip>"))
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) throw new CliError(`no file ${file}`)
      const q = new URLSearchParams({ name: path.basename(file) })
      const min = flag(a, "min-messages"), folder = flag(a, "folder")
      if (min) q.set("minMessages", min)
      if (folder) q.set("folder", folder)
      if (a.flags["no-images"]) q.set("images", "false")
      let r: { status: number; body: Record<string, unknown> }
      try {
        r = await upload(`${c.url}/api/ai-import?${q}`, file, { "X-Vaultite-Client": "cli", "X-Vaultite-Command": "import" })
      } catch {
        throw new CliError(c.down())
      }
      if (r.status === 404 && !r.body.error) throw new CliError("the server has no /api/ai-import (an older version? restart it)")
      if (r.status >= 400) throw new CliError(String(r.body.error ?? r.status))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let job = r.body as any
      if (a.flags["no-wait"]) return done(job, `Importing ${job.name} (job ${job.id}): vau ai-import.job ${job.id} --wait follows it.`)
      let last = ""
      while (job.state === "queued" || job.state === "running") {
        await new Promise((ok) => setTimeout(ok, 700))
        job = await c.call("GET", `ai-import/jobs/${job.id}`)
        const line = job.state === "running" ? `${job.chats} chats, ${Math.floor((job.read / Math.max(1, job.total)) * 100)}%` : ""
        if (line && line !== last && process.stderr.isTTY) process.stderr.write(`\r${line}   `)
        last = line
      }
      if (process.stderr.isTTY && last) process.stderr.write("\n")
      if (job.state === "failed") throw new CliError(`couldn't import ${job.name}: ${job.error}`)
      // What it did, as the op says it.
      const text = await c.call("POST", "ops/ai-import.job?as=text", { id: job.id })
      return done(job, String(text).trimEnd())
    },
  }],
}
