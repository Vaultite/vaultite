// The keys the core reads, typed (core/rules.ts says what's wrong with one); their meaning: web/src/core/define.ts.
import { z } from "zod"

const may = <T extends z.ZodType>(t: T) => t.optional().catch(undefined)

export const Manifest = z.object({
  id: z.string(),
  name: may(z.string()),
  description: may(z.string()),
  version: may(z.string()),
  repo: may(z.string()),
  requires: may(z.array(z.string())),
  ai: may(z.boolean()),
  alwaysOn: may(z.boolean()),
  offByDefault: may(z.boolean()),
  forAgents: may(z.string()),
}).catchall(z.any()) // (plugins read the rest as they always have: their settings' defaults)
export type Manifest = z.infer<typeof Manifest>

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- this is the parse at the boundary
export function manifestOf(raw: unknown, file: string): Manifest {
  const r = Manifest.safeParse(raw)
  if (!r.success) throw new Error(`${file} isn't a plugin's manifest: ${z.prettifyError(r.error)}`)
  return r.data
}
