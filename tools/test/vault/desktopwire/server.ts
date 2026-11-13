// A home vault's server for the helper: ops answered from `answers`, its companion socket kept in `said`.
import http from "node:http"
import { type WebSocket, WebSocketServer } from "ws"
import { z } from "zod"

const NAMED = z.object({ name: z.string() }).catch({ name: "" })
const BOUND = z.object({ port: z.number() })
export async function homeServer() {
  const answers = new Map<string, string>(), asked: string[] = [], said: string[] = []
  let sock: WebSocket | null = null, sockets = 0
  const srv = http.createServer((req, res) => {
    let body = ""
    req.on("data", (d: Buffer) => { body += String(d) })
    req.on("end", () => {
      const op = (req.url ?? "").replace("/api/ops/", ""), json = (() => { try { return JSON.parse(body) } catch { return null } })()
      const key = op === "settings.get" ? `${op} ${NAMED.parse(json).name}` : op
      asked.push(key)
      res.setHeader("content-type", "application/json")
      res.end(answers.get(key) ?? "{}")
    })
  })
  const wss = new WebSocketServer({ noServer: true })
  srv.on("upgrade", (req, s, head) => wss.handleUpgrade(req, s, head, (ws) => { sock = ws; sockets++; ws.on("message", (d) => said.push(String(d))) }))
  await new Promise<void>((done) => srv.listen(0, "127.0.0.1", done))
  const { port } = BOUND.parse(srv.address())
  return {
    port, answers, asked, said,
    sockets: () => sockets,
    send: (m: string) => sock?.send(m),
    drop: () => sock?.terminate(),
    close: () => { wss.close(); srv.close() },
  }
}
