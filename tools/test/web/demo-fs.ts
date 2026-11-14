import { check } from "../lib.ts"

{
  const fs = await import("../../../web/demo/node/fs.ts")
  const { pipeline, Readable } = await import("../../../web/demo/node/stream.ts")
  const { once } = await import("../../../web/demo/node/events.ts")
  const codeOf = (e: NodeJS.ErrnoException) => e.code
  fs.mkdirSync("/v", { recursive: true })
  const text = "line\n".repeat(30_000)
  fs.writeFileSync("/v/a.md", text)

  const chunks: Buffer[] = []
  for await (const c of fs.createReadStream("/v/a.md", { highWaterMark: 50_000 })) chunks.push(Buffer.from(c))
  check("demo fs: a read stream gives the file in chunks of highWaterMark", Buffer.concat(chunks).toString() === text && chunks.length === 3 && chunks[0].length === 50_000,
    chunks.map((c) => c.length))
  const part: Buffer[] = []
  for await (const c of fs.createReadStream("/v/a.md", { start: 5, end: 9 })) part.push(Buffer.from(c))
  check("demo fs: ...from start to end, both in", Buffer.concat(part).toString() === "line\n", Buffer.concat(part).toString())
  const missing = await (async () => { for await (const _ of fs.createReadStream("/v/none.md")) return "read"; return "nothing" })().catch(codeOf)
  check("demo fs: a missing file fails the read with ENOENT", missing === "ENOENT", missing)

  const out = fs.createWriteStream("/v/b.md")
  check("demo fs: a write stream makes its file at once", fs.existsSync("/v/b.md") && fs.readFileSync("/v/b.md", "utf8") === "")
  for (const c of ["one ", "two ", Buffer.from("three")]) out.write(c)
  out.end()
  await once(out, "close")
  check("demo fs: ...and has what was written once it's ended and closed", fs.readFileSync("/v/b.md", "utf8") === "one two three" && out.writableFinished)
  const taken = fs.createWriteStream("/v/b.md", { flags: "wx" })
  const refused = await once(taken, "close").then(() => "closed", codeOf)
  check("demo fs: flags wx on a file there fails with EEXIST", refused === "EEXIST", refused)

  await pipeline(fs.createReadStream("/v/a.md"), fs.createWriteStream("/v/c.md"))
  check("demo fs: pipeline copies a read stream into a write stream", fs.readFileSync("/v/c.md", "utf8") === text)
  await pipeline(Readable.from([Buffer.from("more")]), fs.createWriteStream("/v/c.md", { flags: "a" }))
  check("demo fs: ...appending with flags a", fs.readFileSync("/v/c.md", "utf8") === text + "more")
  const seen: number[] = []
  const src = fs.createReadStream("/v/a.md", { highWaterMark: 1000 })
  src.on("data", (c) => { seen.push(c instanceof Uint8Array ? c.length : 0); if (seen.length === 2) src.destroy() })
  await once(src, "close")
  check("demo fs: a stream destroyed while flowing gives no more", seen.length === 2 && !src.readableEnded, seen.length)
}
