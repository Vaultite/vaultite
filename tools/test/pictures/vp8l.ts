// WebP lossless, exactly as libwebp's dwebp; an ALPH chunk's stream; damaged and oversized input. How the fixtures
// were made and what each covers: tools/fixtures/pictures/webp-lossless/CLAUDE.md.
import fs from "node:fs"
import path from "node:path"
import { Unreadable } from "../../../plugins/core/terminal/claude-pictures/decode/pixels.ts"
import { decodeVp8l } from "../../../plugins/core/terminal/claude-pictures/decode/webp/vp8l.ts"
import { check, section } from "../lib.ts"
import { checkPicture, FIXTURES, fixture, LIMITS, reference } from "./compare.ts"

const DIR = "webp-lossless"

/** A RIFF WebP's chunks by fourcc (the first of each), minimally: the container is the vp8 decoder's, not under test. */
function chunks(file: Uint8Array): Map<string, Uint8Array> {
  const tag = (at: number) => String.fromCharCode(...file.subarray(at, at + 4))
  if (tag(0) !== "RIFF" || tag(8) !== "WEBP") throw new Error("not a RIFF WebP")
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength), out = new Map<string, Uint8Array>()
  for (let at = 12; at + 8 <= file.length;) {
    const len = view.getUint32(at + 4, true)
    if (!out.has(tag(at))) out.set(tag(at), file.subarray(at + 8, at + 8 + len))
    at += 8 + len + (len & 1)
  }
  return out
}

const vp8l = (rel: string) => {
  const c = chunks(fixture(rel)).get("VP8L")
  if (!c) throw new Error(`no VP8L chunk: ${rel}`)
  return c
}

/** A VP8L header (signature, size, alpha_is_used, version) followed by `rest`. */
function header(width: number, height: number, rest: Uint8Array = new Uint8Array(16), version = 0) {
  const bits = (width - 1) | ((height - 1) << 14) | (1 << 28) | (version << 29)
  return new Uint8Array([0x2f, bits & 255, (bits >>> 8) & 255, (bits >>> 16) & 255, bits >>> 24, ...rest])
}

/** A deterministic PRNG (mulberry32). */
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32
  }
}

/** How a damaged copy went: decoded, thrown Unreadable, or thrown something else (a bug); and how long it took. */
function attempt(data: Uint8Array) {
  const t0 = performance.now()
  let how = "decoded"
  try { decodeVp8l(data, LIMITS) } catch (e) { how = e instanceof Unreadable ? "unreadable" : `threw ${String(e)}` }
  return { how, ms: performance.now() - t0 }
}

export async function testVp8l(): Promise<void> {
  await section("webp lossless", () => {
    const files = fs.readdirSync(path.join(FIXTURES, DIR)).filter((f) => f.endsWith(".webp")).sort()
    const lossless = files.filter((f) => !f.startsWith("lossy-"))
    for (const f of lossless) {
      const rel = `${DIR}/${f}`
      let got = null
      try { got = decodeVp8l(vp8l(rel), LIMITS) } catch (e) { check(`decodes ${f}`, false, String(e)); continue }
      checkPicture(`decodes ${f} as dwebp does`, got, reference(rel))
    }

    // (an ALPH chunk compressed with method 1, unfiltered: its stream's green is the alpha dwebp gives)
    for (const f of files.filter((f) => f.startsWith("lossy-"))) {
      const rel = `${DIR}/${f}`, c = chunks(fixture(rel)), vp8x = c.get("VP8X"), alph = c.get("ALPH")
      if (!vp8x || !alph) { check(`${f} has VP8X and ALPH`, false); continue }
      const width = 1 + (vp8x[4] | (vp8x[5] << 8) | (vp8x[6] << 16)), height = 1 + (vp8x[7] | (vp8x[8] << 8) | (vp8x[9] << 16))
      check(`${f}'s alpha is lossless and unfiltered`, (alph[0] & 3) === 1 && ((alph[0] >> 2) & 3) === 0, alph[0])
      const ref = reference(rel)
      let wrong = -1
      try {
        const got = decodeVp8l(alph.subarray(1), LIMITS, { width, height })
        wrong = got.width === ref.width && got.height === ref.height ? 0 : Infinity
        for (let i = 0; wrong === 0 && i < width * height; i++) if (got.data[i * 4 + 1] !== ref.data[i * 4 + 3]) wrong++
      } catch (e) { check(`decodes ${f}'s ALPH stream`, false, String(e)); continue }
      check(`decodes ${f}'s ALPH stream (${width}x${height}) to dwebp's alpha`, wrong === 0, { wrong })
    }

    // (damaged copies: cut short, bits flipped, garbage after a header)
    const rnd = random(9649), outcomes = new Map<string, number>()
    let slowest = 0
    let worst: Uint8Array = new Uint8Array(0)
    const tally = (data: Uint8Array) => {
      const { how, ms } = attempt(data)
      outcomes.set(how, (outcomes.get(how) ?? 0) + 1)
      if (ms > slowest) { slowest = ms; worst = data }
    }
    for (const f of ["photo", "alpha", "odd", "gradient", "pal4", "pal16", "pal200", "screen"]) {
      const good = vp8l(`${DIR}/${f}.webp`)
      for (let k = 1; k < 24; k++) tally(good.subarray(0, Math.floor((good.length * k) / 24)))
      for (let k = 0; k < 60; k++) {
        const bad = good.slice()
        for (let n = 1 + Math.floor(rnd() * 3); n > 0; n--) {
          const bit = 40 + Math.floor(rnd() * (bad.length * 8 - 40)) // (past the header: its size stays sane)
          bad[bit >> 3] ^= 1 << (bit & 7)
        }
        tally(bad)
      }
    }
    for (let k = 0; k < 100; k++) {
      const junk = new Uint8Array(1 + Math.floor(rnd() * 400))
      for (let i = 0; i < junk.length; i++) junk[i] = Math.floor(rnd() * 256)
      tally(header(1 + Math.floor(rnd() * 300), 1 + Math.floor(rnd() * 300), junk))
    }
    const strange = [...outcomes.keys()].filter((k) => k.startsWith("threw"))
    check("damaged copies decode or throw Unreadable", strange.length === 0, strange)
    // A slow input is slow each time; a busy machine's pause (1.3 s once on CI's arm64 runner, for 3 ms here) is not.
    slowest = Math.min(slowest, ...[0, 1].map(() => attempt(worst).ms))
    check("damaged copies never hang (each under a second)", slowest < 1000, { slowest })
    console.log(`     damaged copies: ${JSON.stringify(Object.fromEntries(outcomes))}, slowest ${slowest.toFixed(1)} ms`)

    // (what is refused before anything is allocated)
    const refused = (data: Uint8Array, limits = LIMITS, implicit?: { width: number; height: number }) => {
      try { decodeVp8l(data, limits, implicit); return "decoded" } catch (e) { return e instanceof Unreadable ? e.message : `threw ${String(e)}` }
    }
    check("a 16384x16384 header over the limits is refused", /too many pixels/.test(refused(header(16384, 16384), { maxPixels: 1 << 20 })))
    check("an implicit 16384x16384 over the limits is refused", /too many pixels/.test(refused(new Uint8Array(8), { maxPixels: 1 << 20 }, { width: 16384, height: 16384 })))
    check("an unknown version is refused", /version/.test(refused(header(4, 4, new Uint8Array(16), 1))))
    check("no signature is refused", /not a VP8L/.test(refused(new Uint8Array([0x2e, 0, 0, 0, 0, 0]))))
    check("nothing is refused", /not a VP8L/.test(refused(new Uint8Array(0))))
    check("a header alone is refused", refused(header(64, 64, new Uint8Array(0))) !== "decoded")

    // (time, logged: no assertion)
    const largest = lossless.map((f) => ({ f, c: vp8l(`${DIR}/${f}`) })).map(({ f, c }) => ({ f, c, px: decodeVp8l(c, LIMITS) }))
      .sort((a, b) => b.px.width * b.px.height - a.px.width * a.px.height)[0]
    const runs = 20, t0 = performance.now()
    for (let i = 0; i < runs; i++) decodeVp8l(largest.c, LIMITS)
    console.log(`     ${largest.f} (${largest.px.width}x${largest.px.height}): ${((performance.now() - t0) / runs).toFixed(2)} ms a decode`)
  })
}
