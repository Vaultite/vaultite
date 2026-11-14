// Node 26's fetch speaks HTTP/2 wherever offered, and a request aborted while its body waits on the peer leaves nghttp2
// sending empty frames forever in one native loop: the server dead, its memory growing (tools/test_hang.ts repeats it).
const UNDICI_GLOBAL_DISPATCHER = Symbol.for("undici.globalDispatcher.2")
type UndiciAgent = { constructor: new (o: { allowH2: boolean }) => UndiciAgent }
type WithUndici = { fetch: typeof fetch; [UNDICI_GLOBAL_DISPATCHER]?: UndiciAgent }

export async function fetchOverHttp1(): Promise<"http1" | "dispatcher moved"> {
  const g: WithUndici = globalThis
  if (!g[UNDICI_GLOBAL_DISPATCHER]) await fetch("data:,").then((r) => r.arrayBuffer()).catch(() => null)
  const Agent = g[UNDICI_GLOBAL_DISPATCHER]?.constructor
  if (!Agent) return "dispatcher moved"
  g[UNDICI_GLOBAL_DISPATCHER] = new Agent({ allowH2: false })
  return "http1"
}
