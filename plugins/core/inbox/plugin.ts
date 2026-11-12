// The Inbox's backend: each part registers its routes, ops and hooks, in this order; the services other plugins ask
// for are here, where plugin-api.md reads their docs (tools/plugin_api_doc.ts).
import * as actions from "./actions.ts"
import * as asked from "./asked.ts"
import * as block from "./block.ts"
import { hand } from "./handed.ts"
import * as hold from "./hold.ts"
import * as live from "./live.ts"
import * as ops from "./ops.ts"
import * as phone from "./phone.ts"
import { refreshWidgets } from "./phone.ts"
import * as replies from "./replies.ts"
import * as reports from "./reports.ts"
import * as results from "./results.ts"
import * as routes from "./routes.ts"
import { askGate, postEvent } from "./routes.ts"
import { FOLDER, holdNow, plugin } from "./server.ts"
import * as sessions from "./sessions.ts"
import { heard, needsYou, progressOf, type StateChange, tellSession, track } from "./sessions.ts"
import * as store from "./store.ts"
import { dropEvent, gateAnswer, list, markDone, sameKey } from "./store.ts"
import * as voice from "./voice.ts"
import * as wake from "./wake.ts"

export { plugin }
export { asThreads, byThread, previewOf } from "./model.ts"
export { prune, stillWaiting } from "./store.ts"
export { categoryOf } from "./phone.ts"
export { findEvent, pickIn, submit, typable } from "./replies.ts"
export { fromHook, settled, stillOpen } from "./sessions.ts"
export { followMachines } from "./live.ts"
export { wake } from "./wake.ts"

results.register()
store.register()
live.register()
routes.register()
wake.register()
hold.register()
phone.register()
sessions.register()
ops.register()
asked.register()
reports.register()
replies.register()
actions.register()
voice.register()
block.register()

/** Where results go (where the Inbox's files are, else Inbox/): the clipper asks (its `inbox` option), only while this
 *  plugin is on. */
plugin.provide("inbox:folder", () => plugin.vault.home("inbox") ?? FOLDER)
/** Whether the inbox is held now (inbox.hold; the menu bar's Mute for an hour): the companion says nothing on its own. */
plugin.provide("inbox:held", () => !!holdNow())
/** Whether an agent's session (by its terminal, or its own session id) has a thread that needs the user, unread:
 *  Terminal's list says so (its tab's dot, Terminals' first rows). */
plugin.provide("inbox:needs", needsYou)
/** Terminal's stream of its terminals' states. */
plugin.provide("inbox:state", (c: StateChange) => { track(heard(c)) })
/** Tell the inbox a session's state (SessionState): the thread it's in, once worked out (a turn's end is judged first). */
plugin.provide("inbox:session", tellSession)
/** Dispatch marks the terminals it starts. */
plugin.provide("inbox:handed", (terminal: string) => hand(terminal))
/** A session's latest progress, for the Agents panel's row (its terminal's or its chat's step): while it's on it. */
plugin.provide("inbox:progress", progressOf)
/** Add an event from another plugin's backend or the core (what it would POST); returns it. One asking the user, made
 *  in a session's request, says which session asked. */
plugin.provide("inbox:event", postEvent)
/** Take away the event of this source and key (what it said isn't so anymore). */
plugin.provide("inbox:drop", (source: string, key: string) => dropEvent(source, key))
/** Mark the event of this source and key done (the core's notice of a paused plugin, once it's allowed again). */
plugin.provide("inbox:done", (source: string, key: string) => markDone(new Set(list().filter((e) => sameKey(e, source, key)).map((e) => e.id))))
/** Ask the user's permission for something the server would do: a waiting event with Approve and Deny (phone and
 *  watch too), answered by the owner only. Returns its id; "inbox:answer" waits for the answer. */
plugin.provide("inbox:ask", askGate)
/** A gate's answer (approve, deny), or "waiting" once `ms` passed without one; "gone" when the event isn't kept. */
plugin.provide("inbox:answer", gateAnswer)
/** Another plugin's data the widgets show changed (a routine ticked). */
plugin.provide("widgets:refresh", refreshWidgets)
