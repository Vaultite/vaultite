import fs from "node:fs"
import path from "node:path"
import { LOCAL, localDate } from "../../../core/plugins.ts"
import type { Vault } from "../../../core/vault.ts"
import { AUTO_RULES, NEVER_READ, NEVER_RUN, readableDirs } from "./reach.ts"
import { anchorsOf, inPicture, inSummoned, type Lane, screenNear, SUMMONED_PROMPT, summonedLane } from "./summoned.ts"
import { exchanges, talkSoFar } from "./conversation.ts"
import { sitesOf } from "./guides.ts"
import { type ChatTool, chat, onChat, ALLOWED, apiCtx, toolsFor } from "./chat.ts"
import { plugin } from "./self.ts"
import type { Moment } from "./types.ts"
import { sayMs, setting, mode, agentSetting, ownName } from "./settings.ts"
import { agents, log, acts, did, key, focus, agentOf, setAgent, putNote } from "./state.ts"
import { keepSaid } from "./comments.ts"
import { takeover, screenDrawing, tours, screenFind, nearBy } from "./windows.ts"
import { answering } from "./edits.ts"
import { excerpts, awayIn, momentsText } from "./next.ts"
import { askOf, jobs } from "./wiring.ts"

/** What the summoned session has besides its words (said, its tags pointing and marking): drawing more than a mark,
 *  reading or acting on a page, following, handing off. */
export const SUMMONED_TOOLS = ["pass", "open", "page", "draw", "layer", "see", "act", "check", "follow", "clear", "handoff", "where", "jobs", "job", "job-open", "job-stop", "job-answer", "job-show", "talk", "live-undo", "conversation", "tour", "tour-save"]
/** What its words and tags become. */
const SUMMONED_ACTS = ["say", "look", "draw"]
/** Of Claude Code's own tools, the one it has: vau, to read the vault (ALLOWED's commands). */
const SUMMONED_BUILTINS = ["Bash"]
/** What it runs at once, no classifier's check keeping them waiting while they talk: the long session's commands,
 *  showing things in their window, and looking around (READ_ONLY). The rest auto mode decides, its blocks offered. */
const SUMMONED_ALLOWED = [...ALLOWED, "Bash(vau --help)", "Bash(vau open:*)", "Bash(vau commands:*)", "Bash(vau command companion:session:*)", "Bash(vau screen:*)",
  "Bash(tailscale serve status:*)", "Bash(tailscale status:*)", "Bash(lsof:*)", "Bash(git -C * log *)", "Bash(git -C * show *)"]
/** Where its read-only commands (ls, cat, grep...: Claude Code tells them from writes, redirects too) may look unasked
 *  (reach.ts), never home's dotfiles or Library (keys, cookies, mail); git's -c could run a pager, so it's refused. */
export const READ_ONLY = { dirs: readableDirs().dirs,
  denied: [`/${path.resolve(LOCAL)}`].map((d) => `Read(${d}/**)`).concat(NEVER_READ, "Bash(git * --output*)", "Bash(git * -c *)", "Bash(git * --config-env*)", "Bash(git * --exec-path*)") }
const escaped = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
/** What a command it may not run unasked becomes: a one-line offer by their pointer ("Run `…`?"), said yes to or
 *  clicked, then run; any other tool's ask, a no. Answers the keeper's gate (claude-code's chathost.ts, confirm). */
function confirmTool(name: () => string): ChatTool {
  return { name: "confirm", hidden: true, description: "", schema: {}, run: async (args) => {
    const a = (args ?? {}) as { tool?: string; input?: { command?: unknown; description?: unknown }; blocked?: boolean }
    const cmd = typeof a.input?.command === "string" ? a.input.command.trim() : ""
    if (a.tool !== "Bash" || !cmd) return { yes: false, message: "Only shell commands are offered to them: do it with your own tools, or hand it off." }
    const who = name(), what = typeof a.input?.description === "string" && a.input.description.trim() ? a.input.description.trim().replace(/\.?$/, ".") : ""
    did(who, "result", undefined, `offered: ${cmd.slice(0, 300)}`)
    const r = await takeover.confirm(`Run \`${cmd.length > 120 ? `${cmd.slice(0, 119)}…` : cmd}\`?`, `${what ? `${what} ` : ""}Say yes or click Run.`, { agent: who, tint: agentOf(who).tint })
    did(who, "result", undefined, `offer ${r.ok ? "taken" : r.why === "none" ? "not shown (no Mac's screen)" : `declined (${r.why ?? "no"})`}`)
    if (r.ok) return { yes: true }
    return { yes: false, message: r.why === "none" ? "There's no screen of theirs to ask on: tell them the command in a few words, or hand it off." : r.why === "asked"
      ? "They asked something else instead: don't run it; answer that (your next message)." : "Not run: the user said no to it on its offer. Tell them you left it, in a few words (it was their no: no hooks, blocks or approvals), and don't try it another way." }
  } }
}

/** An ask's window text it's given at most (chars), the lines by what's at their pointer first: the rest is in its
 *  picture, and every ask's text stays in its history. */
const SCREEN_CHARS = 4000
/** The model summoned asks run on; "" (the setting's companion, or an agent not Claude Code's): the long session takes them. */
export const summonedModel = () => { const m = setting("summoned_model"); return onChat(agentSetting()) && m !== "companion" ? m : "" }
/** The pictures an ask's text names, attached to its message (no Read call before its first word). */
const shotsOf = (ms: Moment[]) => [...new Set(ms.flatMap((m) => [m.shotDown, m.shot, m.closeUp?.shot].filter((f): f is string => !!f && fs.existsSync(f))))].slice(-3)
export let laneOf: { vault: Vault; lane: Lane } | null = null
export const lane = (): Lane => {
  if (laneOf?.vault === plugin.vault) return laneOf.lane
  const l = summonedLane({
    file: () => `${plugin.localDir()}/summoned.json`, chat, name: ownName, model: summonedModel,
    // (low effort: its thinking, which can't be turned off, took 1 to 2 s of each answer at the account's high)
    options: (model) => ({ cwd: plugin.vault.path, account: agentSetting().split("_")[1] || undefined, model, effort: "low", quick: true, system: SUMMONED_PROMPT,
      builtins: SUMMONED_BUILTINS, title: "Companion: summoned", by: "companion", inbox: false, mode: "auto", allowed: SUMMONED_ALLOWED,
      denied: ["Bash(vau companion:*)", ...READ_ONLY.denied], dirs: READ_ONLY.dirs, confirm: "confirm", never: [...NEVER_RUN, escaped(path.resolve(LOCAL))], autoMode: AUTO_RULES,
      tools: [...toolsFor(ownName(), SUMMONED_TOOLS, () => lane().busy()), confirmTool(ownName)] }),
    acts: () => { const [say, look, draw] = toolsFor(ownName(), SUMMONED_ACTS, () => lane().busy()); return { say, look, draw } },
    found: async (text) => {
      if (askOf(ownName())?.path) return null
      const r = await screenFind(ownName(), text).catch(() => null)
      return r ? { sx: Math.round(r.x + r.w / 2), sy: Math.round(r.y + r.h / 2) } : null
    },
    caption: (name, text) => screenDrawing.recaption(name, text),
    answered: (name, text) => {
      const ask = askOf(name), away = ask ? awayIn([ask]) : "", site = ask ? sitesOf(ask)[0] : undefined
      if (away === "a private app") return
      tours.answered(name, text, { near: (nearBy.get(key(name)) ?? []).map((e) => ({ id: e.id, role: e.role, label: e.label, frame: e.frame, inside: e.inside })),
        app: away || "vaultite", ...(site ? { site } : {}) })
    },
    text: async (ms) => {
      const slim = ms.map((m) => inPicture(m.screen ? { ...m, screen: screenNear(m.screen, anchorsOf(m), SCREEN_CHARS) } : m))
      // (when it is, as a friend beside them would know: "this morning", "last night" in the talk make sense)
      const now = new Date().toLocaleString("en-US", { weekday: "long", hour: "2-digit", minute: "2-digit", hour12: false })
      const text = [`(now: ${now})`, momentsText(slim, mode(), focus(), await excerpts(apiCtx, slim)), jobs.line()].filter(Boolean).join("\n")
      // (its picture attached, not a path: given one, it spent a turn reading it before its first word)
      const images = shotsOf(ms), named = images.reduce((t, f) => t.split(`its picture: ${f}`).join("its picture, attached to this message")
        .split(`as the key went down: ${f}`).join("as the key went down, attached before it")
        .split(`at what they pointed at: ${f}`).join("at what they pointed at, attached after its picture"), text)
      return { text: named.replace(/\(point at one: --ax <id>\)/g, "(tag one by id: [point a1], [ring a1])"), images }
    },
    agent: (name) => agents.get(key(name)), setAgent, did,
    talk: (t) => talkBefore(t),
    say: (name, text) => { const a = agents.get(key(name)), answers = inSummoned.run(true, () => answering(name))
      keepSaid(putNote({ kind: "say", agent: name, text, ...(a?.path ? { path: a.path, line: a.line } : {}), ...(answers ? { answers } : {}) }, sayMs(text))) },
  })
  laneOf = { vault: plugin.vault, lane: l }
  return l
}

/** An ask's closer look in words: where it is in its picture, and what they pointed at, drawn on it (told only where in
 *  the picture, or even in its own pixels, the model named a neighbour). */
export function closeUpText(m: Moment) {
  const c = m.closeUp!, o = m.shotAt ?? { x: 0, y: 0 }, k = c.scale
  const px = (x: number, y: number) => `${Math.round((x - c.at.x) * k)}, ${Math.round((y - c.at.y) * k)}`
  const ins = (x: number, y: number) => x >= c.at.x && y >= c.at.y && x <= c.at.x + c.at.width && y <= c.at.y + c.at.height
  const drawn = (m.ink ?? []).filter((d) => ins(d.box.x + d.box.width / 2, d.box.y + d.box.height / 2))
  const what = c.mark === "ring" ? "their ring is drawn on it in red, round the thing they mean" : c.mark === "pointer" ? "their pointer's arrow is drawn on it, its tip on the thing they mean"
    : drawn.length ? `what they drew round is at ${drawn.map((d) => `${px(d.box.x, d.box.y)} to ${px(d.box.x + d.box.width, d.box.y + d.box.height)}`).join(" and ")} in it`
    : m.sx !== undefined && m.sy !== undefined && ins(m.sx, m.sy) ? `their pointer is at ${px(m.sx, m.sy)} in it` : ""
  return `a closer look at what they pointed at: ${c.shot} (${k}× its picture's size, of its x ${c.at.x - o.x}-${c.at.x - o.x + c.at.width}, y ${c.at.y - o.y}-${c.at.y - o.y + c.at.height}${what ? `; ${what}, the thing they mean` : ""}: name it off this one, it shows what's too small in the picture, a logo, an icon, fine print; tags and points still go by the picture's pixels)`
}
/** Their Now note when they keep one (the service `now:file`, of a plugin that's on): where it is and what it says. */
export function nowNote() {
  const at = (plugin.service("now:file") as (() => string | null) | null)?.()
  const now = at ? plugin.vault.entries.get(at)?.item : null
  return now ? { path: at!, body: String(now.body ?? "").trim() } : null
}
/** What a fresh summoned session is told first: their ME.md (its start), their Now note and the talk before `t`, its
 *  last day. */
function talkBefore(t: number) {
  const days = [...new Set([localDate(t - 86_400_000), localDate(t)])]
  const xs = days.flatMap((d) => exchanges(log.read(d), acts.read(d), [], ownName())).filter((e) => e.t < t && t - e.t < 86_400_000)
  const body = String((plugin.vault.has("me") ? plugin.vault.get("me", "me") : null)?.body ?? "").trim()
  const now = nowNote()
  return { me: body.length > ME_CHARS ? `${body.slice(0, ME_CHARS)}…` : body,
    now: now?.body ? { path: now.path, body: now.body.length > NOW_CHARS ? `${now.body.slice(0, NOW_CHARS)}…` : now.body } : null, said: talkSoFar(xs, t) }
}
/** How much of ME.md a fresh summoned session is told (its first sections: who they are, how they want it), and of
 *  their Now note (all of one kept short). */
const ME_CHARS = 5000, NOW_CHARS = 3000
