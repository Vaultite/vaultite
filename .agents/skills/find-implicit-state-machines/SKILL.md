---
name: find-implicit-state-machines
description: Find state machines hiding in code (flags that must agree, timers and sockets with no owner, async completions that race) and make them explicit as a typed table of states and events with every transition logged. Use for "find the implicit state machines", flaky lifecycle bugs (stuck, double-fires, cuts out), or before changing a flow like listening, speaking, reconnecting or failover.
---

# Find implicit state machines

Prompt origin: Steve Ruiz, "find all of the implicit state machines in my app". Fix shape: Matt Pocock's reducers (events as facts, effects as data) and poteto's principle-model-the-domain (beside this one). Here: `electron/pressmachine.ts`, the Talk key's press, its moves in the press log.

## Spot one
- Two or more booleans or nullable fields that must agree (`listening`, `speaking`, `socket`, `pendingReply`). Ask "can this combination happen?" If the answer needs reasoning, the state is one machine split into pieces.
- A flag that is set or reset in several places. List every write. Each write is a transition with no name.
- Guards like `if (x && !y)` or `if (busy) return`. These are transitions that are legal in some states and silently dropped in others.
- Timers, intervals, sockets, audio nodes or child processes kept in a module variable with no state that owns them. Ask who clears them on every way out (error, cancel, a new press).
- Async completions that land after the world has moved on: a stale reply, a late `onclose`, a retry firing after cancel. Look for `await` followed by a write with no generation or id check.
- A switch on a string `status` with no `default: never`, or a status no code ever leaves (a dead end).
- `useEffect` or watcher callbacks that write state: transitions hidden in hooks.

## Report before changing
Per machine: where it lives, its states (explicit or inferred), the events, a transition table, and the bad combinations or races that are reachable now, each with a concrete sequence of steps. Rank them by the user-visible harm they cause. Prove each reported bug by running the sequence (a test or a repro) before calling it real.

## Fix it
- `type State = { kind: "idle" } | { kind: "listening"; startedAt: number } | ...`, so each state carries only the data valid in it.
- `type Event` names facts: `key-pressed`, `socket-opened`, `reply-failed`, never `set-x`.
- A pure `transition(state, event): { state; effects }` that never touches the clock or I/O (put time on the event). An event the current state doesn't handle is ignored and logged, never crashes. End with `default: never`.
- Effects are data, run by a thin runner that dispatches outcomes back as events. A timer or socket belongs to a state and is torn down on exit. Outcomes carry the attempt id, and stale ones are dropped.
- Log every transition in one place: `machine from --event--> to`.
- Test with event sequences (happy path, cancel mid-way, late completion, failover). Assert the state and the full effects list.
- No library unless it pays for itself (nested or parallel states, delayed transitions, a chart people will read). A typed table plus a switch is usually enough. For a costly race, model it (TLA+, pstack /statechart) and replay what it finds against the real code.
- Migrate every caller and delete the old flags in the same change.
