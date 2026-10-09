import { useEffect, useState, useSyncExternalStore, type KeyboardEvent } from "react"
import { ArrowDown, ArrowUp, Plus, Send, SquareTerminal, X } from "lucide-react"
import {
  agentsOn, cn, confirmDialog, currentEditor, currentFile, currentWorkspace, definePlugin, getDefaultPlace, getStore, Group, isHidden, keyCaps, keysOf, menuFor, namedIcon, notify,
  notifyError, op, openView, otherMachines, patch, pickIcon, places, Section, setDefaultPlace, settleFile, Switch, useAgents, useCommands, useDefaultPlace, useMachines, useStore, type Agent,
  type DefaultPlace, type FileHead, type Machine, type MenuItem, type Place, type Store,
} from "@vaultite"
import type { Action } from "./types"

// Dispatch: each action is a button in a note's header (after Provenance's label), a command and a file menu item; the
// backend (plugin.ts, the op dispatch.run) starts it in a new terminal, here or on another machine, and this page opens its tab.

const dispatchable = (path: string) => /\.md$/i.test(path) && !isHidden(path)
const actionsOf = (store: Store | null): Action[] => store?.dispatch?.actions ?? []
const agentOf = (a: Action, agents: Agent[]) => (a.agent ? agents.find((x) => x.name === a.agent!.split("_")[0]) : undefined)
/** Whether its terminal opens by itself, before the server says: an agent that reports runs in the background. */
const opensOf = (a: Action) => a.open ?? !(a.agent && a.report !== false)
const iconOf = (a: Action, agents = agentsOn()) => namedIcon(a.icon) ?? agentOf(a, agents)?.icon ?? (a.command ? SquareTerminal : Send)

/** The other machines a note can go to: online, with this vault, Dispatch and Terminal. */
function elsewhere(list: Machine[] | null) {
  const vault = list?.find((m) => m.self)?.vault
  return vault ? otherMachines(list, "dispatch").filter((m) => m.vault === vault && m.plugins?.includes("terminal")) : []
}
// As the background last saw them, for the menus made on the spot: the other machines, and each agent's accounts on
// every machine (places).
let others: Machine[] = [], self = "", selfId = "", seen = false, known: Place[] = []
const subs = new Set<() => void>()
const useKnown = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f) } }, () => known)

/** Where an action can run: this machine and the others online, in each of its agent's accounts (one each, without). */
function placesOf(a: Action, there = others): Place[] {
  if (!a.agent) return []
  const name = a.agent.split("_")[0]
  return known.filter((p) => p.agent?.name === name && (!p.machine || there.some((m) => m.id === p.machine)))
}
/** The account an action runs in by itself: its own (`claude_personal`), else the agent's default. */
const ownAccount = (a: Action) => a.agent?.split("_")[1] ?? "default"

/** Where an action runs by default in the current workspace: where its new terminals and agents open (the app's
 *  default place), a machine (none: this one) and its agent's account (an action naming its own keeps that one). */
type Where = { machine?: string; account?: string }
function whereOf(a: Action, d: DefaultPlace = getDefaultPlace()): Where {
  const machine = d.machine && d.machine !== selfId ? d.machine : undefined
  const account = a.agent?.includes("_") ? undefined : a.agent ? d.accounts?.[a.agent] : undefined
  return { ...(machine ? { machine } : {}), ...(account ? { account } : {}) }
}
const isWhere = (a: Action, p: Pick<Place, "machine" | "profile">, w = whereOf(a)) => p.machine === (w.machine ?? "") && (!p.profile || p.profile === (w.account ?? ownAccount(a)))
const setWhere = (a: Action, p: Pick<Place, "machine" | "profile">) => setDefaultPlace(a.agent?.split("_")[0] ?? null, p.machine, p.profile)
/** Its places, each account on each machine; one per machine for an agent without accounts (or a command). */
function rowsOf(a: Action, there = others): Pick<Place, "machine" | "machineLabel" | "profile" | "profileLabel">[] {
  const ps = placesOf(a, there)
  return ps.length ? ps : [{ machine: "", machineLabel: self, profile: "", profileLabel: "" }, ...there.map((m) => ({ machine: m.id, machineLabel: m.label, profile: "", profileLabel: "" }))]
}
/** Where it runs by default in this workspace: "Personal · M1" (its account, the machine when several), "" for one place. */
function whereLabel(a: Action, w = whereOf(a), there = others) {
  const rows = rowsOf(a, there)
  if (rows.length < 2) return ""
  const p = rows.find((x) => isWhere(a, x, w))
  const account = p?.profileLabel ?? w.account ?? "", machine = p ? p.machineLabel : w.machine ?? ""
  return [account, there.length || w.machine ? machine : ""].filter(Boolean).join(" · ")
}

/** Save what's typed, start the action on the server (or on machine `m` through it), then open its terminal here (this
 *  device's window, focused) when it should (`open`, else the action's: an agent that reports runs in the background,
 *  a toast offering its session). */
const running = new Set<string>()
async function dispatch(a: Action, path: string, m?: Machine, account?: string, open?: boolean, again?: boolean) {
  const key = `${a.id}\n${path}\n${m?.id ?? ""}\n${account ?? ""}`
  if (running.has(key)) return
  running.add(key)
  const on = { ...(m ? { machine: m.id } : {}), ...(account && account !== ownAccount(a) ? { account } : {}), ...(again ? { again: true } : {}) }
  try {
    await settleFile(path)
    if (m) notify(`Starting ${a.label} on ${m.label}…`)
    let r: { id: string; handed?: boolean; running?: boolean }
    try { r = await op<typeof r>("dispatch.run", { path, action: a.id, open: false, ...on }) } catch (e) {
      // A command this machine hasn't run (the setting may have come by sync or a shared vault): shown, and run once confirmed.
      if (!a.command || !String((e as Error)?.message ?? "").includes("hasn't run this action's command")) throw e
      const ok = await confirmDialog({ title: `Run ${a.label}'s command?`, body: `It runs this in a new terminal on ${m?.label ?? "this machine"}:\n\n${a.command}\n\nRun it only if you set it up.`, confirm: "Run" })
      if (!ok) return
      r = await op<typeof r>("dispatch.run", { path, action: a.id, open: false, allow: true, ...on })
    }
    const show = () => openView(`terminal/${r.id}`, { newTab: true })
    // One still running for this note (a second click): its session, not another.
    if (r.running) { show(); notify(`${a.label} is still on this note: opened its session`, { action: { label: "Dispatch again", run: () => void dispatch(a, path, m, account, open, true) } }) }
    else if (open ?? a.open ?? !r.handed) show()
    else notify(`Dispatched to ${a.label}${m ? ` on ${m.label}` : ""}: its report comes to your inbox`, { action: { label: "Open session", run: show } })
  } catch (e) {
    notifyError(e, `Couldn't dispatch to ${a.label}${m ? ` on ${m.label}` : ""}`)
  } finally {
    running.delete(key)
  }
}

/** Run it where this workspace runs it by default; a machine that's away (offline, or without this vault, Dispatch or
 *  Terminal) gives way to this one, saying so. */
function dispatchHere(a: Action, path: string, open?: boolean, again?: boolean) {
  const w = whereOf(a)
  let m = w.machine ? others.find((x) => x.id === w.machine) : undefined
  if (w.machine && !m) {
    if (seen) notify(`${w.machine} can't take it now: dispatched on this machine`)
    else m = { id: w.machine, label: w.machine } as Machine // (not known yet: its server answers)
  }
  return dispatch(a, path, m, w.account, open, again)
}

/** An action in each place it can run (each account, on each machine), this machine's first, the workspace's default
 *  checked, then a submenu to change that default; [] when there's only one place. */
function onEach(a: Action, path: string, there = others): MenuItem[] {
  const Icon = iconOf(a)
  const rows = rowsOf(a, there)
  // Another session on it even while one runs (else a second dispatch opens that one).
  const again: MenuItem = { label: "Dispatch again", icon: Icon, run: () => void dispatchHere(a, path, undefined, true) }
  if (rows.length < 2) return [again]
  const row = (p: (typeof rows)[number], i: number) => ({
    label: `${a.label}${p.profileLabel ? ` · ${p.profileLabel}` : ""}`, icon: Icon, hint: p.machineLabel || undefined,
    checked: isWhere(a, p), sep: i > 0 && p.machine !== rows[i - 1].machine,
  })
  const desk = currentWorkspace()
  return [
    ...rows.map((p, i) => ({ ...row(p, i), run: () => void dispatch(a, path, there.find((x) => x.id === p.machine), p.profile || undefined) })),
    { label: desk ? `Default in ${desk.label}` : "Default", icon: Icon, sep: true, run: () => {}, items: rows.map((p, i) => ({ ...row(p, i), run: () => setWhere(a, p) })) },
    again,
  ]
}

const named = (id: string) => actionsOf(getStore()).find((a) => a.id === id)
/** The note the user means: the editor's (a sheet's over the page too), else the focused tab's. */
const target = () => currentEditor()?.path ?? currentFile()
const onNote = () => dispatchable(target())
const runOn = (id: string, m?: Machine, account?: string) => { const a = named(id); if (a) void (m || account ? dispatch(a, target(), m, account) : dispatchHere(a, target())) }
// The default action's command is fixed (the others' come and go with the settings), so its keys are known without the app.
const CLAUDE = { id: "dispatch:claude", name: "Dispatch to Claude Code", keys: ["Mod+Shift+Enter"], when: () => onNote() && !!named("claude"), run: () => runOn("claude") }

function Buttons({ file }: { file: FileHead & { place: "bar" | "line" } }) {
  const { store } = useStore()
  const agents = useAgents()
  const machines = useMachines()
  const all = useDefaultPlace()
  useKnown()
  if (!dispatchable(file.path)) return null
  const there = elsewhere(machines)
  const bar = file.place === "bar"
  return actionsOf(store).map((a) => {
    const Icon = iconOf(a, agents)
    const keys = keysOf(a.id === "claude" ? CLAUDE : { id: `dispatch:${a.id}` })[0]
    const where = whereLabel(a, whereOf(a, all), there)
    const name = `Dispatch to ${a.label}${where ? ` (${where})` : ""}`
    return (
      // Option-click: its terminal opens too.
      <button key={a.id} type="button" data-dispatch={a.id} aria-label={name} onClick={(e) => void dispatchHere(a, file.path, e.altKey || undefined)}
        // Right-click (or hold, on a phone): again, its other accounts and machines.
        onContextMenu={menuFor(() => onEach(a, file.path, there))}
        data-tip={`${name}${keys && bar ? ` (${keyCaps(keys).join("")})` : ""}${bar ? `; ${keyCaps("Alt").join("")}-click to watch it` : ""}${bar ? `; right-click to dispatch again${where ? ", in another account or on another machine, or for this workspace's default" : ""}` : ""}`}
        className={cn("flex shrink-0 cursor-pointer items-center justify-center text-muted-foreground hover:text-foreground",
          bar ? cn("h-7 rounded-[5px] hover:bg-foreground/[0.06]", where ? "gap-1 px-1.5" : "w-7")
            // (a phone's 44px target, laid out in the line's 32px)
            : "-my-1.5 size-11 active:opacity-50 md:my-0 md:size-8 md:rounded-[6px] md:hover:bg-foreground/[0.06]")}
        style={{ color: agentOf(a, agents)?.tint }}>
        <Icon className={bar ? "size-3.5" : "size-4"} strokeWidth={2.25} />
        {bar && where && <span data-dispatch-where className="max-w-40 truncate text-[12px] text-muted-foreground">{where}</span>}
      </button>
    )
  })
}

/** The other actions' commands, and each action's on every other machine online (dispatch:<id>@<machine>). */
function Commands() {
  const { store } = useStore()
  const list = actionsOf(store)
  const machines = useMachines()
  const agents = useAgents()
  const there = elsewhere(machines), here = machines?.find((m) => m.self)?.label ?? ""
  useEffect(() => { others = there; self = here; selfId = machines?.find((m) => m.self)?.id ?? ""; seen = machines !== null })
  const where = there.map((m) => `${m.id}:${m.label}`).join()
  // Each agent's accounts, here and on the machines online, for the menus and commands.
  useEffect(() => {
    let on = true
    places().then((ps) => { if (on) { known = ps; subs.forEach((f) => f()) } }, () => {})
    return () => { on = false }
  }, [where, agents.map((x) => x.name).join()])
  const ps = useKnown()
  useCommands(() => [
    ...list.filter((a) => a.id !== "claude").map((a) => ({ id: `dispatch:${a.id}`, name: `Dispatch to ${a.label}`, when: onNote, run: () => runOn(a.id), icon: iconOf(a) })),
    // In each other place: dispatch:<id>[:<account>][@<machine>] (not its own here: that one's dispatch:<id>, with its keys).
    ...list.flatMap((a) => placesOf(a, there).filter((p) => p.machine || (p.profile && p.profile !== ownAccount(a))).map((p) => {
      const m = there.find((x) => x.id === p.machine)
      const acct = p.profile && p.profile !== ownAccount(a) ? p.profile : ""
      return {
        id: `dispatch:${a.id}${acct ? `:${acct}` : ""}${m ? `@${m.id}` : ""}`, icon: iconOf(a), when: onNote, run: () => runOn(a.id, m, p.profile || undefined),
        name: `Dispatch to ${a.label}${acct ? ` (${p.profileLabel})` : ""}${m ? ` on ${m.label}` : ""}`,
      }
    })),
    // An agent without accounts: on each machine.
    ...list.filter((a) => !placesOf(a, there).length).flatMap((a) => there.map((m) => ({ id: `dispatch:${a.id}@${m.id}`, name: `Dispatch to ${a.label} on ${m.label}`, when: onNote, run: () => runOn(a.id, m), icon: iconOf(a) }))),
  ], [JSON.stringify(list), where, ps])
  return null
}

// ---------- its settings: the actions, edited in place

const field = "h-8 min-w-0 rounded-[7px] border-[0.5px] border-border bg-background px-2 text-[16px] outline-none focus:border-primary md:h-7 md:text-[14px]"
const iconBtn = "grid size-8 shrink-0 cursor-pointer place-items-center rounded-[6px] text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground disabled:cursor-default disabled:opacity-30 md:size-7"

/** A text saved when it's left (Enter too, for one line); Escape puts it back. */
function Text({ value, label, set, lines, className }: { value: string; label: string; set: (v: string) => void; lines?: boolean; className?: string }) {
  const [typed, setTyped] = useState<string | null>(null)
  const props = {
    value: typed ?? value, "aria-label": label, spellCheck: false,
    onBlur: () => { if (typed !== null && typed.trim() && typed.trim() !== value) set(typed.trim()); setTyped(null) },
    onKeyDown: (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !lines) { e.preventDefault(); e.currentTarget.blur() } else if (e.key === "Escape") { e.stopPropagation(); setTyped(null) }
    },
  }
  return lines
    ? <textarea {...props} rows={2} onChange={(e) => setTyped(e.target.value)} className={cn(field, "h-auto py-1 font-mono md:h-auto md:text-[13px]", className)} />
    : <input {...props} onChange={(e) => setTyped(e.target.value)} className={cn(field, className)} />
}

function ActionsEditor({ store }: { store: Store }) {
  const saved = actionsOf(store)
  const agents = useAgents()
  // The list as last edited here until the store brings it back, so a quick second edit builds on the first.
  const [mine, setMine] = useState<{ list: Action[]; at: number } | null>(null)
  const list = mine && Date.now() - mine.at < 5000 && JSON.stringify(mine.list) !== JSON.stringify(saved) ? mine.list : saved
  const save = (next: Action[] | null) => {
    if (next) setMine({ list: next, at: Date.now() })
    patch("config/plugin/dispatch", { actions: next }).catch((e) => notifyError(e, "Couldn't save it"))
  }
  const put = (i: number, v: Partial<Action>) => save(list.map((x, j) => (j === i ? Object.fromEntries(Object.entries({ ...x, ...v }).filter(([, y]) => y !== undefined)) as Action : x)))
  const move = (i: number, by: number) => { const next = [...list]; const [x] = next.splice(i, 1); next.splice(i + by, 0, x); save(next) }
  const add = () => {
    let n = list.length + 1
    while (list.some((a) => a.id === `action-${n}`)) n++
    save([...list, { id: `action-${n}`, label: `Action ${n}`, ...(agents[0] ? { agent: agents[0].name } : { command: "open {file}" }) }])
  }
  const custom = JSON.stringify(saved) !== JSON.stringify(store.dispatch?.defaults ?? [])
  return (
    <Section title="Actions">
      <Group>
        <div data-dispatch-actions>
          {list.map((a, i) => {
            const Icon = iconOf(a, agents)
            const runs = a.agent ?? ""
            return (
              <div key={a.id} data-dispatch-action={a.id} className="space-y-1.5 border-b-[0.5px] border-border/70 py-2 last:border-b-0">
                <div className="flex items-center gap-1.5">
                  <button type="button" className={iconBtn} aria-label={`${a.label}'s icon`} data-tip="Change its icon"
                    onClick={() => pickIcon({ title: `${a.label}'s icon`, current: a.icon, onPick: (icon) => put(i, { icon }) })}>
                    <Icon className="size-4" strokeWidth={2.25} style={{ color: agentOf(a, agents)?.tint }} />
                  </button>
                  <Text value={a.label} label="Label" set={(label) => put(i, { label })} className="flex-1" />
                  <select value={runs} aria-label="Runs" className={cn(field, "w-32 md:w-36")}
                    onChange={(e) => put(i, e.target.value
                      ? { agent: e.target.value, prompt: a.prompt, command: undefined }
                      : { agent: undefined, prompt: undefined, command: a.command ?? "open {file}" })}>
                    {agents.map((x) => <option key={x.name} value={x.name}>{x.label}</option>)}
                    {runs && !agents.some((x) => x.name === runs) && <option value={runs}>{runs}</option>}
                    <option value="">Shell command</option>
                  </select>
                  <button type="button" className={iconBtn} aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-3.5" strokeWidth={2.25} /></button>
                  <button type="button" className={iconBtn} aria-label="Move down" disabled={i === list.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-3.5" strokeWidth={2.25} /></button>
                  <button type="button" className={iconBtn} aria-label={`Remove ${a.label}`} onClick={() => save(list.filter((_, j) => j !== i))}><X className="size-3.5" strokeWidth={2.25} /></button>
                </div>
                <Text lines value={(a.agent ? a.prompt : a.command) ?? ""} label={a.agent ? "Prompt" : "Command"} className="w-full"
                  set={(t) => put(i, a.agent ? { prompt: t } : { command: t })} />
                <label className="flex min-h-9 items-center gap-2 text-[15px] md:min-h-7 md:text-[14px]">
                  <span className="flex-1">Open its terminal{a.agent && a.report !== false ? <span className="text-muted-foreground"> (else its report comes to your inbox)</span> : null}</span>
                  {/* (its default not written: an agent that reports runs in the background, the rest open) */}
                  <Switch on={opensOf(a)} label={`Open ${a.label}'s terminal`} onChange={(on) => put(i, { open: on === opensOf({ ...a, open: undefined }) ? undefined : on })} />
                </label>
              </div>
            )
          })}
          <button type="button" onClick={add} data-dispatch-add
            className="flex min-h-11 w-full cursor-pointer items-center gap-2 text-[15px] text-primary md:min-h-9 md:text-[14px]">
            <Plus className="size-4" strokeWidth={2.25} /> Add an action
          </button>
        </div>
      </Group>
      <p className="mt-1.5 flex gap-3 px-1 text-[13px] leading-[18px] text-muted-foreground">
        <span className="flex-1">Each is a button in a note's header and a command (right-click or hold it for another of your machines). {"{path}"} is the note's path in the vault, {"{file}"} its full path, {"{title}"} its name.</span>
        {custom && <button type="button" onClick={() => { setMine(null); save(null) }} data-dispatch-reset className="shrink-0 cursor-pointer text-primary">Reset</button>}
      </p>
    </Section>
  )
}

export default definePlugin({
  fileBar: { dispatch: { sort: 60, render: (file) => <Buttons file={file} /> } },
  fileMenu: (path) => (dispatchable(path) ? actionsOf(getStore()).map((a) => {
    const where = whereLabel(a)
    const it = { label: `Dispatch to ${a.label}${where ? ` (${where})` : ""}`, icon: iconOf(a), run: () => void dispatchHere(a, path) }
    const each = onEach(a, path)
    return each.length ? { ...it, split: true, items: each } : it
  }) : []),
  commands: [CLAUDE],
  background: () => <Commands />,
  settingsPanel: ({ store }) => <ActionsEditor store={store} />,
  settingsSearch: [{ label: "Dispatch actions", description: "what an agent is asked to do with a file, and its icon" }],
})
