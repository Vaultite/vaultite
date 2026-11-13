import type { AddressInfo } from "node:net"
import { z } from "zod"

const TcpAddress = z.object({ port: z.number() })

export const portOf = (server: { address(): AddressInfo | string | null }): number => TcpAddress.parse(server.address()).port
