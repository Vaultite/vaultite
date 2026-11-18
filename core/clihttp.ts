// vau's HTTP/1.1 client, on a bare socket: loading node:http takes longer than the rest of a short command's start.
import net from "node:net"

export type Answer = { status: number; type: string; text: string }

function unchunk(body: Buffer): Buffer {
  const parts: Buffer[] = []
  for (let at = 0; at < body.length;) {
    const eol = body.indexOf("\r\n", at)
    if (eol < 0) break
    const size = parseInt(body.subarray(at, eol).toString("latin1"), 16)
    if (!(size > 0)) break
    parts.push(body.subarray(eol + 2, eol + 2 + size))
    at = eol + 2 + size + 2
  }
  return Buffer.concat(parts)
}

export function parseAnswer(raw: Buffer, ended = true): Answer | null {
  let start = 0
  for (;;) {
    const end = raw.indexOf("\r\n\r\n", start)
    if (end < 0) return null
    const lines = raw.subarray(start, end).toString("latin1").split("\r\n")
    const status = Number(/^HTTP\/\d(?:\.\d)? (\d{3})/.exec(lines[0])?.[1] ?? 0)
    const headers = new Map(lines.slice(1).map((l): [string, string] => { const i = l.indexOf(":"); return [l.slice(0, i).trim().toLowerCase(), l.slice(i + 1).trim()] }))
    if (status >= 100 && status < 200) { start = end + 4; continue }
    const body = raw.subarray(end + 4), length = headers.get("content-length")
    if (length !== undefined ? body.length < Number(length) : !ended) return null
    const chunked = /chunked/i.test(headers.get("transfer-encoding") ?? "")
    const text = (chunked ? unchunk(body) : length !== undefined ? body.subarray(0, Number(length)) : body).toString("utf8")
    return { status, type: headers.get("content-type") ?? "", text }
  }
}

export async function request(url: string, method: string, body?: string, extra: Record<string, string> = {}): Promise<Answer> {
  const u = new URL(url)
  const secure = u.protocol === "https:"
  const host = u.hostname.replace(/^\[(.*)\]$/, "$1"), port = Number(u.port) || (secure ? 443 : 80)
  const payload = body === undefined ? null : Buffer.from(body, "utf8")
  const head = [`${method} ${u.pathname}${u.search} HTTP/1.1`, `Host: ${u.host}`, "Connection: close",
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
    ...(payload ? ["Content-Type: application/json", `Content-Length: ${payload.length}`] : method === "GET" ? [] : ["Content-Length: 0"])]
  const socket = secure
    ? (await import("node:tls")).connect({ host, port, servername: net.isIP(host) ? undefined : host, ALPNProtocols: ["http/1.1"] })
    : net.connect({ host, port })
  return await new Promise<Answer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false, got = 0, whole = Infinity, headed = false
    const settle = (ended: boolean) => {
      if (settled) return
      const a = parseAnswer(Buffer.concat(chunks), ended)
      if (a) { settled = true; resolve(a); socket.destroy() }
      else if (ended) { settled = true; reject(Object.assign(new Error(`${u.host} closed the connection before answering`), { code: "ECONNRESET" })) }
    }
    const received = (c: Buffer) => {
      chunks.push(c)
      got += c.length
      if (!headed) {
        const raw = Buffer.concat(chunks), end = raw.indexOf("\r\n\r\n"), head = end < 0 ? "" : raw.subarray(0, end).toString("latin1")
        headed = end >= 0
        const length = /^HTTP\/\S+ [2-5]\d\d/.test(head) ? /\r\ncontent-length:\s*(\d+)/i.exec(head) : null
        if (length) whole = end + 4 + Number(length[1])
      }
      if (got >= whole) settle(false)
    }
    const said = Buffer.from(head.join("\r\n") + "\r\n\r\n", "latin1")
    socket.on(secure ? "secureConnect" : "connect", () => socket.write(payload ? Buffer.concat([said, payload]) : said))
    socket.on("data", received)
    socket.on("end", () => settle(true))
    socket.on("close", () => settle(true))
    socket.on("error", (e) => { if (!settled) { settled = true; reject(e) } })
  })
}
