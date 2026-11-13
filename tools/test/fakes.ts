import { IncomingMessage, type IncomingHttpHeaders } from "node:http"
import { type Server, Socket } from "node:net"
import { z } from "zod"

export function request(headers: IncomingHttpHeaders = {}, o: { remote?: string; body?: Buffer[] } = {}): IncomingMessage {
  const socket = new Socket()
  if (o.remote) Object.defineProperty(socket, "remoteAddress", { value: o.remote })
  const req = new IncomingMessage(socket)
  req.headers = headers
  if (o.body) { for (const b of o.body) req.push(b); req.push(null) }
  return req
}

export const portOf = (s: Pick<Server, "address">) => z.object({ port: z.number() }).parse(s.address()).port
