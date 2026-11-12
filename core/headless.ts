// A headless Chrome the server drives over the DevTools protocol: never a window on the user's screen, never a sound.
// What a job's proof video records in, and what turns a page (a mockup, a prototype) into a picture.
import { spawn } from "node:child_process"
import fs from "node:fs"
import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { logger } from "./log.ts"

const log = logger("headless")

/** Chrome to drive: VAULTITE_CHROME, Playwright's Chromium (a checkout's), Google Chrome, Linux's Chromium. Not the
 *  installed Chrome first: a headless one left running is what macOS brings forward when it's opened. */
export function chromePath() {
  const bundled = () => { try { return createRequire(import.meta.url)("playwright-core").chromium.executablePath() as string } catch { return undefined } }
  return [process.env.VAULTITE_CHROME, bundled(), "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/snap/bin/chromium"].find((p) => p && fs.existsSync(p)) ?? null
}

export type Cdp = { send: (method: string, params?: Record<string, unknown>) => Promise<Record<string, unknown>>; on: (method: string, f: (p: Record<string, unknown>) => void) => void; close: () => void }
async function cdp(wsUrl: string): Promise<Cdp> {
  const ws = new WebSocket(wsUrl)
  await new Promise<void>((ok, fail) => { ws.onopen = () => ok(); ws.onerror = () => fail(new Error("couldn't reach the headless browser")) })
  let id = 0
  const waits = new Map<number, { ok: (v: Record<string, unknown>) => void; fail: (e: Error) => void }>(), subs = new Map<string, ((p: Record<string, unknown>) => void)[]>()
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data)) as { id?: number; result?: Record<string, unknown>; error?: { message: string }; method?: string; params?: Record<string, unknown> }
    if (m.id !== undefined) { const w = waits.get(m.id); waits.delete(m.id); if (m.error) w?.fail(new Error(m.error.message)); else w?.ok(m.result ?? {}) }
    else if (m.method) for (const f of subs.get(m.method) ?? []) f(m.params ?? {})
  }
  ws.onclose = () => { for (const w of waits.values()) w.fail(new Error("the headless browser closed")); waits.clear() }
  return {
    send: (method, params = {}) => new Promise((ok, fail) => { const n = ++id; waits.set(n, { ok, fail }); ws.send(JSON.stringify({ id: n, method, params })) }),
    on: (method, f) => subs.set(method, [...(subs.get(method) ?? []), f]),
    close: () => ws.close(),
  }
}

export type Headless = { page: Cdp; stop: () => void; quit: () => Promise<void> }
/** A headless, muted Chrome of its own profile, `size` large, and its first page; `quit()` ends it and removes its
 *  profile. Throws saying why it couldn't start. */
export async function headless(size: { width: number; height: number }, signal?: AbortSignal): Promise<Headless> {
  try { return await launch(size, signal, false) } catch (e) {
    // (Ubuntu 24.04 keeps Chrome's sandbox from starting: AppArmor refuses it the user namespaces it needs)
    if (process.platform !== "linux" || !/quit as it started/.test((e as Error).message)) throw e
    return launch(size, signal, true)
  }
}
async function launch(size: { width: number; height: number }, signal: AbortSignal | undefined, unsandboxed: boolean): Promise<Headless> {
  const chrome = chromePath()
  if (!chrome) throw new Error("no Chrome here (Google Chrome, or Chromium: VAULTITE_CHROME names one)")
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "vaultite-headless-"))
  const browser = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--mute-audio", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--force-device-scale-factor=1", `--window-size=${size.width},${size.height}`, "--disable-extensions", "--autoplay-policy=user-gesture-required", ...(unsandboxed ? ["--no-sandbox"] : []), "about:blank"], { stdio: ["ignore", "ignore", "pipe"] })
  let page: Cdp | null = null
  const stop = () => { try { page?.close() } catch { /* gone */ } browser.kill("SIGKILL") }
  const quit = async () => {
    // (its profile goes once it has quit: a browser still writing there makes the removal fail, and hide the real error)
    const gone = browser.exitCode !== null ? Promise.resolve() : new Promise<void>((ok) => browser.once("exit", () => ok()))
    stop()
    await Promise.race([gone, sleep(3000)])
    try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 }) } catch (e) { log.error(`${profile} stays: ${(e as Error).message}`) }
  }
  signal?.addEventListener("abort", stop, { once: true })
  try {
    const endpoint = await new Promise<string>((ok, fail) => {
      let err = ""
      const t = setTimeout(() => fail(new Error(`Chrome didn't start: ${err.slice(-300)}`)), 20_000)
      browser.stderr!.on("data", (d: Buffer) => { err += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(err); if (m) { clearTimeout(t); ok(m[1]) } })
      browser.on("exit", () => { clearTimeout(t); fail(new Error(`Chrome quit as it started: ${err.slice(-300)}`)) })
    })
    const port = new URL(endpoint).port
    // (its first tab comes a moment after the browser says it listens)
    let tab: { type: string; webSocketDebuggerUrl: string } | undefined
    for (let i = 0; i < 50 && !tab; i++) {
      tab = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json() as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === "page")
      if (!tab) await sleep(100)
    }
    if (!tab) throw new Error("Chrome opened no page")
    page = await cdp(tab.webSocketDebuggerUrl)
    return { page, stop, quit }
  } catch (e) {
    await quit()
    throw e
  }
}

const sleep = (ms: number) => new Promise<void>((ok) => setTimeout(ok, ms))
