import { z } from "zod"

const Target = z.object({ type: z.string(), url: z.string(), webSocketDebuggerUrl: z.string().optional() })
const Reply = z.object({
  id: z.number(),
  error: z.unknown().optional(),
  result: z.object({ result: z.object({ value: z.unknown().optional() }).optional(), exceptionDetails: z.unknown().optional() }).optional(),
})
export type Target = z.infer<typeof Target>

export async function targets(port: number): Promise<Target[]> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(1000) })
    return z.array(Target).parse(await r.json())
  } catch { return [] }
}

export class Page {
  private id = 0
  private waiting = new Map<number, (v: z.infer<typeof Reply>) => void>()
  private ws: WebSocket
  readonly url: string
  private constructor(ws: WebSocket, url: string) {
    this.ws = ws
    this.url = url
    ws.onmessage = (m) => {
      const d = Reply.safeParse(JSON.parse(String(m.data)))
      if (d.success) { this.waiting.get(d.data.id)?.(d.data); this.waiting.delete(d.data.id) }
    }
  }

  static async open(t: Target) {
    if (!t.webSocketDebuggerUrl) throw new Error(`no debugger address for ${t.url}`)
    const ws = new WebSocket(t.webSocketDebuggerUrl)
    await new Promise((ok, fail) => { ws.onopen = ok; ws.onerror = fail })
    return new Page(ws, t.url)
  }

  private send(method: "Runtime.evaluate" | "Page.close", params: Record<string, string | boolean>) {
    return new Promise<z.infer<typeof Reply>>((ok) => {
      const id = ++this.id
      this.waiting.set(id, ok)
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async value<T>(schema: z.ZodType<T>, expression: string): Promise<T> {
    const d = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })
    if (d.error || d.result?.exceptionDetails) throw new Error(JSON.stringify(d.error ?? d.result?.exceptionDetails).slice(0, 300))
    return schema.parse(d.result?.result?.value)
  }

  run(expression: string) { return this.value(z.unknown(), expression) }

  async close() { void this.send("Page.close", {}); await new Promise((r) => setTimeout(r, 200)); this.ws.close() }
}
