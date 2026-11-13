// dev.*: an agent testing the running app looks at the user's window (`vau dev ...`): a screenshot, its HTML, its
// console, JS run in it. The window answers through the server (core/live.ts ask; web/src/core/dev.ts); owner-only.
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { z } from "zod"
import { defineOp, type Op, OpError, type OpCtx } from "../ops.ts"

const OWNER = "the app's window"

type DevAsk = { what: "screenshot"; selector: string | null } | { what: "dom"; selector: string; text: boolean; inner: boolean; attr: string | null; all: boolean }
  | { what: "console"; limit: number; level: string | null; clear: boolean } | { what: "eval"; code: string }

/** Ask the window focused last; no window open says what to do. */
const ask = (ctx: OpCtx, message: DevAsk, timeout?: number) =>
  ctx.ui({ action: "dev", ...message, ...(timeout ? { timeout } : {}) }).catch((e: unknown) => {
    if (e instanceof OpError && e.status === 409 && /no app window/.test(e.message)) throw new OpError("no app window is open on this server: open the app (browser or desktop) first", 409)
    throw e
  })

/** What the window answers (web/src/core/dev.ts). */
const Shot = z.object({ png: z.string(), width: z.number().nullish(), height: z.number().nullish() })
const Dom = z.object({ selector: z.string(), count: z.number(), matches: z.array(z.string().nullable()) }).loose()
const Logged = z.object({ entries: z.array(z.object({ t: z.number(), level: z.string(), text: z.string() }).loose()) }).loose()
const Value = z.object({ value: z.unknown() }).loose()

const time = (t: number) => new Date(t).toTimeString().slice(0, 8)

export function devOps(): Op[] {
  return [defineOp({
    id: "dev.screenshot",
    cli: "dev screenshot",
    summary: "A screenshot of the user's app window (or one element of it), saved as a PNG: its path.",
    help: `Captures the window the user was in last, as it is (the desktop app only: a browser can't capture itself; read
it with dev dom or dev eval there). selector captures one element. Saved on the server's machine, to out or a temp file.

  vau dev screenshot
  vau dev screenshot --selector "#main-scroll" --out /tmp/page.png`,
    kind: "read",
    owner: OWNER,
    params: {
      out: { type: "string", description: "where to save the PNG on the server's machine (a file path); a temp file when left out" },
      selector: { type: "string", description: "a CSS selector: capture only the first element it matches" },
    },
    run: async ({ out, selector }, ctx) => {
      const got = Shot.safeParse(await ask(ctx, { what: "screenshot", selector: selector ?? null }, 30))
      if (!got.success) throw new OpError("the window sent no picture", 502)
      const r = got.data
      const file = path.resolve(String(out ?? path.join(os.tmpdir(), `vaultite-screenshot-${Date.now()}.png`)).replace(/^~(?=\/|$)/, os.homedir()))
      fs.mkdirSync(path.dirname(file), { recursive: true })
      fs.writeFileSync(file, Buffer.from(r.png, "base64"))
      return { path: file, width: r.width ?? null, height: r.height ?? null }
    },
    text: (r) => r.path,
  }), defineOp({
    id: "dev.dom",
    cli: "dev dom",
    summary: "The user's app window's HTML: what a CSS selector matches (outer HTML, text, an attribute), and how many.",
    help: `Reads the page of the window the user was in last. The first match's outer HTML by default; text or inner for
its text or inner HTML, attr for one attribute; all for every match. Long HTML is cut at 100,000 characters.

  vau dev dom "[data-pane] h1" --text
  vau dev dom ".cm-line" --all --count
  vau dev dom "#root" --attr class`,
    kind: "read",
    owner: OWNER,
    params: {
      selector: { type: "string", required: true, description: "a CSS selector" },
      text: { type: "boolean", description: "each match's text instead of its HTML" },
      inner: { type: "boolean", description: "each match's inner HTML" },
      attr: { type: "string", description: "each match's value of this attribute" },
      all: { type: "boolean", description: "every match, not only the first" },
    },
    args: ["selector"],
    run: async ({ selector, text, inner, attr, all }, ctx) => Dom.parse(await ask(ctx, { what: "dom", selector, text: !!text, inner: !!inner, attr: attr ?? null, all: !!all })),
    text: (r) => (r.count ? `${r.count} match${r.count === 1 ? "" : "es"}${r.matches.length < r.count ? ` (the first shown)` : ""}:\n\n${r.matches.map((m) => m ?? "(none)").join("\n\n")}` : `Nothing matches ${r.selector}.`),
  }), defineOp({
    id: "dev.console",
    cli: "dev console",
    summary: "The user's app window's last console messages and uncaught errors (kept since it loaded, the last 500).",
    help: `What the page logged (log, info, warn, error, debug) and its uncaught errors, oldest first. clear forgets them
after reading. The errors the app keeps across reloads are \`vau errors\`.

  vau dev console
  vau dev console --level error --limit 10
  vau dev console --clear`,
    kind: "read",
    owner: OWNER,
    params: {
      limit: { type: "integer", minimum: 1, maximum: 500, default: 50, description: "at most this many, the latest" },
      level: { type: "string", enum: ["log", "info", "warn", "error", "debug"], description: "only this level" },
      clear: { type: "boolean", description: "forget them after reading" },
    },
    run: async ({ limit, level, clear }, ctx) => Logged.parse(await ask(ctx, { what: "console", limit, level: level ?? null, clear: !!clear })),
    text: (r) => (r.entries.length ? r.entries.map((e) => `${time(e.t)} ${e.level.padEnd(5)} ${e.text}`).join("\n") : "Nothing logged."),
  }), defineOp({
    id: "dev.eval",
    cli: "dev eval",
    summary: "Run JavaScript in the user's app window (its global scope) and get the value, as JSON.",
    help: `The code's value is the answer (a statement list's last one; a promise's once it settles), made JSON (DOM nodes
as their HTML). It runs in the user's open app as they are using it: read, don't change their things. Code from
stdin: --code -.

  vau dev eval "document.title"
  vau dev eval "[...document.querySelectorAll('[data-pane]')].length"
  echo "await fetch('api/ui').then((r) => r.json())" | vau dev eval --code -`,
    kind: "write",
    lock: false, // (its code may write through the API, which waits for the vault)
    owner: OWNER,
    params: {
      code: { type: "string", required: true, stdin: true, description: "the JavaScript to run (piped in when left out)" },
      timeout: { type: "number", minimum: 1, maximum: 120, default: 10, description: "seconds to wait for its value" },
    },
    args: ["code"],
    run: async ({ code, timeout }, ctx) => Value.parse(await ask(ctx, { what: "eval", code }, timeout)),
    text: (r) => JSON.stringify(r.value, null, 2) ?? "null",
  })]
}
