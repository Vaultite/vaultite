// Made-up sites for the browser evals, on 127.0.0.1: a mail app, a drive with docs, a billing console, a settings form
// and an orders table. Each is shaped like the real sites agents use (client-rendered, noisy chrome, slow loads), and
// keeps what agents change in `state`, which the tasks' checks read.
import http from "node:http"
import path from "node:path"

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c])

// ---------- data ----------
const PEOPLE = ["Alice Park", "Ben Ortiz", "Chloe Nakamura", "Dev Patel", "Erin Walsh", "Felix Romero", "Grace Liu", "Hugo Brandt"]
const pick = (i, list) => list[i % list.length]
const MAILS = (() => {
  const subjects = ["Weekly sync notes", "Re: Lighthouse launch", "Your receipt", "Invitation: design review", "Quarterly numbers", "Re: travel plans",
    "Reminder: timesheet", "New comment on Roadmap", "Lunch on Friday?", "Re: Re: contract draft", "Your order has shipped", "Security alert"]
  const out = []
  for (let i = 0; i < 64; i++) {
    const day = new Date(Date.UTC(2026, 9, 30) - i * 86400_000 * 0.9)
    out.push({ id: `m${i}`, from: pick(i * 3, PEOPLE), email: `${pick(i * 3, PEOPLE).split(" ")[0].toLowerCase()}@lighthouse.test`, subject: pick(i, subjects),
      date: day.toISOString().slice(0, 10), body: `Hi Alice,\n\n${"Some routine message text about the project and the week ahead. ".repeat(4)}\n\nThanks` })
  }
  // (the one the mail task needs, among look-alikes)
  out.splice(23, 0, { id: "m-cov", from: "Harbor Health Benefits", email: "benefits@harborhealth.test", subject: "Your student health plan: coverage update", date: "2026-09-02",
    body: "Dear Alice Park,\n\nThis confirms that your Harbor Student Health Plan coverage ended on 2026-08-31, at the end of the summer term.\nIf you enrolled in a new plan, no action is needed. You may request a certificate of coverage from the portal.\n\nHarbor Health Benefits" })
  out.splice(40, 0, { id: "m-cov2", from: "Harbor Health Benefits", email: "benefits@harborhealth.test", subject: "Your student health plan: renewal reminder", date: "2026-07-15",
    body: "Dear Alice Park,\n\nYour plan renews automatically for the fall term unless you waive it by 2026-08-15.\n\nHarbor Health Benefits" })
  out.splice(12, 0, { id: "m-cov3", from: "Harbor Dental", email: "dental@harbordental.test", subject: "Your dental plan coverage update", date: "2026-10-01",
    body: "Dear Alice Park,\n\nYour Harbor Dental coverage continues through 2026-12-31.\n\nHarbor Dental" })
  return out
})()

const DOCS = (() => {
  const names = ["Roadmap 2027", "Hiring plan", "Budget draft", "Offsite agenda", "Design principles", "Check-in notes 2026-10-27", "Check-in notes 2026-11-03",
    "Check-in notes 2026-10-20", "Outreach plan", "Retro: Lighthouse beta", "Onboarding guide", "Vendor list", "Interview questions", "Launch checklist",
    "Q4 OKRs", "Pricing ideas", "Meeting notes (old)", "Brand voice", "Partner list", "Support macros", "Research synthesis", "Board update draft"]
  return names.map((n, i) => ({ id: `d${i}`, name: n, owner: pick(i, PEOPLE), modified: `2026-${String(10 + (i % 2)).padStart(2, "0")}-${String(1 + (i * 7) % 27).padStart(2, "0")}` }))
})()
const CHECKIN = {
  "Check-in notes 2026-11-03": [
    ["h1", "Weekly check-in, 2026-11-03"], ["p", "Attendees: Alice Park, Ben Ortiz, Chloe Nakamura, Dev Patel"],
    ["h2", "Updates"], ["p", "The beta reached 412 weekly users. Support load is flat. The billing migration slipped a week."],
    ["h2", "Decisions"], ["p", "We will move the launch to 2026-11-24. Pricing stays at the current tiers until January."],
    ["h2", "Action items"], ["li", "Ben Ortiz: write the launch announcement draft by Friday"], ["li", "Chloe Nakamura: finish the billing migration runbook"],
    ["li", "Dev Patel: set up the status page for launch day"], ["p", "Next check-in: 2026-11-10."],
  ],
  "Check-in notes 2026-10-27": [
    ["h1", "Weekly check-in, 2026-10-27"], ["p", "Attendees: Alice Park, Ben Ortiz, Grace Liu"], ["h2", "Action items"],
    ["li", "Grace Liu: interview two designers"], ["li", "Ben Ortiz: clean up the roadmap doc"],
  ],
  "Check-in notes 2026-10-20": [["h1", "Weekly check-in, 2026-10-20"], ["p", "Short meeting, no action items."]],
}
const OUTREACH_START = [
  ["p", "Outreach plan"], ["p", "Goals"], ["p", "We want every partner to recieve the launch kit a week before launch, and to know who to ask."],
  ["p", "Audience"], ["p", "Existing partners first, then the waitlist. Each partner will recieve a personal note from their contact."],
  ["p", "Timeline"], ["p", "Kits go out on 2026-11-17. Follow-ups on 2026-11-20."],
]

const INVOICES = [
  { id: "INV-2026-10", month: "October 2026", date: "2026-11-01", total: "5.03", status: "Paid",
    lines: [["Workers Paid plan (monthly)", "5.00"], ["R2 storage (Class A operations over the free 1M)", "0.02"], ["R2 storage (2.1 GB-month over 10 GB free)", "0.01"], ["Tax", "0.00"]] },
  { id: "INV-2026-09", month: "September 2026", date: "2026-10-01", total: "5.00", status: "Paid", lines: [["Workers Paid plan (monthly)", "5.00"], ["Tax", "0.00"]] },
  { id: "INV-2026-08", month: "August 2026", date: "2026-09-01", total: "0.00", status: "Paid", lines: [["Free plan", "0.00"]] },
]

const ORDERS = (() => {
  const st = ["Shipped", "Pending", "Delivered", "Pending", "Cancelled", "Shipped", "Delivered"]
  const out = []
  for (let i = 0; i < 97; i++) {
    const amount = ((i * 37) % 290) + 12 + (i % 3) * 0.25
    out.push({ id: `A-${1000 + i * 7}`, customer: pick(i * 5, PEOPLE), date: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, amount: amount.toFixed(2), status: pick(i, st) })
  }
  return out
})()

export function freshState() {
  return {
    outreach: { blocks: OUTREACH_START.map(([t, x]) => ({ style: t === "p" ? "normal" : t, text: x })), saves: 0 },
    settings: { email: "alice@old-domain.test", timezone: "UTC", digest: true, sms: false, language: "English", saves: 0 },
    hits: [],
  }
}

// ---------- pages ----------
const chrome = (title, app, body, script = "") => `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>body{font:14px system-ui;margin:0;display:flex;min-height:100vh}nav{width:220px;background:#f3f4f6;padding:12px}main{flex:1;padding:16px}
.row{display:flex;gap:12px;padding:6px 8px;border-bottom:1px solid #eee;cursor:pointer}.row:hover{background:#f9fafb}.muted{color:#6b7280}
header{display:flex;gap:8px;align-items:center;padding:8px 0 16px}.icon{width:18px;height:18px;display:inline-block;background:#ddd;border-radius:4px}
footer{margin-top:32px;color:#9ca3af;font-size:12px}table{border-collapse:collapse}td,th{padding:4px 10px;border-bottom:1px solid #eee;text-align:left}</style></head>
<body><nav aria-label="${esc(app)} navigation"><div><span class="icon"></span> <b>${esc(app)}</b></div>
${["Home", "Inbox", "Starred", "Snoozed", "Sent", "Drafts", "Spam", "Trash", "Categories", "Social", "Updates", "Forums", "Promotions"].map((x) => `<div><a href="#" onclick="return false"><span class="icon"></span> ${x}</a></div>`).join("")}
<div><button type="button">Compose</button></div><div><button type="button" aria-label="Settings"><span class="icon"></span></button>
<button type="button" aria-label="Help"><span class="icon"></span></button><button type="button" aria-label="Apps"><span class="icon"></span></button></div></nav>
<main>${body}<footer>${["Terms", "Privacy", "Program policies", "Last account activity: 3 minutes ago", "Details"].map((x) => `<a href="#" onclick="return false">${x}</a>`).join(" · ")}</footer></main>
${script}</body></html>`

function mailPage() {
  // (client-rendered after a delay, search filtered after a "server" delay, threads by hash: like a webmail app)
  return chrome("Inbox - Lighthouse Mail", "Lighthouse Mail", `<header><input id="q" type="search" aria-label="Search mail" placeholder="Search mail">
<button id="go" type="button">Search</button><span id="count" class="muted"></span></header><div id="list" role="list"><p class="muted">Loading…</p></div><div id="thread"></div>`,
  `<script>
let MAILS = []
let shown = MAILS
const row = (m) => '<div class="row" role="listitem" tabindex="0" data-id="' + m.id + '"><input type="checkbox" aria-label="Select"><button type="button" aria-label="Star">☆</button><b style="width:180px">' + m.from + '</b><span>' + m.subject + '</span><span class="muted"> - ' + m.body.slice(0, 60).replace(/\\n/g, " ") + '</span><span class="muted" style="margin-left:auto">' + m.date + '</span></div>'
function draw() {
  thread.innerHTML = ""
  if (location.hash.startsWith("#m")) {
    const m = MAILS.find((x) => "#" + x.id === location.hash)
    list.innerHTML = ""
    if (m) thread.innerHTML = '<article><button type="button" onclick="history.back()">Back to inbox</button><h2>' + m.subject + '</h2><p><b>' + m.from + '</b> &lt;' + m.email + '&gt; <span class="muted">' + m.date + '</span></p><div style="white-space:pre-wrap">' + m.body + '</div><button type="button">Reply</button> <button type="button">Forward</button></article>'
    return
  }
  list.innerHTML = shown.slice(0, 25).map(row).join("") + (shown.length > 25 ? '<p class="muted">Showing 25 of ' + shown.length + '</p>' : "")
  count.textContent = shown.length + " conversations"
  for (const el of list.querySelectorAll(".row")) el.onclick = (e) => { if (e.target.tagName !== "INPUT" && e.target.tagName !== "BUTTON") location.hash = el.dataset.id }
}
async function search() {
  list.innerHTML = '<p class="muted">Searching…</p>'
  shown = await (await fetch("/api/mails?q=" + encodeURIComponent(q.value))).json(); location.hash = ""; draw()
}
go.onclick = search
q.onkeydown = (e) => { if (e.key === "Enter") search() }
addEventListener("hashchange", draw)
fetch("/api/mails").then((r) => r.json()).then((m) => { MAILS = shown = m; draw() })
</script>`)
}

function drivePage() {
  return chrome("My Drive - Lighthouse Drive", "Lighthouse Drive", `<header><input id="q" type="search" aria-label="Search in Drive" placeholder="Search in Drive"><button type="button" aria-label="Grid view"><span class="icon"></span></button></header>
<h2>My Drive</h2><div id="files" role="grid" aria-label="Files"><p class="muted">Loading…</p></div>`,
  `<script>
let DOCS = []
function draw() {
  const w = q.value.toLowerCase()
  files.innerHTML = DOCS.filter((d) => d.name.toLowerCase().includes(w)).map((d) => '<div class="row" role="row"><span role="gridcell"><span class="icon"></span> <a href="/doc/' + d.id + '">' + d.name + '</a></span><span role="gridcell" class="muted">' + d.owner + '</span><span role="gridcell" class="muted">' + d.modified + '</span><span role="gridcell"><button type="button" aria-label="More actions">⋮</button></span></div>').join("")
}
q.oninput = () => setTimeout(draw, 300)
fetch("/api/files").then((r) => r.json()).then((d) => { DOCS = d; draw() })
</script>`)
}

function docPage(doc, state) {
  const blocks = doc.name === "Outreach plan" ? state.outreach.blocks : (CHECKIN[doc.name] ?? [["p", `${doc.name}: nothing much here yet.`]]).map(([t, x]) => ({ style: t === "p" ? "normal" : t, text: x }))
  const editable = doc.name === "Outreach plan"
  return chrome(`${doc.name} - Lighthouse Docs`, "Lighthouse Docs", `<header><b>${esc(doc.name)}</b>
${editable ? `<label>Style <select id="style" aria-label="Paragraph style"><option value="normal">Normal text</option><option value="h1">Heading 1</option><option value="h2">Heading 2</option><option value="h3">Heading 3</option></select></label>
<button type="button" id="bold" aria-label="Bold">B</button><button type="button" aria-label="Italic">I</button><button type="button" aria-label="Insert link">🔗</button>
<button type="button" id="save">Save</button><span id="saved" class="muted" role="status"></span>` : `<span class="muted">View only</span>`}</header>
<div id="doc" ${editable ? 'contenteditable="true"' : ""} role="textbox" aria-multiline="true" aria-label="Document content" style="max-width:720px;padding:24px;border:1px solid #e5e7eb;min-height:300px"></div>`,
  `<script>
let blocks = ${JSON.stringify(blocks)}
const tag = (s) => s === "normal" ? "p" : s
function draw() { doc.innerHTML = blocks.map((b, i) => '<' + tag(b.style) + ' data-i="' + i + '">' + b.text + '</' + tag(b.style) + '>').join("") }
draw()
${editable ? `
function current() {
  const sel = getSelection(); let n = sel.anchorNode
  while (n && n !== doc && !(n.dataset && n.dataset.i)) n = n.parentNode
  return n && n !== doc ? n : null
}
function read() { blocks = [...doc.children].map((el) => ({ style: el.tagName === "P" ? "normal" : el.tagName.toLowerCase(), text: el.textContent })) }
document.addEventListener("selectionchange", () => { const el = current(); if (el) style.value = el.tagName === "P" ? "normal" : el.tagName.toLowerCase() })
style.onchange = () => { const el = current(); if (!el) return; read(); blocks[+el.dataset.i].style = style.value; draw() }
save.onclick = async () => { read(); saved.textContent = "Saving…"; await fetch("/api/doc/outreach", { method: "POST", body: JSON.stringify(blocks) }); saved.textContent = "All changes saved" }
` : ""}
</script>`)
}

function consolePage(path) {
  const inv = INVOICES.find((x) => path === `/billing/invoices/${x.id}`)
  const side = `<div><a href="/billing">Billing overview</a></div><div><a href="/billing/invoices">Invoices</a></div><div><a href="/billing/payment">Payment methods</a></div><div><a href="/billing/subscriptions">Subscriptions</a></div>`
  let body
  if (inv) body = `<h2>Invoice ${inv.id}</h2><p>${inv.month} · issued ${inv.date} · <b>${inv.status}</b></p><table><thead><tr><th>Item</th><th>Amount (USD)</th></tr></thead><tbody>${inv.lines.map(([a, b]) => `<tr><td>${esc(a)}</td><td>$${b}</td></tr>`).join("")}</tbody><tfoot><tr><th>Total</th><th>$${inv.total}</th></tr></tfoot></table><p><a href="/billing/invoices/${inv.id}.pdf">Download PDF</a> · <a href="/billing/receipt/${inv.id}" target="_blank">View receipt</a></p>`
  else if (path.startsWith("/billing/receipt/")) body = `<h2>Receipt for ${esc(path.split("/").pop())}</h2><p>Paid with Visa ending 4242.</p>`
  else if (path === "/billing/invoices") body = `<h2>Invoices</h2><table><thead><tr><th>Invoice</th><th>Period</th><th>Issued</th><th>Total</th><th>Status</th></tr></thead><tbody>${INVOICES.map((x) => `<tr><td><a href="/billing/invoices/${x.id}">${x.id}</a></td><td>${x.month}</td><td>${x.date}</td><td>$${x.total}</td><td>${x.status}</td></tr>`).join("")}</tbody></table>`
  else if (path === "/billing/subscriptions") body = `<h2>Subscriptions</h2><p>Workers Paid: $5.00 / month, renews 2026-12-01.</p><p>R2: usage based, beyond the free tier.</p>`
  else if (path === "/billing/payment") body = `<h2>Payment methods</h2><p>Visa ending 4242</p>`
  else body = `<h2>Billing overview</h2><p>Current balance: $0.00</p><p>Last invoice: $5.03 on 2026-11-01 (<a href="/billing/invoices">see invoices</a>).</p><div id="usage" class="muted">Loading usage…</div><script>setTimeout(() => { usage.textContent = "Usage this month: Workers requests 1.2M, R2 storage 12.1 GB" }, 1200)</script>`
  return `<!doctype html><html><head><meta charset="utf-8"><title>Billing | Beacon Cloud</title><style>body{font:14px system-ui;margin:0;display:flex}nav{width:240px;background:#111827;color:#fff;padding:12px;min-height:100vh}nav a{color:#d1d5db}main{padding:16px;flex:1}td,th{padding:4px 12px;border-bottom:1px solid #eee;text-align:left}</style></head>
<body><nav aria-label="Account"><b>Beacon Cloud</b>${["Account home", "Domains", "Workers", "R2", "Analytics", "Security", "Members", "Audit log"].map((x) => `<div><a href="#" onclick="return false">${x}</a></div>`).join("")}<hr>${side}</nav><main>${body}</main></body></html>`
}

function settingsPage(state) {
  const s = state.settings
  const zones = ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Tokyo"]
  return chrome("Settings - Lighthouse", "Lighthouse", `<h2>Notification settings</h2><form id="f" style="display:grid;gap:10px;max-width:420px">
<label>Notification email <input name="email" type="email" value="${esc(s.email)}"></label>
<label>Time zone <select name="timezone">${zones.map((z) => `<option${z === s.timezone ? " selected" : ""}>${z}</option>`).join("")}</select></label>
<label>Language <select name="language">${["English", "Português", "Deutsch", "日本語"].map((z) => `<option${z === s.language ? " selected" : ""}>${z}</option>`).join("")}</select></label>
<label><input type="checkbox" name="digest"${s.digest ? " checked" : ""}> Weekly digest email</label>
<label><input type="checkbox" name="sms"${s.sms ? " checked" : ""}> Text message alerts</label>
<button type="submit">Save settings</button><p id="msg" role="status"></p></form>`,
  `<script>f.onsubmit = async (e) => { e.preventDefault(); const d = new FormData(f); msg.textContent = "Saving…"
await new Promise((r) => setTimeout(r, 600))
const r = await fetch("/api/settings", { method: "POST", body: JSON.stringify({ email: d.get("email"), timezone: d.get("timezone"), language: d.get("language"), digest: d.has("digest"), sms: d.has("sms") }) })
msg.textContent = r.ok ? "Settings saved" : "Couldn't save: " + await r.text() }</script>`)
}

function ordersPage(u) {
  const page = Math.max(1, Number(u.searchParams.get("page")) || 1), per = 20, pages = Math.ceil(ORDERS.length / per)
  const rows = ORDERS.slice((page - 1) * per, page * per)
  return chrome(`Orders (page ${page}) - Lighthouse Shop admin`, "Shop admin", `<h2>Orders</h2><table><thead><tr><th><input type="checkbox" aria-label="Select all"></th><th>Order</th><th>Customer</th><th>Date</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>
${rows.map((o) => `<tr><td><input type="checkbox" aria-label="Select ${o.id}"></td><td><a href="/orders/${o.id}">${o.id}</a></td><td>${o.customer}</td><td>${o.date}</td><td>$${o.amount}</td><td>${o.status}</td><td><button type="button" aria-label="Actions for ${o.id}">⋯</button></td></tr>`).join("")}
</tbody></table><p>Page ${page} of ${pages} ${page > 1 ? `<a href="/orders?page=${page - 1}">Previous</a>` : ""} ${page < pages ? `<a href="/orders?page=${page + 1}">Next</a>` : ""}</p>`)
}

/** Expected answers, for the checks. */
export const FACTS = {
  coverageEnd: "2026-08-31",
  pendingOver200: ORDERS.filter((o) => o.status === "Pending" && Number(o.amount) > 200).map((o) => o.id),
}

export function startSites(state = freshState()) {
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", "http://x")
    const body = await new Promise((ok) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => ok(b)) })
    state.hits.push(`${req.method} ${u.pathname}${u.search}`)
    const html = (s, code = 200) => { res.writeHead(code, { "Content-Type": "text/html; charset=utf-8" }); res.end(s) }
    if (req.method === "POST" && u.pathname === "/api/doc/outreach") { state.outreach.blocks = JSON.parse(body); state.outreach.saves++; return res.end("ok") }
    if (req.method === "POST" && u.pathname === "/api/settings") { Object.assign(state.settings, JSON.parse(body)); state.settings.saves++; return res.end("ok") }
    // (data a client-rendered page fetches, after a server's moment)
    if (u.pathname === "/api/mails" || u.pathname === "/api/files") {
      await new Promise((r) => setTimeout(r, 800))
      const w = (u.searchParams.get("q") ?? "").toLowerCase().split(/\s+/).filter(Boolean)
      const list = u.pathname === "/api/files" ? DOCS : MAILS.filter((m) => w.every((x) => `${m.from} ${m.subject} ${m.body} ${m.email}`.toLowerCase().includes(x)))
      res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(list))
    }
    if (u.pathname === "/__state") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify(state)) }
    if (u.pathname === "/mail") return html(mailPage())
    if (u.pathname === "/drive") return html(drivePage())
    if (u.pathname.startsWith("/doc/")) { const d = DOCS.find((x) => `/doc/${x.id}` === u.pathname); return d ? html(docPage(d, state)) : html("not found", 404) }
    // (a signed-in console: its pages set the session, its files need it)
    if (/^\/billing\/invoices\/.+\.pdf$/.test(u.pathname)) {
      if (!/beacon_session=ok/.test(req.headers.cookie ?? "")) { res.writeHead(401); return res.end("sign in first") }
      res.writeHead(200, { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${path.basename(u.pathname)}"` })
      return res.end("%PDF-1.4\n% made-up invoice\n")
    }
    if (u.pathname.startsWith("/billing")) { res.setHeader("Set-Cookie", "beacon_session=ok; Path=/; HttpOnly"); return html(consolePage(u.pathname)) }
    if (u.pathname === "/settings") return html(settingsPage(state))
    if (u.pathname === "/orders") return html(ordersPage(u))
    if (u.pathname.startsWith("/orders/")) { const o = ORDERS.find((x) => `/orders/${x.id}` === u.pathname); return html(o ? chrome(o.id, "Shop admin", `<h2>${o.id}</h2><p>${o.customer}, ${o.date}, $${o.amount}, ${o.status}</p>`) : "not found", o ? 200 : 404) }
    html(`<!doctype html><title>Lighthouse</title><h1>Lighthouse</h1><ul>${["/mail", "/drive", "/billing", "/settings", "/orders"].map((p) => `<li><a href="${p}">${p}</a></li>`).join("")}</ul>`)
  })
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({ server, state, url: `http://127.0.0.1:${server.address().port}` })))
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { url } = await startSites()
  console.log(url)
}
