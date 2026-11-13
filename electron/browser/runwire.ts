import { z } from "zod"

/** What a run's file has said so far: read up to `size`, a step per line starting at `starts[i]`. */
export type Scan = {
  size: number; mtime: number; starts: number[]; times: number[]; fails: number[]; shots: string[]; hosts: Map<string, number>
  by: string; task: string; summary: string; title: string; url: string
}
export const fresh = (): Scan => ({ size: 0, mtime: 0, starts: [], times: [], fails: [], shots: [], hosts: new Map(), by: "", task: "", summary: "", title: "", url: "" })
const hostOf = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, "") } catch { return "" } }
export const SHOT = /^\d+\.jpg$/

const TEXT = z.string().optional().catch(undefined)
const LINE = z.preprocess((x) => (x && typeof x === "object" && !Array.isArray(x)) || x === null ? x : {}, z.looseObject({}))
const STEP = z.object({ t: z.unknown().optional().transform((t) => Number(t) || 0), failed: TEXT, shot: TEXT, url: TEXT.transform((u) => u ?? ""),
  by: TEXT, task: TEXT, summary: TEXT, title: TEXT })
const lineOf = (l: string) => { try { const x = LINE.safeParse(JSON.parse(l)); return x.success ? x.data : null } catch { return null } }

export function scanLine(s: Scan, line: string, start: number) {
  const x = lineOf(line)
  if (!x) return
  const { t, failed, shot, url, by, task, summary, title } = STEP.parse(x)
  s.starts.push(start)
  s.times.push(t)
  if (failed !== undefined) s.fails.push(t)
  if (shot !== undefined && SHOT.test(shot)) s.shots.push(shot)
  const host = hostOf(url)
  if (host) s.hosts.set(host, (s.hosts.get(host) ?? 0) + 1)
  if (!s.by && by !== undefined) s.by = by
  if (task) s.task = task
  if (summary) s.summary = summary
  if (title) s.title = title
  if (url) s.url = url
}

export function stepOf(l: string) {
  const x = lineOf(l)
  return x ? [{ ...x, shot: typeof x.shot === "string" && SHOT.test(x.shot) ? x.shot : null }] : []
}
