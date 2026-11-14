import { z } from "zod"

const Answer = z.looseObject({ result: z.json().optional(), error: z.looseObject({ message: z.string().optional() }).optional() })
const Ready = z.looseObject({ betterbibtex: z.string(), zotero: z.string() })
const Keys = z.record(z.string(), z.string().nullable())
const Notes = z.record(z.string(), z.array(z.looseObject({ note: z.string() })))

async function rpc(base: string, method: string, params: z.infer<typeof Answer>["result"][], timeout = 8000) {
  const r = await fetch(`${base}/better-bibtex/json-rpc`, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method, params }), signal: AbortSignal.timeout(timeout),
  })
  if (!r.ok) throw new Error(`Better BibTeX answered ${r.status}`)
  const a = Answer.parse(await r.json())
  if (a.error) throw new Error(a.error.message ?? "Better BibTeX couldn't")
  return a.result ?? null
}

export async function bbtReady(base: string): Promise<string | null> {
  try {
    const r = Ready.safeParse(await rpc(base, "api.ready", [], 3000))
    return r.success ? r.data.betterbibtex : null
  } catch { return null }
}

export async function bbtCitekeys(base: string, itemKeys: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let i = 0; i < itemKeys.length; i += 200) {
    const r = Keys.safeParse(await rpc(base, "item.citationkey", [itemKeys.slice(i, i + 200)], 20000))
    if (!r.success) continue
    for (const [k, v] of Object.entries(r.data)) if (v) out.set(k.replace(/^\d+:/, ""), v)
  }
  return out
}

export async function bbtNotes(base: string, citekey: string): Promise<string[]> {
  const r = Notes.safeParse(await rpc(base, "item.notes", [[citekey]]))
  return r.success ? (r.data[citekey] ?? []).map((n) => n.note) : []
}

export async function cayw(base: string): Promise<string> {
  const r = await fetch(`${base}/better-bibtex/cayw?format=pandoc&brackets=1`, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!r.ok) throw new Error(`Better BibTeX answered ${r.status}`)
  return (await r.text()).trim()
}
