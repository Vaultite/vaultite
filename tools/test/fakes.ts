import { IncomingMessage, type IncomingHttpHeaders } from "node:http"
import { Socket } from "node:net"

export function request(headers: IncomingHttpHeaders = {}, o: { remote?: string; body?: Buffer[] } = {}): IncomingMessage {
  const socket = new Socket()
  if (o.remote) Object.defineProperty(socket, "remoteAddress", { value: o.remote })
  const req = new IncomingMessage(socket)
  req.headers = headers
  if (o.body) { for (const b of o.body) req.push(b); req.push(null) }
  return req
}

