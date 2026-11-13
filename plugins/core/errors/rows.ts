import { z } from "zod"

const opt = { s: z.string().optional(), n: z.number().optional(), b: z.boolean().optional() }
export const ErrorRow = z.object({ id: z.string().min(1), t: z.number(), source: z.enum(["app", "server"]), kind: z.string(), message: z.string(),
  stack: opt.s, component: opt.s, fatal: opt.b, where: opt.s, url: opt.s, build: opt.s, device: opt.s, trail: z.array(z.string()).optional(), n: opt.n })
