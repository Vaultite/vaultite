const MUX = /\/api\/mux(\?.*)?$/
const routed = new WeakMap()

const head = (letter, ch) => `${letter}${ch.toString(36)} `
function frameOf(m) {
  if (m instanceof Uint8Array) return m.length >= 5 ? { kind: "b", ch: m.readUInt32BE(1), rest: m.subarray(5) } : null
  const sp = m.indexOf(" ")
  return sp < 2 ? null : { kind: m[0], ch: parseInt(m.slice(1, sp), 36), rest: m.slice(sp + 1) }
}
const textOf = (f) => (f.kind === "t" || f.kind === "T" || f.kind === "b" ? f.rest : undefined)
const dataFrame = (ch, data) => {
  if (!(data instanceof Uint8Array)) return head("t", ch) + data
  const b = Buffer.from(data), out = Buffer.alloc(5 + b.length)
  out[0] = 0x62
  out.writeUInt32BE(ch, 1)
  b.copy(out, 5)
  return out
}

class ChannelRoute {
  constructor(page, server, ch, path, base) {
    Object.assign(this, { page, server, ch, path, base, opened: false, connected: false, closed: false, mine: [], ends: [], up: null })
  }
  url() { return `${this.base}/api/${this.path}` }
  open() { if (!this.opened) { this.opened = true; this.page.send(head("k", this.ch)) } }
  send(data) { if (this.closed) return; this.open(); this.page.send(dataFrame(this.ch, data)) }
  onMessage(fn) { this.mine.push(fn) }
  onClose(fn) { this.ends.push(fn) }
  close({ code = 1000, reason = "" } = {}) {
    if (this.closed) return
    this.closed = true
    this.page.send(this.opened ? `${head("c", this.ch)}${code} ${reason}` : `${head("r", this.ch)}503 refused by the test`)
    if (this.connected) this.server.send(`${head("c", this.ch)}1000 `)
  }
  connectToServer() {
    this.connected = true
    this.server.send(head("o", this.ch) + this.path)
    const route = this, theirs = []
    this.up = {
      heard: (m, f) => {
        if (f.kind === "k") route.opened = true
        if (f.kind === "c" || f.kind === "r") route.closed = true
        if (!theirs.length || textOf(f) === undefined) return route.page.send(m)
        for (const fn of theirs) fn(textOf(f))
      },
      send: (data) => route.server.send(dataFrame(route.ch, data)),
      onMessage: (fn) => theirs.push(fn),
      close: () => {
        if (route.closed) return
        route.closed = true
        route.server.send(`${head("c", route.ch)}1000 `)
        route.page.send(`${head("c", route.ch)}1006 `)
      },
    }
    return this.up
  }
  heard(m, f) {
    if (f.kind === "c") { this.closed = true; for (const fn of this.ends) fn(); if (this.connected) this.server.send(m); return }
    if (this.mine.length && textOf(f) !== undefined) { for (const fn of this.mine) fn(textOf(f)); return }
    if (this.connected) this.server.send(m)
  }
}

function carry(ws, routes) {
  const server = ws.connectToServer(), mine = new Map(), base = ws.url().replace(/\/api\/mux.*$/, "")
  ws.onMessage((m) => {
    const f = frameOf(m)
    if (f?.kind === "o") {
      const r = routes.findLast((x) => x.re.test(`/api/${f.rest}`))
      if (r) { const c = new ChannelRoute(ws, server, f.ch, f.rest, base); mine.set(f.ch, c); return void r.fn(c) }
    }
    const c = f && mine.get(f.ch)
    if (c) return c.heard(m, f)
    server.send(m)
  })
  server.onMessage((m) => {
    const f = frameOf(m), c = f && mine.get(f.ch)
    if (c?.up) return c.up.heard(m, f)
    if (!c) ws.send(m)
  })
}

export async function routeSocket(target, re, fn) {
  let routes = routed.get(target)
  if (!routes) {
    routed.set(target, routes = [])
    await target.routeWebSocket(MUX, (ws) => carry(ws, routes))
  }
  routes.push({ re, fn })
}

export const channelData = (payload) => { const f = frameOf(String(payload)); return f ? textOf(f) : undefined }
