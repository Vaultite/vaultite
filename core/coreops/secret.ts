// secret.ask: a password or a key file the user gives an agent from whatever device they're on. Shown in a hidden field
// (web/src/components/ConfirmDialog.tsx) on this machine and the others sharing the vault; the first answer wins.
import crypto from "node:crypto"
import { type Machine, MACHINE_CLIENT } from "../plugins.ts"
import { type Op, OpError, type OpCtx } from "../ops.ts"

type Got = { value: string; base64: boolean }
/** One machine's answer: what was given, null when dismissed, or the error (no window there, offline). */
type Try = Promise<Got | null | Error>

const answer = (r: unknown): Got | null => {
  const o = r as { value?: unknown; base64?: unknown } | null
  return typeof o?.value === "string" ? { value: o.value, base64: !!o.base64 } : null
}

/** This machine, and the others sharing its vault that answer (the phone may be on one): none without Machines. */
async function machines(ctx: OpCtx): Promise<{ self: Machine | null; others: Machine[] }> {
  const all = await ctx.api("GET", "machines").catch(() => []) as Machine[]
  const self = all.find((m) => m.self) ?? null
  return { self, others: self?.vault ? all.filter((m) => !m.self && m.online && m.vault === self.vault) : [] }
}

async function remote(m: Machine, body: object, timeout: number): Try {
  try {
    const r = await fetch(`${m.url}/api/ops/secret.ask`, { method: "POST", headers: { ...MACHINE_CLIENT, "Content-Type": "application/json" },
      body: JSON.stringify(body), signal: AbortSignal.timeout((timeout + 15) * 1000) })
    const out = await r.json().catch(() => ({})) as { error?: string; value?: unknown; base64?: unknown }
    return r.ok ? answer(out) : new Error(`${m.label}: ${out.error ?? r.status}`)
  } catch {
    return new Error(`${m.label} doesn't answer`)
  }
}

/** The first answer (a value, or null: dismissed there), or the first error once every machine failed. */
function first(tries: Try[]): Promise<Got | null> {
  const errors: Error[] = []
  return new Promise((done, fail) => {
    for (const t of tries) void t.then((r) => {
      if (!(r instanceof Error)) return done(r)
      errors.push(r)
      if (errors.length === tries.length) fail(errors[0] instanceof OpError ? errors[0] : new OpError(errors[0].message, 409))
    })
  })
}

export function secretOps(): Op[] {
  return [{
    id: "secret.ask",
    cli: "secret",
    mcp: false,
    summary: "Ask the user for a secret (a password, an API key, a key file) in a hidden field on whatever device they're on.",
    help: `Shows a dialog with a hidden field (with file, a file picker) in the window the user was in last, here and on the
other machines sharing the vault (their phone may be on one); the first answer closes the rest. The value comes back
over the tailnet and is printed, nothing else: never written to the vault, the logs or File history. Pipe it where it
goes, so it never lands in a transcript. A binary file comes back as base64. Not an MCP tool: secrets stay on the
user's machines. Dismissed, it fails (exit 1) and prints nothing.

  vau secret "App Store Connect key (.p8)" --file | gh secret set NOTARY_KEY
  vau secret "The studio's Wi-Fi password" | pbcopy`,
    kind: "read",
    params: {
      prompt: { type: "string", description: "what to enter, the dialog's title" },
      file: { type: "boolean", description: "a file to pick (a key, a certificate), not text" },
      timeout: { type: "integer", minimum: 5, maximum: 600, default: 300, description: "seconds to wait for it" },
      key: { type: "string", description: "between machines: the ask this is part of" },
      from: { type: "string", description: "between machines: who asks, shown in the dialog" },
      cancel: { type: "string", description: "between machines: end the ask with this key (given elsewhere)" },
    },
    args: ["prompt"],
    run: async ({ prompt, file, timeout, key, from, cancel }, ctx) => {
      // Not even through MCP's `call`: an AI app (claude.ai, ChatGPT) never gets the user's secrets.
      if (ctx.who.client === "mcp") throw new OpError("not over MCP: secrets stay on the user's machines (vau secret, in a terminal)", 403)
      if (cancel) return ctx.ui({ action: "ask-cancel", key: cancel })
      if (!prompt?.trim()) throw new OpError("prompt is what to enter (the dialog's title)")
      const relayed = !!ctx.who.client?.startsWith("machine/")
      const id: string = key ?? crypto.randomUUID()
      const { self, others } = relayed ? { self: null, others: [] } : await machines(ctx)
      const by: string = from ?? (self ? `${ctx.who.label} on ${self.label}` : ctx.who.label)
      const ask = { action: "secret", key: id, prompt: prompt.trim().slice(0, 200), file: !!file, timeout, from: by }
      const here: Try = ctx.ui(ask).then(answer, (e: unknown) => (e instanceof OpError && e.status === 504 ? null : e as Error))
      const elsewhere = others
      const got = await first([here, ...elsewhere.map((m) => remote(m, { prompt, file: !!file, timeout, key: id, from: by }, timeout))])
        .finally(() => {
          void ctx.ui({ action: "ask-cancel", key: id }).catch(() => {})
          for (const m of elsewhere) void remote(m, { cancel: id }, 5)
        })
      if (got) return got
      if (relayed) return { value: null } // (the asking machine ends it everywhere)
      throw new OpError("the user didn't give it (dismissed, or no answer in time)", 409)
    },
    text: (r: { value?: string }) => r.value ?? "",
    exact: true,
  }]
}
