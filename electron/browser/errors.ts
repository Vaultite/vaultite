import { z } from "zod"

const WITH_MESSAGE = z.object({ message: z.string() })
// oxlint-disable-next-line anti-slop/no-unknown-parameters -- what's thrown is anything; this is where it becomes text
export const messageOf = (e: unknown) => (e instanceof z.ZodError ? e.issues[0]?.message ?? e.message : e instanceof Error ? e.message : WITH_MESSAGE.safeParse(e).data?.message ?? String(e))
