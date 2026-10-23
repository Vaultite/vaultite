// Temporary (windev): logs who opens and closes files named in TRACE_MATCH, with stacks, to TRACE_LOG.
import fs from "node:fs"
import { syncBuiltinESMExports } from "node:module"
const LOG = process.env.TRACE_LOG, MATCH = process.env.TRACE_MATCH || "Alice Park.md"
const want = (p) => typeof p === "string" && p.includes(MATCH) && !p.includes(".tmp-")
const fds = new Map()
const who = `${process.pid} ${String(process.argv[1] ?? "").split(/[\\/]/).pop()}`
const log = (what, p, fd) => { try { fs.appendFileSync(LOG, `${Date.now() % 100000} ${who} ${what} fd=${fd ?? ""} ${p ?? ""}\n${what.startsWith("open") ? new Error().stack.split("\n").slice(2, 10).join("\n") + "\n" : ""}`) } catch {} }
const wrap = (obj, name, fn) => { const orig = obj[name]; obj[name] = fn(orig) }
wrap(fs, "openSync", (o) => function (p, ...a) { const fd = o.call(this, p, ...a); if (want(p)) { fds.set(fd, p); log("openSync", p, fd) } return fd })
wrap(fs, "closeSync", (o) => function (fd, ...a) { if (fds.has(fd)) { log("closeSync", fds.get(fd), fd); fds.delete(fd) } return o.call(this, fd, ...a) })
wrap(fs, "open", (o) => function (p, ...a) { const cb = a.pop(); return o.call(this, p, ...a, (e, fd) => { if (!e && want(p)) { fds.set(fd, p); log("open", p, fd) } cb(e, fd) }) })
wrap(fs, "close", (o) => function (fd, ...a) { if (fds.has(fd)) { log("close", fds.get(fd), fd); fds.delete(fd) } return o.call(this, fd, ...a) })
wrap(fs.promises, "open", (o) => async function (p, ...a) { const h = await o.call(this, p, ...a); if (want(p)) { log("promises.open", p, h.fd); const c = h.close.bind(h); h.close = async () => { log("promises.close", p, h.fd); return c() } } return h })
wrap(fs.promises, "readFile", (o) => async function (p, ...a) { if (want(p)) log("promises.readFile start", p); try { return await o.call(this, p, ...a) } finally { if (want(p)) log("promises.readFile end", p) } })
wrap(fs, "readFile", (o) => function (p, ...a) { const cb = a.pop(); if (want(p)) log("readFile start", p); return o.call(this, p, ...a, (...r) => { if (want(p)) log("readFile end", p); cb(...r) }) })
syncBuiltinESMExports()
