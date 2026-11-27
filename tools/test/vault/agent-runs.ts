import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { VaultTest } from "./harness.ts"

const same = (pairs: [got: {} | null | undefined, want: {} | null | undefined][]) => pairs.every(([got, want]) => JSON.stringify(got) === JSON.stringify(want))

export default async ({ check }: VaultTest) => {
  const R = await import("../../../electron/browser/runstore.ts")
  const a = R.frameHash(Buffer.from([1, 2, 3])), b = R.frameHash(Buffer.from([1, 2, 4]))
  const was = [R.repeatOf(1, "r", a)]
  R.keptFrame(1, "r", a, "10.jpg")
  was.push(R.repeatOf(1, "r", a), R.repeatOf(1, "r", b), R.repeatOf(2, "r", a), R.repeatOf(1, "s", a))
  R.keptFrame(1, "r", b, "11.jpg")
  was.push(R.repeatOf(1, "r", a), R.repeatOf(1, "r", b))
  for (let i = 0; i < 4; i++) R.keptFrame(1, "r", String(i), `${20 + i}.jpg`)
  was.push(R.repeatOf(1, "r", a), R.repeatOf(1, "r", "0"))
  R.keptFrame(1, "s", b, "30.jpg")
  was.push(R.repeatOf(1, "s", "1"), R.repeatOf(1, "s", b))
  R.forgetFrames(1)
  was.push(R.repeatOf(1, "s", b))
  check("agent runs: a step that sees its tab's page as in one of the run's last four pictures names that picture, nothing else does", same([
    [was, [null, "10.jpg", null, null, null, "10.jpg", "11.jpg", null, "20.jpg", null, "30.jpg", null]], [a === R.frameHash(Buffer.from([1, 2, 3])), true],
  ]))

  const t0 = 1_000_000, at = (tab: number, run: string, action: string, page: string, ms: number) => R.looksNow(tab, run, action, page, t0 + ms)
  const looks = [at(3, "r", "evaluate", "1 a T", 0), at(3, "r", "evaluate", "1 a T", 3000), at(3, "r", "snapshot", "1 a T", 59_000), at(3, "r", "read", "1 a T", 3000),
    at(3, "r", "pdf", "1 a T", 3000), at(3, "r", "click", "1 a T", 3000), at(3, "r", "evaluate", "1 a T", 4000), at(3, "r", "evaluate", "1 a (1) T", 4000),
    at(3, "r", "evaluate", "1 a (1) T", 5000), at(3, "r", "evaluate", "1 b T", 5000), at(3, "r", "evaluate", "2 b T", 5000), at(3, "r", "evaluate", "2 b T", 64_999),
    at(3, "r", "evaluate", "2 b T", 65_000), at(3, "s", "evaluate", "2 b T", 65_001), at(4, "r", "evaluate", "2 b T", 65_001)]
  check("agent runs: a read-only step pictures its page only when its document, address or title changed since the run's last look at the tab, or a minute on; one that acts always does", same([
    [looks, [true, false, false, false, false, true, false, true, false, true, true, false, true, true, true]],
  ]), looks)
  at(5, "r", "evaluate", "p", 0)
  R.keptFrame(5, "r", a, "40.jpg")
  const kept = [at(5, "r", "evaluate", "p", 1000), R.repeatOf(5, "r", a), at(5, "r", "press", "p", 1000), R.repeatOf(5, "r", a)]
  R.forgetFrames(5)
  kept.push(at(5, "r", "evaluate", "p", 1000))
  check("agent runs: a tab's last look and its recent pictures are kept together, and forgotten with the tab", same([[kept, [false, "40.jpg", true, "40.jpg", true]]]), kept)

  const day = 86400_000, now = Date.parse("2026-11-20T12:00:00Z"), run = (name: string, bytes: number, at: number) => ({ name, bytes, at, pictures: [] })
  check("agent runs: runs named for a day over two weeks ago go, then the least recently written while all are over the cap, never the latest", same([
    [R.runsToPruneKeepingLatest([run("2026-11-01-a", 1, now), run("2026-11-07-b", 1, now), run("2026-11-06-c", 1, now), run("notes", 1, 0)], now, 14, 100), ["2026-11-01-a", "2026-11-06-c"]],
    [R.runsToPruneKeepingLatest([run("2026-11-18-old", 40, now - 2 * day), run("2026-11-20-new", 40, now), run("2026-11-19-mid", 40, now - day)], now, 14, 100), ["2026-11-18-old"]],
    [R.runsToPruneKeepingLatest([run("2026-11-18-old", 40, now - 2 * day), run("2026-11-20-new", 40, now)], now, 14, 100), []],
    [R.runsToPruneKeepingLatest([run("2026-11-20-big", 500, now), run("2026-11-19-small", 1, now - day)], now, 14, 100), ["2026-11-19-small"]],
  ]))
  const pics = (n: number) => Array.from({ length: n }, (_, i) => ({ shot: `${9 + i}.jpg`, bytes: 30 }))
  check("agent runs: a run over the cap alone loses its oldest pictures, by time, till it's under; one under it loses none", same([
    [R.oldestPicturesOverTheCap({ name: "2026-11-20-big", bytes: 160, at: now, pictures: pics(5) }, 100), ["9.jpg", "10.jpg"]],
    [R.oldestPicturesOverTheCap({ name: "2026-11-20-big", bytes: 100, at: now, pictures: pics(3) }, 100), []],
    [R.oldestPicturesOverTheCap({ name: "2026-11-20-big", bytes: 1000, at: now, pictures: pics(2) }, 100), ["9.jpg", "10.jpg"]],
  ]))

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-runs-"))
  const make = (name: string, bytes: number, at: number) => {
    fs.mkdirSync(path.join(root, name, "thumbs"), { recursive: true })
    for (const [f, n] of [["steps.jsonl", bytes / 2], [path.join("thumbs", "1.jpg"), bytes / 2]] as const) {
      fs.writeFileSync(path.join(root, name, f), Buffer.alloc(n))
      fs.utimesSync(path.join(root, name, f), at / 1000, at / 1000)
    }
  }
  make("2026-10-01-gone", 10, now - 50 * day)
  make("2026-11-18-old", 40, now - 2 * day)
  make("2026-11-19-mid", 40, now - day)
  make("2026-11-20-new", 40, now)
  fs.writeFileSync(path.join(root, "stray.txt"), "x")
  R.keptFrame(7, "2026-11-18-old", a, "5.jpg")
  const { gone, trimmed } = await R.pruneRuns(root, now, 14, 100)
  check("agent runs: pruning removes those runs' folders, thumbnails counted, and forgets their pictures", same([
    [gone.sort(), ["2026-10-01-gone", "2026-11-18-old"]], [fs.readdirSync(root).sort(), ["2026-11-19-mid", "2026-11-20-new", "stray.txt"]],
    [R.repeatOf(7, "2026-11-18-old", a), null], [trimmed, []],
  ]), { gone, left: fs.readdirSync(root) })
  fs.rmSync(root, { recursive: true, force: true })

  const big = fs.mkdtempSync(path.join(os.tmpdir(), "agent-runs-")), live = path.join(big, "2026-11-20-live")
  fs.mkdirSync(path.join(live, "thumbs"), { recursive: true })
  fs.writeFileSync(path.join(live, "steps.jsonl"), Buffer.alloc(10))
  for (const t of [100, 200, 300, 1000]) for (const [f, n] of [[`${t}.jpg`, 30], [path.join("thumbs", `${t}.jpg`), 10]] as const) fs.writeFileSync(path.join(live, f), Buffer.alloc(n))
  R.keptFrame(8, "2026-11-20-live", a, "100.jpg")
  const cut = await R.pruneRuns(big, now, 14, 100)
  check("agent runs: pruning trims the latest run over the cap alone by its oldest pictures and their thumbnails, keeping its steps", same([
    [cut, { gone: [], trimmed: ["2026-11-20-live/100.jpg", "2026-11-20-live/200.jpg"] }],
    [fs.readdirSync(live).sort(), ["1000.jpg", "300.jpg", "steps.jsonl", "thumbs"]], [fs.readdirSync(path.join(live, "thumbs")).sort(), ["1000.jpg", "300.jpg"]],
    [R.repeatOf(8, "2026-11-20-live", a), null],
  ]), { cut, left: fs.readdirSync(live) })
  fs.rmSync(big, { recursive: true, force: true })
}
