// The service "sample": one answer from `claude -p` in the default account, with no tools, MCP servers, settings or
// session kept, in an empty folder (so nothing of the user's projects is read). An artifact's claude.sample runs on it.
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { findBin, HOME, type SampleAnswer, type SampleAsk } from "../../../core/agents.ts"

export const SAMPLE_DIR = path.join(os.tmpdir(), "vaultite-claude-sample")
const TIERS = { quick: "haiku", default: "sonnet", complex: "opus" } as const

const coded = (code: string, message: string, text?: string) => Object.assign(new Error(message), { code, ...(text ? { text } : {}) })

/** Why a failed run failed, as a claude.sample code. */
function codeOf(message: string, status: unknown) {
  if (status === 429 || /rate.?limit|usage limit|limit reached/i.test(message)) return "rate_limited"
  if (status === 401 || /log ?in|auth|credential/i.test(message)) return "session_expired"
  if (status === 413 || /too long|too large/i.test(message)) return "prompt_too_large"
  return "upstream_error"
}

function run(bin: string, a: SampleAsk, model: string, dir: string): Promise<SampleAnswer & { failed?: { message: string; status: unknown } }> {
  const args = ["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--no-session-persistence",
    "--strict-mcp-config", "--tools", "", "--setting-sources", "", "--disable-slash-commands", "--system-prompt", a.system, "--model", model]
  if (a.effort && ["low", "medium", "high"].includes(a.effort)) args.push("--effort", a.effort)
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: [path.dirname(bin), process.env.PATH].filter(Boolean).join(":") }
  if (dir === path.join(HOME, ".claude")) delete env.CLAUDE_CONFIG_DIR
  else env.CLAUDE_CONFIG_DIR = dir
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: SAMPLE_DIR, stdio: ["pipe", "pipe", "ignore"], env })
    let buf = "", text = "", over = false, result: Record<string, unknown> | null = null
    const finish = (f: () => void) => { if (over) return; over = true; a.signal?.removeEventListener("abort", stop); f() }
    const stop = () => { child.kill(); finish(() => reject(coded("cancelled", "the call was cancelled", text))) }
    if (a.signal?.aborted) return stop()
    a.signal?.addEventListener("abort", stop)
    child.on("error", (e) => finish(() => reject(coded("upstream_error", `couldn't run Claude Code: ${e.message}`))))
    child.stdout.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf8")
      for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
        const line = buf.slice(0, nl)
        buf = buf.slice(nl + 1)
        let m: Record<string, any>
        try { m = JSON.parse(line) } catch { continue }
        const d = m?.type === "stream_event" && m.event?.type === "content_block_delta" ? m.event.delta : null
        if (d?.type === "text_delta" && typeof d.text === "string" && d.text && !over) {
          text += d.text
          a.onText?.(d.text)
        } else if (m?.type === "result") result = m
      }
    })
    child.on("exit", () => finish(() => {
      if (!result) return reject(coded("upstream_error", "Claude Code ended without an answer", text))
      if (result.is_error) {
        const message = String(result.result ?? "Claude Code failed")
        return text ? reject(coded(codeOf(message, result.api_error_status), message, text)) : resolve({ text: "", truncated: false, failed: { message, status: result.api_error_status } })
      }
      const whole = text || String(result.result ?? "")
      if (!text && whole) a.onText?.(whole)
      resolve({ text: whole, truncated: result.stop_reason === "max_tokens" })
    }))
    child.stdin.end(a.prompt)
  })
}

/** One answer: the named model when it can (else the tier's, as claude.ai falls back), streamed through onText. */
export async function sample(a: SampleAsk, dir: string): Promise<SampleAnswer> {
  const bin = findBin("claude")
  if (!bin) throw coded("sampling_disabled", "Claude Code isn't installed on the machine Vaultite runs on")
  fs.mkdirSync(SAMPLE_DIR, { recursive: true })
  const tier = TIERS[a.tier] ?? TIERS.default
  if (a.model && /^claude-[a-z0-9.-]+$/i.test(a.model)) {
    const r = await run(bin, a, a.model, dir)
    if (!r.failed) return r.text.trim() ? { ...r, model: a.model } : Promise.reject(coded("empty_completion", "Claude wrote nothing"))
  }
  const r = await run(bin, a, tier, dir)
  if (r.failed) throw coded(codeOf(r.failed.message, r.failed.status), r.failed.message)
  if (!r.text.trim()) throw coded("empty_completion", "Claude wrote nothing")
  return { text: r.text, truncated: r.truncated }
}
