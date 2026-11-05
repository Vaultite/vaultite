// Made-up terminal output for the terminal's benchmarks and tests (perf/vt.ts, test_vt.ts): what programs in a
// terminal here print, fixed so runs compare. Each is the bytes a program writes, as a string.

/** A small seeded random (mulberry32), so a corpus is the same each run. */
function rand(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}
const WORDS = "the terminal keeps its screen and history while agents write notes about Lisbon trips plans for Lighthouse reviews of code".split(" ")
const sentence = (r: () => number, n: number) => Array.from({ length: n }, () => WORDS[Math.floor(r() * WORDS.length)]).join(" ")

/** An Ink-style agent (Claude Code's look): each frame drawn again in place in synchronized output (2026), cursor up
 *  and erased lines, truecolor text, a spinner, a box around the input. */
export function inkFrames(frames = 600, cols = 120) {
  const r = rand(1), spin = "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"
  let out = "", height = 0
  for (let f = 0; f < frames; f++) {
    let frame = "\x1b[?2026h" + (height ? `\x1b[${height}A\r` : "")
    const lines: string[] = []
    lines.push(`\x1b[38;2;215;119;87m${spin[f % spin.length]}\x1b[39m \x1b[1mThinking…\x1b[22m \x1b[2m(${f}s · esc to interrupt)\x1b[22m`)
    for (let i = 0; i < 8; i++) lines.push(`  \x1b[38;2;${100 + (i * 17) % 120};${140 + (f % 80)};200m⎿\x1b[39m ${sentence(r, 8 + (i % 5))}`)
    lines.push(`\x1b[38;2;136;136;136m╭${"─".repeat(cols - 2)}╮\x1b[39m`)
    lines.push(`\x1b[38;2;136;136;136m│\x1b[39m > \x1b[38;5;244mTry "write a test for the parser"\x1b[39m${" ".repeat(cols - 38)}\x1b[38;2;136;136;136m│\x1b[39m`)
    lines.push(`\x1b[38;2;136;136;136m╰${"─".repeat(cols - 2)}╯\x1b[39m`)
    frame += lines.map((l) => `\x1b[2K${l}`).join("\r\n") + "\x1b[?2026l"
    height = lines.length - 1
    out += frame
    if (f % 50 === 49) { out += "\r\n".repeat(1) + `\x1b[1m● \x1b[22m${sentence(r, 30)}\r\n`; height = 0 }
  }
  return out
}

/** Styled Markdown streamed in small pieces as an agent's answer: bold, code, lists, emoji and CJK. */
export function streaming(lines = 3000) {
  const r = rand(2)
  let out = ""
  for (let i = 0; i < lines; i++) {
    const k = i % 7
    out += k === 0 ? `\x1b[1;38;5;75m## Section ${i}\x1b[0m\r\n`
      : k === 1 ? `  \x1b[38;5;242m•\x1b[0m ${sentence(r, 12)} \x1b[48;5;236m\x1b[38;5;215mcode()\x1b[0m\r\n`
        : k === 2 ? `${sentence(r, 6)} 東京の地図 🙂 ${sentence(r, 4)}\r\n`
          : k === 3 ? `\x1b[3m${sentence(r, 14)}\x1b[23m\r\n`
            : `${sentence(r, 10 + (i % 20))}\r\n`
  }
  return out
}

/** `yes`-like: one short line again and again. */
export const yes = (lines = 50000) => "y\r\n".repeat(lines)
/** `seq`-like: numbered lines. */
export function seq(lines = 50000) { let s = ""; for (let i = 1; i <= lines; i++) s += `${i}\r\n`; return s }
/** Full lines of colored text to fill a history: `lines` of `cols` columns. */
export function fill(lines: number, cols = 120) {
  const r = rand(3)
  let s = ""
  for (let i = 0; i < lines; i++) {
    let line = `\x1b[38;5;${16 + (i % 200)}m${String(i).padStart(6)} `
    while (line.length < cols) line += sentence(r, 1) + " "
    s += line.slice(0, cols + 12) + "\x1b[0m\r\n"
  }
  return s
}

/** A spinner a program redraws in place at `hz`, for `seconds`: what an idle agent's terminal gets. */
export const spinner = (frames: number) => Array.from({ length: frames }, (_, i) => `\r\x1b[2K\x1b[38;5;208m${"⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏"[i % 10]}\x1b[0m waiting · ${i}`).join("")

/** The corpora the benchmark and tests use, by name. */
export const CORPORA: Record<string, () => string> = {
  ink: () => inkFrames(),
  streaming: () => streaming(),
  yes: () => yes(),
  seq: () => seq(),
}
