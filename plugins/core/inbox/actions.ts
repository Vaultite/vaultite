import { choiceOf } from "../../../core/agents.ts"
import { NOT_THE_USER, type Op, OpError, quoted, splitMachine, userSurface } from "../../../core/plugins.ts"
import { isArchived, type Item, str } from "../../../core/vault.ts"
import { hold } from "./hold.ts"
import { EVENT_ID, eventFor, onOwner, pickIn } from "./replies.ts"
import { resultAt } from "./results.ts"
import { clip, DAY, holdNow, plugin } from "./server.ts"
import { parseUntil, snoozed, snoozeMs, stampOf, whenText } from "./snooze.ts"
import { fileOf, list, moveOn } from "./store.ts"

const settle: Op = {
  id: "inbox.settle",
  cli: "inbox settle",
  summary: "Settle something in the inbox: a result is archived (into Inbox/.archive/, named anew when given a title); a thread or an event is settled, out of the inbox (its report archived).",
  help: `What the user's Settle does. A result's file moves into Inbox/.archive/, out of what's to review: an agent handed a
voice note ends with it (not by editing its status: that leaves it in the inbox); with title, it's renamed too. A
session's thread (or any event, by its id) is settled: out of what needs the user, kept under Settled for keep_days, and
its report, if it has one to review, archived. Reading never does this: only settling (or the session moving on) does.
undo brings it back: a result to review, a thread open again. (inbox.done, vau inbox done: its old name.)

  vau inbox settle "Inbox/Remind me to call Alice about….md" --title "Call Alice about the trip"
  vau inbox settle lzk3p2-a1b2c3
  vau inbox settle lzk3p2-a1b2c3 --undo`,
  kind: "write",
  params: {
    item: { type: "string", required: true, description: "the result (Inbox/<Title>.md) or the event's id (vau inbox lists them)" },
    title: { type: "string", description: "a result: a better name for it, in a few words, in sentence case" },
    undo: { type: "boolean", description: "bring it back: a result to review, a thread or an event open again" },
  },
  args: ["item"],
  action: { on: ["inbox"], param: "item", label: "Settle", icon: "check-check", menu: false },
  run: async (p, ctx) => {
    const item = str(p.item).trim(), back = p.undo === true
    if (EVENT_ID.test(item)) {
      const e = await eventFor(ctx, item)
      await ctx.api("POST", "inbox/events/done", { ids: [e.id], done: !back })
      // (its report to review goes with it: the thread was its item)
      const rec = !back && fileOf(e.link) ? resultAt(fileOf(e.link)!) : undefined
      if (rec && rec.status === "new" && !isArchived(rec)) await ctx.api("PUT", `inbox/${encodeURIComponent(rec.id)}`, { status: "done" })
      return { id: e.id, title: e.title, done: !back }
    }
    await plugin.vault.sync()
    const r = resultAt(item)
    if (!r) throw new OpError(`no ${item} in the inbox`, 404)
    const title = str(p.title).replace(/\s+/g, " ").trim()
    const done = await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { status: back ? "new" : "done", ...(title ? { title } : {}) }) as Item
    return { path: `${done.id}.md`, done: !back }
  },
  text: (r) => (r.done ? `Settled: ${r.path ?? r.title}.` : `Back in the inbox: ${r.path ?? r.title}.`),
  did: (p) => ({ action: "save", text: `${p.undo ? "Brought back" : "Settled"} ${quoted(p.item)} in the inbox` }),
}

// (the old name: scripts, hooks and saved prompts call it)
const doneOp: Op = { ...settle, id: "inbox.done", cli: "inbox done", summary: "inbox.settle's old name: settle something in the inbox.", action: undefined }

const wakeOp: Op = {
  id: "inbox.wake",
  cli: "inbox wake",
  summary: "Wake something snoozed in the inbox: back now, on top (inbox.snooze --until now).",
  kind: "write",
  params: { item: { type: "string", required: true, description: "the result (Inbox/<Title>.md) or the event's id (vau inbox lists them)" } },
  args: ["item"],
  run: async (p, ctx) => {
    const item = str(p.item).trim()
    // (what isn't snoozed has nothing to wake from: said so, rather than "woken")
    const was = EVENT_ID.test(item) ? !!(await eventFor(ctx, item)).snoozed : (await plugin.vault.sync(), snoozed(resultAt(item)?.snoozed))
    return { ...(await ctx.op("inbox.snooze", { item, until: "now" })) as Item, woke: was }
  },
  text: (r) => (r.woke ? `Woken, back on top: ${r.item}.` : `Not snoozed: ${r.item}.`),
  did: (p) => ({ action: "save", text: `Woke ${quoted(p.item)} in the inbox` }),
}

const snoozeOp: Op = {
  id: "inbox.snooze",
  cli: "inbox snooze",
  summary: "Snooze something in the inbox (a result, or an event): out of the way until a time, then back on top, told again.",
  help: `What the user's Snooze does. A result keeps the time in its \`snoozed\` field (past, it's back on top); a thread or
an event is out of the lists meanwhile (still open), and news from its session brings it back early. until: tomorrow, evening, weekend, week (next Monday's
morning), a while (30m, 3h, 2d), a local time (2026-10-24 09:00), or now to bring it back.

  vau inbox snooze "Inbox/Plant care apps compared.md" --until tomorrow
  vau inbox snooze lzk3p2-a1b2c3 --until 3h`,
  kind: "write",
  params: {
    item: { type: "string", required: true, description: "the result (Inbox/<Title>.md) or the event's id (vau inbox lists them)" },
    until: { type: "string", required: true, description: "when it comes back: tomorrow, evening, weekend, week, 3h, 2d, 2026-10-24 09:00, or now" },
  },
  args: ["item"],
  run: async (p, ctx) => {
    const item = str(p.item).trim(), now = /^(now|off|none)$/i.test(str(p.until).trim())
    const at = now ? null : parseUntil(str(p.until))
    if (!now && !at) throw new OpError(`\`until\`: ${quoted(str(p.until))} isn't a time (tomorrow, evening, weekend, week, 3h, 2d, 2026-10-24 09:00, now)`)
    if (at && at.getTime() <= Date.now()) throw new OpError("`until`: that time has passed")
    if (EVENT_ID.test(item)) {
      await ctx.api("POST", "inbox/events/snooze", { ids: [item], until: at ? at.getTime() : null })
      return { item, until: at ? stampOf(at) : null, when: at ? whenText(at) : null }
    }
    await plugin.vault.sync()
    const r = resultAt(item)
    if (!r || r.status !== "new" || isArchived(r)) throw new OpError(`no ${item} to review in the inbox`, 404)
    if (!at && !snoozed(r.snoozed)) return { item: `${r.id}.md`, until: null, when: null }
    await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { snoozed: stampOf(at ?? new Date()) })
    return { item: `${r.id}.md`, until: at ? stampOf(at) : null, when: at ? whenText(at) : null }
  },
  text: (r) => (r.until ? `Snoozed until ${r.when} (${r.until}): ${r.item}.` : `Back in the inbox: ${r.item}.`),
  did: (p) => ({ action: "save", text: `Snoozed ${quoted(p.item)} in the inbox` }),
}

const pinOp: Op = {
  id: "inbox.pin",
  cli: "inbox pin",
  summary: "Pin something in the inbox (a result, or a thread or an event) on top of it, whatever it waits on, until it's done or unpinned.",
  help: `What the user's Pin does: it stays on top of the inbox, under Pinned, while it's to review or open, an agent works on
it or it's read; done (or archived) unpins it. off unpins it.

  vau inbox pin "Inbox/Plant care apps compared.md"
  vau inbox pin lzk3p2-a1b2c3 --off`,
  kind: "write",
  params: {
    item: { type: "string", required: true, description: "the result (Inbox/<Title>.md) or the event's id (vau inbox lists them)" },
    off: { type: "boolean", description: "unpin it" },
  },
  args: ["item"],
  run: async (p, ctx) => {
    const item = str(p.item).trim(), on = p.off !== true
    if (EVENT_ID.test(item)) {
      const e = await eventFor(ctx, item)
      if (on && e.state === "done") throw new OpError(`${item} is settled: bring it back first (vau inbox settle ${item} --undo)`)
      await ctx.api("POST", "inbox/events/pin", { ids: [e.id], pinned: on })
      return { item: e.id, title: e.title, pinned: on }
    }
    await plugin.vault.sync()
    const r = resultAt(item)
    if (!r || r.status !== "new" || isArchived(r)) throw new OpError(`no ${item} to review in the inbox`, 404)
    await ctx.api("PUT", `inbox/${encodeURIComponent(r.id)}`, { pinned: on || null })
    return { item: `${r.id}.md`, title: r.title, pinned: on }
  },
  text: (r) => `${r.pinned ? "Pinned" : "Unpinned"}: ${r.title ?? r.item}.`,
  did: (p) => ({ action: "save", text: `${p.off ? "Unpinned" : "Pinned"} ${quoted(p.item)} in the inbox` }),
}

const holdOp: Op = {
  id: "inbox.hold",
  cli: "inbox hold",
  summary: "Hold the inbox: nothing is told (toasts, the Mac's and the phone's notifications) until a time, then one line of what came meanwhile.",
  help: `Do not disturb for the inbox, on every machine: events and results still come in, unread, told of only when it ends.
until: a while (30m, 2h), a time today (07:30), a local time (2026-10-24 09:00), or off to end it now; left out: the
hold on now, if any. label says what for ("Practice guitar"), in the line at its end.

  vau inbox hold 30m --label "Practice guitar"
  vau inbox hold off`,
  kind: "write",
  params: {
    until: { type: "string", description: "when it ends: 30m, 2h, 07:30, 2026-10-24 09:00, or off; left out: the hold on now" },
    label: { type: "string", description: "what it's for, a few words" },
  },
  args: ["until"],
  run: async (p, ctx) => {
    const v = str(p.until).trim()
    if (!v) return { hold: holdNow() }
    const why = await ctx.refusal?.("the inbox")
    if (why) throw new OpError(why, 403)
    if (/^(off|now|none)$/i.test(v)) { hold(null); return { hold: null } }
    const at = parseUntil(v)
    if (!at) throw new OpError(`\`until\`: ${quoted(v)} isn't a time (30m, 2h, 07:30, 2026-10-24 09:00, off)`)
    if (at.getTime() <= Date.now()) throw new OpError("`until`: that time has passed")
    if (at.getTime() - Date.now() > DAY) throw new OpError("`until`: at most a day away")
    return { hold: hold(at, clip(p.label, 60)) }
  },
  text: (r) => (r.hold ? `Held until ${whenText(new Date(snoozeMs(r.hold.until)))}${r.hold.label ? ` (${r.hold.label})` : ""}: told of what came then.` : "Not held."),
  did: (p) => ({ action: "save", text: str(p.until) ? `Held the inbox: ${str(p.until)}` : "Read the inbox's hold" }),
}

const readOp: Op = {
  id: "inbox.read",
  cli: "inbox read",
  summary: "Mark the inbox's events read (seen: no longer bold), some by id (vau inbox lists them) or all. A message is done once read; a thread stays until it's settled (inbox.settle).",
  kind: "write",
  params: { ids: { type: "array", items: { type: "string" }, description: "the events' ids; none: every event" } },
  args: ["ids"],
  run: async ({ ids }, ctx) => ({ ...(await ctx.api("POST", "inbox/events/read", ids?.length ? { ids } : {})), all: !ids?.length }),
  text: (r) => (r.all ? "Every event is read." : `Read. ${r.unread} unread.`),
  did: ({ ids }) => ({ action: "save", text: ids?.length ? `Marked ${ids.length} inbox event${ids.length === 1 ? "" : "s"} read` : "Marked the inbox read" }),
}

const unreadOp: Op = {
  id: "inbox.unread",
  cli: "inbox unread",
  summary: "Mark events unread by hand: they stay unread when the Inbox is seen, until opened or marked read (a message read is back in the inbox).",
  kind: "write",
  params: { ids: { type: "array", items: { type: "string" }, required: true, description: "the events' ids (vau inbox lists them)" } },
  args: ["ids"],
  run: async ({ ids }, ctx) => {
    if (!ids.length) throw new OpError("which events: their ids (vau inbox lists them)")
    return await ctx.api("POST", "inbox/events/unread", { ids })
  },
  text: (r) => `Unread. ${r.unread} unread.`,
  did: ({ ids }) => ({ action: "save", text: `Marked ${ids.length || "some"} inbox event${ids.length === 1 ? "" : "s"} unread` }),
}

const clearOp: Op = {
  id: "inbox.clear",
  cli: "inbox clear",
  summary: "Forget the inbox's events: every one, or only the settled ones (results in Inbox/ stay).",
  kind: "destructive",
  params: { done: { type: "boolean", description: "only the settled ones" } },
  run: async ({ done }, ctx) => ({ ...(await ctx.api("DELETE", `inbox/events${done ? "?done=1" : ""}`)), done: !!done }),
  text: (r) => (r.done ? "Forgot the settled events." : "Forgot every event."),
  did: ({ done }) => ({ action: "delete", text: done ? "Cleared the inbox's settled events" : "Cleared the inbox's events" }),
}

const answerOp: Op = {
  id: "inbox.answer",
  cli: "inbox answer",
  summary: "Answer an event, as its notification's buttons do: approve or deny the permission an agent waits on, pick answers to its questions, reply to a session that needs you, mark it done, or read.",
  help: `approve and deny press the keys the agent's plugin gives for the question its terminal shows (Claude Code's
permission: Enter, its first choice Yes, or Escape): for an agent asking permission in an app terminal (the event's ask
is permission) while its terminal still shows the question, or a question the server waits on (an app's tool). reply
(with text) is inbox.reply to its session (to a session asking one question, its answer). pick answers the questions it
asks (the event's questions): picks, one per question, an option's number or name (several, comma-separated, in a
multi-select), or text typed as its own answer; typed, one per question, what's typed in its Type something row (with a
multi-select's picks; "" for none). chat is its Chat about this: the questions put aside, it asks what to clarify (not
for a closed question, a dialog's). approve, deny, pick and chat are the user's alone: only from the app or their
phone, never an agent nor vau. Approved, denied, picked or replied to, a session's thread is working (its agent goes on);
settle settles it (inbox.settle; done, its old name), read only marks it read. A session run outside a terminal is answered by its host
(agent-reply:<agent>, agent-answer:<agent>). Another machine's event is answered there, where its session runs; a bare
id from a notification another machine sent is found too.

  vau inbox answer lzk3p2-a1b2c3 approve
  vau inbox answer lzk3p2-a1b2c3 pick --picks 2
  vau inbox answer lzk3p2-a1b2c3 pick --picks "Local cert" --picks "1,3"
  vau inbox answer lzk3p2-a1b2c3 pick --picks "1,3" --typed "Feta"
  vau inbox answer lzk3p2-a1b2c3 chat
  vau inbox answer lzk3p2-a1b2c3 reply --text "Yes, the second one"`,
  kind: "write",
  params: {
    id: { type: "string", required: true, description: "the event's id (vau inbox lists them)" },
    answer: { type: "string", enum: ["approve", "deny", "pick", "chat", "reply", "settle", "done", "read"], required: true, description: "approve, deny, pick, chat (Chat about this), reply, settle (done, its old name) or read" },
    picks: { type: "array", items: { type: "string" }, description: "with pick: an answer for each question, in order" },
    typed: { type: "array", items: { type: "string" }, commas: false, description: "with pick: what's typed in each question's Type something row, in order (\"\" for none)" },
    text: { type: "string", description: "with reply: what to tell it" },
  },
  args: ["id", "answer"],
  run: async ({ id, answer, text, picks, typed }, ctx) => {
    const e = await eventFor(ctx, id)
    // (a gate, an agent's permission or its questions: the user's alone, never an agent saying yes to itself or another)
    if (((answer === "approve" || answer === "deny") && (e.gate || e.ask === "permission") || answer === "pick" || answer === "chat") && !userSurface(ctx.who)) throw new OpError(NOT_THE_USER, 403)
    const bare = splitMachine(e.id)[0]
    if (e.machine) return onOwner(ctx, e, "inbox.answer", { id: bare, answer, ...(text ? { text } : {}), ...(picks?.length ? { picks } : {}), ...(typed?.length ? { typed } : {}) })
    if (answer === "reply") return { id: e.id, answer, title: e.title, ...(await ctx.op("inbox.reply", { to: e.id, text: str(text) })) }
    if (answer === "settle" || answer === "done") return { id: e.id, answer, title: e.title, ...(await ctx.op("inbox.settle", { item: e.id })) }
    if (answer === "read") {
      await ctx.api("POST", "inbox/events/read", { ids: [e.id] })
      return { id: e.id, answer, title: e.title, terminal: e.terminal ?? null }
    }
    const host = e.host && e.session ? plugin.service(`agent-answer:${e.source}`) as ((session: string, a: Item) => Promise<boolean>) | null : null
    if (answer === "pick" || answer === "chat") {
      const given = answer === "chat" ? "chat" as const : (picks ?? []).map(str), texts = (typed ?? []).map(str)
      if (!host) return { id: e.id, answer, title: e.title, ...(await pickIn(ctx, e, given, texts)) }
      const qs = e.questions ?? []
      if (!qs.length || e.state !== "open") throw new OpError("it doesn't ask anything to pick from now", 409)
      if (given !== "chat" && given.length !== qs.length) throw new OpError(`\`picks\`: an answer for each of its ${qs.length} questions`)
      const a = given === "chat" ? { chat: true } : { picks: qs.map((q, i) => choiceOf(q, given[i], texts[i])) }
      if (!(await host(e.session!, a))) throw new OpError("its session no longer asks that", 409)
      moveOn(list().filter((x) => x.id === e.id), "working")
      return { id: e.id, answer, title: e.title, terminal: null }
    }
    if (e.gate) {
      await ctx.api("POST", `inbox/events/${encodeURIComponent(e.id)}/answer`, { answer })
      return { id: e.id, answer, title: e.title, terminal: null }
    }
    if (e.ask !== "permission" || e.kind === "info" || !(e.terminal || host)) throw new OpError("only an agent asking permission can be approved or denied", 409)
    if (e.state !== "open") throw new OpError("it was answered already", 409)
    if (host) {
      if (!(await host(e.session!, { answer }))) throw new OpError("its session no longer asks that", 409)
    } else await ctx.api("POST", `terminals/${encodeURIComponent(e.terminal!)}/answer`, { answer, agent: e.source })
    moveOn(list().filter((x) => x.id === e.id), "working")
    return { id: e.id, answer, title: e.title, terminal: e.terminal ?? null }
  },
  text: (r) => (r.answer === "read" ? `Read: ${r.title}.` : r.answer === "settle" || r.answer === "done" ? `Settled: ${r.title}.` : r.answer === "reply" || r.answer === "pick" || r.answer === "chat" ? `Sent${r.terminal ? ` to ${r.terminal}` : ""}.`
    : `${r.answer === "approve" ? "Approved" : "Denied"}${r.terminal ? ` in ${r.terminal}` : `: ${r.title}`}.`),
}

const pushOp: Op = {
  id: "inbox.push",
  cli: "inbox push",
  summary: "Send a notification to the user's phone (and watch) now, not kept in the inbox: to try push, or for what can't wait.",
  help: `For news worth keeping, vau notify (an event: in the inbox, and pushed too). Needs push set up on the server's machine
(vau docs inbox).

  vau inbox push "Backup finished" --body "12 GB, 4 min"`,
  kind: "write",
  params: {
    title: { type: "string", required: true, description: "what it says, one line" },
    body: { type: "string", description: "a line or two more" },
  },
  args: ["title"],
  run: async ({ title, body }, ctx) => await ctx.api("POST", "inbox/push", { title, body }),
  // (no phone or watch signed up yet: nothing went anywhere, and it says so)
  text: (r) => (!r.sent && !r.failed.length ? "Nothing sent: no phone has signed up for notifications on this machine yet (the iPhone app does, once it connects; the watch shows the phone's)."
    : `Sent to ${r.sent} device${r.sent === 1 ? "" : "s"}${r.failed.length ? `; failed: ${r.failed.join(", ")}` : ""}.`),
}

export function register() {
  plugin.op(settle)
  plugin.op(doneOp)
  plugin.op(wakeOp)
  plugin.op(snoozeOp)
  plugin.op(pinOp)
  plugin.op(holdOp)
  plugin.op(readOp)
  plugin.op(unreadOp)
  plugin.op(clearOp)
  plugin.op(answerOp)
  plugin.op(pushOp)
}
