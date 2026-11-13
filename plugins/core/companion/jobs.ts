import type { Who } from "../../../core/ops.ts"
import { parseTerminal, resumeTerminalId } from "../../../core/terminalids.ts"
import type { Going, JobEvent } from "./joblife.ts"
import type { JobAsk } from "./types.ts"

export const str = (v: unknown) => (typeof v === "string" ? v : "")
export const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e))
export type Handoff = { task?: string; say?: string; agent?: string; account?: string; model?: string; effort?: string; title?: string; cwd?: string; repo?: string
  about?: string; machine?: string; job?: string; land?: boolean; ask?: boolean; which?: string; on?: string; page?: boolean }
export const JOB_STATES = ["waiting", "starting", "working", "needs you", "ready for review", "done", "failed", "stopped"] as const
export type JobState = typeof JOB_STATES[number]
export const NEWS = new Set<JobState>(["needs you", "ready for review", "done", "failed"])
export const live = (s: JobState) => s === "waiting" || s === "starting" || s === "working" || s === "needs you"
export const onMain = (j: Pick<Job, "land"> & Partial<Pick<Job, "log">>) => !!j.land?.merged || j.log?.at(-1)?.ev === "landed"
export const landable = (j: Pick<Job, "state" | "where" | "result" | "land"> & Partial<Pick<Job, "log">>) =>
  (j.state === "ready for review" || j.state === "done") && !!j.where.repo && !!(j.result?.diff || j.result?.files?.length) && !onMain(j)
export function landTask(w: Pick<Where, "cwd" | "tree" | "branch" | "live" | "cloud">) {
  return `They watched your change and kept it: merge it now${mergeSteps(w)}`
}
function mergeSteps(w: Pick<Where, "cwd" | "tree" | "branch" | "live" | "cloud">) {
  const rules = "as this repo's own rules say (its CLAUDE.md, AGENTS.md or CONTRIBUTING: the checks to run first, how a branch lands, and whether to push or deploy; a step those rules keep for the user still waits for them)"
  const end = `Start your last message with "Merged:" and ${(w.live && w.tree) || w.cloud ? "its commit's hash on main" : "where it landed"}, in a line, or with "Not merged:" and why.`
  if (w.cloud) return `, from your session's branch, ${rules}: rebase onto origin/main, squash it to one commit and git push origin HEAD:main (or its PR, when the rules land by one). Don't wait for it to go live, whatever its rules say for sessions run by hand (no vau version --wait): Vaultite, which follows this session, waits for that and sends CI's failures on it back to you. ${end}`
  if (!w.tree) return `, ${rules}. ${end}`
  const taken = " (the server takes main itself, and waits for it to go live: don't wait yourself, whatever its rules say for sessions run by hand (no vau version --wait); it sends CI's failures on it back to you)"
  return `, from your worktree ${w.tree} (branch ${w.branch}), ${rules}. Never switch or edit ${w.cwd}${w.live ? " (the running server's own checkout: nothing lands there)" : ""}: with a remote, rebase onto its main, squash it to one commit and git push origin HEAD:main (or its PR, when the rules land by one)${w.live ? taken : ""}; with none, ${w.live ? "don't merge" : "squash-merge it into that checkout only if it's clean"}. Then git -C ${w.cwd} worktree remove ${w.tree}, and branch -D ${w.branch}. ${end}`
}
export function fixTask(w: Pick<Where, "cwd" | "tree" | "branch" | "live" | "cloud">, commit: string, why: string) {
  const tree = w.tree ? `make your worktree again from main (${treeAgain(w)}), `
    : w.cloud ? "start your branch again from main (git fetch origin, then git checkout -B <your branch> origin/main), " : ""
  return `CI failed on ${commit.slice(0, 12)}, the commit you landed, so it isn't live (${why}). Fix it forward: ${tree}find what failed (gh run list --commit ${commit}, then gh run view <its id> --log-failed), fix it, and land the fix${mergeSteps(w)}`
}
const treeAgain = (w: Pick<Where, "cwd" | "tree" | "branch">) => `git -C ${w.cwd} fetch origin, then git -C ${w.cwd} worktree add -B ${w.branch} ${w.tree} origin/main`
export const prunedLine = (w: Pick<Where, "cwd" | "tree" | "branch">) =>
  `(Your worktree ${w.tree} was removed once you were done, nothing in it lost: to change anything, make it again first: git -C ${w.cwd} worktree add ${w.tree} ${w.branch}, or with that branch gone (it was on main), ${treeAgain(w)}.)`
export function mergedCommit(text: string) {
  const at = text.search(/\bmerged\b/i)
  return (at >= 0 ? commitsIn(text.slice(at))[0] : undefined) ?? commitsIn(text)[0] ?? ""
}
export function mergedSaid(text: string): boolean | null {
  const t = text.replace(/^[\s*_#>`]+/, "").toLowerCase()
  if (/^(?:not merged|couldn'?t merge|didn'?t merge|can'?t merge)\b/.test(t)) return false
  return /^merged\b/.test(t) ? true : null
}
export const commitsIn = (text: string) => [...new Set(text.match(/(?<![\w/.-])[0-9a-f]{7,40}(?![\w/-]|\.\w)/g) ?? [])].filter((h) => /[a-f]/.test(h) && /\d/.test(h)).slice(0, 8)
export const TURN_QUIET_MS = 30_000
export function turnWord(t: { text: string; at: number; final: boolean } | null | undefined, now: number): "working" | "idle" | undefined {
  if (!t || (!t.text && t.final)) return undefined
  return !t.final ? "working" : now - t.at >= TURN_QUIET_MS ? "idle" : undefined
}
export function landedSaid(text: string): boolean {
  if (mergedSaid(text)) return true
  return text.split(/\n|(?<=[.!?;])\s+/).some((line) => {
    const l = line.replace(/[*_`#>]+/g, "").trim()
    if (/^(?:[-•]\s*)?merged:/i.test(l)) return true
    const m = /\b(?:merged|pushed|landed|squashed)\b(?:\s+\S+){0,4}?\s+(?:to|on|onto|into)\s+(?:origin\/)?(?:main|master)\b|\b(?:is|are|it's|now)\s+(?:live\s+)?on\s+(?:origin\/)?(?:main|master)\b/i.exec(l)
    return !!m && !/\b(?:not|never|no|won't|isn't|aren't|wasn't|didn't|can't|couldn't|once|until|unless|if|when|after|before|would|will|should|to be)\b|n't\b/i.test(l.slice(0, m.index + m[0].length))
  })
}
export const terminalOf = (j: Pick<Job, "terminal" | "where">) => `${j.terminal}${j.where.machine ? `@${j.where.machine}` : ""}`
export const cloudPage = (session: string) => `https://claude.ai/code/${session}`

export type Where = { machine: string; label: string; cwd: string; repo: string; agent: string; account: string; harness: string; model: string; effort: string
  why: string; base?: string; preview?: string
  moved?: string
  carried?: boolean
  tree?: string; branch?: string; live?: boolean
  lands?: boolean
  watched?: boolean
  cloud?: boolean }
export type Result = { text?: string; files?: string[]; diff?: string; pr?: string; link?: string }
export type Transition = { t: number; ev: JobEvent; from: JobState; to: JobState }
export type Last = { text: string; at: number; told?: string; asks?: string[]; background?: number
  by?: string }
export type Tell = { at: number; by: string; text: string }
export type Waits = { kind: "permission" | "question"; question: string; choices: string[]; at: number }
export const inPlace = (w: Pick<Where, "repo" | "preview" | "live" | "moved">) => !!w.repo && !!w.preview && !w.live && !w.moved

export type Marks = { whole: string; each: string[] }
export type Queued = { note: string; text: string; at: number; shown?: string; land?: boolean; title?: string; start?: Handoff; ask?: JobAsk; by?: Who; teller?: string }
export type Job = {
  id: string; title: string; state: JobState; where: Where
  queued?: Queued[]
  terminal: string
  unreachable?: string
  by?: string; tells?: Tell[]
  session?: string; exited?: number; closed?: number
  pruned?: number
  held?: boolean
  on?: string
  last?: Last
  waits?: Waits
  now: string
  asked?: number; started: number; carded?: number; stepped?: number; turn: number; at: number
  result?: Result
  land?: { asked: number; at?: number; merged?: boolean }
  going?: Going
  marks?: Marks
  seen: boolean
  log: Transition[]
}

export function jobSpoken(j: Pick<Job, "title" | "state">, from: string) {
  if (from === j.state) return ""
  const words = j.title.replace(/\s+/g, " ").trim().split(" ").slice(0, 6)
  while (words.length > 1 && /^(the|a|an|on|of|to|in|for|and|with|at|by)$/i.test(words.at(-1)!)) words.pop()
  const what = words.join(" ").replace(/[.:,;]+$/, "")
  const job = what ? `The job "${what}"` : "A job"
  return j.state === "needs you" ? `${job} needs you.` : j.state === "ready for review" ? `${job} is ready for review.`
    : j.state === "done" && from !== "ready for review" ? `${job} is done.` : j.state === "failed" ? `${job} failed.` : ""
}

export const unseen = (j: Job) => NEWS.has(j.state) && !j.seen
export function resumeOf(j: Pick<Job, "session" | "where">) {
  const [name, profile] = j.where.agent.split("_")
  return j.session && parseTerminal(`${j.where.agent}-x`) ? resumeTerminalId(name, j.session, profile) : ""
}
export const linkOf = (j: Pick<Job, "terminal" | "where">) => (j.where.cloud ? `view:web/${cloudPage(j.terminal)}` : `view:terminal/${j.terminal}${j.where.machine ? `@${j.where.machine}` : ""}`)
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s)
const base = (p: string) => p.replace(/\/+$/, "").split("/").pop() || p
export const whereLine = (w: Where) => [w.label, w.repo || base(w.cwd), w.account, w.harness].filter(Boolean).join(", ")
export function took(j: Job, now = Date.now()) {
  const s = Math.max(0, ((live(j.state) ? now : j.at) - j.started) / 1000)
  return s < 60 ? `${Math.round(s)} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`
}
const ago = (t: number, now = Date.now()) => { const s = (now - t) / 1000; return s < 60 ? "just now" : s < 3600 ? `${Math.round(s / 60)} min ago` : `${(s / 3600).toFixed(1)} h ago` }
const plain = (s: string) => s.replace(/[*_`#>]+/g, "").replace(/\s+/g, " ").trim()
export function gist(text: string, n = 140) {
  const para = plain(text.trim().split(/\n\s*\n/)[0] ?? "")
  const first = /^.{12,}?[.!?](?=\s|$)/.exec(para)?.[0] ?? para
  return cut(first, n)
}
export const questionsIn = (text: string) => text.trim().split(/\n\s*\n/).slice(-2).join("\n").replace(/"[^"\n]*"|“[^”\n]*”/g, "\"\"").split("\n")
  .flatMap((l) => plain(l).match(/[^.!?]*[A-Za-z][^.!?]*\?/g) ?? []).map((q) => cut(q.trim(), 200)).filter((q) => q.split(" ").length >= 3).slice(-3)
export const HANDED = "You're a job they handed off"
export function lastOf(t: { text: string; at: number; final?: boolean; prompt?: string; background?: number }, asks?: string[]): Last {
  const told = t.prompt && !t.prompt.includes(HANDED) ? cut(plain(t.prompt), 300) : ""
  const q = asks?.length ? asks : t.final ? questionsIn(t.text) : []
  return { text: t.text.slice(0, 4000), at: t.at, ...(told ? { told } : {}), ...(q.length ? { asks: q } : {}), ...(t.background ? { background: t.background } : {}) }
}
const tellKey = (s: string) => plain(s).toLowerCase().slice(0, 80)
export function toldBy(j: Pick<Job, "tells" | "started">, prompt: string, typed = 0) {
  const k = tellKey(prompt), hit = k ? j.tells?.findLast((t) => tellKey(t.text) === k) : undefined
  return hit ? hit.by : typed > (j.tells?.at(-1)?.at ?? j.started) ? "you, in its terminal" : ""
}
const toldLast = (j: Job) => (j.tells?.length ? `told last by ${j.tells.at(-1)!.by}` : j.by ? `handed off by ${j.by}` : "")
const tellsLine = (j: Job, now: number) => (j.tells?.length ? `told (by whom, oldest first): ${j.tells.slice(-4).map((t) => `${t.by}, ${ago(t.at, now)}: "${cut(plain(t.text), 100)}"`).join(" | ")}` : "")

export function nowOf(j: Pick<Job, "title" | "turn" | "last" | "now">, s: { kind?: string; msg?: string; title?: string; state?: string }) {
  if (s.kind) return `waits on ${s.kind === "permission" ? "a permission" : s.kind === "question" ? "an answer" : s.kind}${s.msg ? `: ${s.msg}` : ""}`
  const n = j.last?.background ?? 0
  if (n && (s.state === "idle" || s.state === "done")) return `waits on ${n === 1 ? "its task" : `its ${n} tasks`} in the background${j.last!.text ? `: ${gist(j.last!.text)}` : ""}`
  if (j.last?.text && j.last.at >= j.turn - 1000) return gist(j.last.text)
  const title = (s.title ?? "").replace(/^[^\p{L}\p{N}]+/u, "").trim()
  return s.msg || (title && title !== j.title ? title : "") || j.now
}

export function queuedLine(j: Pick<Job, "queued" | "where" | "state">) {
  const q = j.queued ?? [], ups = q.filter((x) => !x.start).length
  if (!q.length) return ""
  const back = `Waiting for ${j.where.label || "its machine"} to come back`
  return q.some((x) => x.start) ? `${back} to start${ups ? `, with ${ups} more for it` : ""}` : `${back} to pass on ${ups === 1 ? "a follow-up" : `${ups} follow-ups`}`
}

export const resultLine = (r?: Result) => (r ? [r.diff, r.pr, r.link].filter(Boolean).join(" · ") : "")
const saidOf = (j: Job) => (j.last?.text ? j.last : j.result?.text ? { text: j.result.text, at: j.at } : null)

export type JobCard = { id: string; title: string; state: JobState; link: string; unseen: boolean; at: number; started: number; ended?: number; where: string; now: string; took: string; result: string
  why?: string
  waits?: { question: string; choices: string[] } }
const unreachableLine = (j: Pick<Job, "unreachable" | "state">) => (j.unreachable && live(j.state) ? `Can't be reached: ${j.unreachable}` : "")
export const cardOf = (j: Job, now = Date.now()): JobCard => ({ id: j.id, title: j.title, state: j.queued?.length || unreachableLine(j) ? "waiting" : j.state, link: j.terminal ? linkOf(j) : "", unseen: unseen(j), at: j.at, started: j.started,
  ...(live(j.state) ? {} : { ended: j.at }), ...(j.state === "needs you" && j.waits ? { waits: { question: j.waits.question, choices: j.waits.choices } } : {}),
  where: whereLine(j.where), ...(j.where.why ? { why: j.where.why } : {}), now: queuedLine(j) || unreachableLine(j) || j.now, took: took(j, now),
  result: resultLine(j.result) || cut((j.result?.text ?? "").replace(/\s+/g, " ").trim(), 200) })

const YES = /^(yes|y|yeah|yep|approve|allow|ok|okay|trust|accept|sure)$/i, NO = /^(no|n|nope|deny|reject|refuse|exit|disable|don't|cancel)$/i
export function choiceIn(w: Pick<Waits, "kind" | "choices">, given: string) {
  const said = given.trim().replace(/[.!]+$/, "").replace(/\s+/g, " ").toLowerCase(), names = w.choices.map((c) => c.toLowerCase().replace(/\s*\(recommended\)$/, ""))
  if (/^\d+$/.test(said)) return Number(said) >= 1 && Number(said) <= w.choices.length ? Number(said) : 0
  const exact = names.indexOf(said), starts = names.flatMap((n, i) => (said && n.startsWith(said) ? [i] : []))
  if (exact >= 0) return exact + 1
  if (starts.length === 1) return starts[0] + 1
  return w.kind === "permission" && w.choices.length === 2 ? (YES.test(said) ? 1 : NO.test(said) ? 2 : 0) : 0
}
export const waitsLine = (w: Waits) => `"${cut(w.question, 160)}"${w.choices.length ? ` (${w.choices.map((c, i) => `${i + 1}. ${cut(c, 60)}`).join(" | ")})` : " (in its terminal only)"}`

export function linksIn(text: string, preview?: string): Pick<Result, "pr" | "link"> {
  const pr = /https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/.exec(text)?.[0]
  const link = /\bhttps?:\/\/(?:localhost|127\.0\.0\.1|[\w-]+(?:\.[\w-]+)*\.ts\.net)(?::\d+)?(?:\/[^\s)>"'`]*)?/.exec(text)?.[0] ?? preview
  return { ...(pr ? { pr } : {}), ...(link ? { link: link.replace(/[.,;:]+$/, "") } : {}) }
}

function askLines(m: JobAsk | undefined) {
  const named = !!m?.appName && m.appName !== m.app
  const where = !m ? "" : m.app ? `on their screen, in ${m.title ? `"${m.title}" (${named ? `${m.appName}, ` : ""}${m.app})` : named ? `${m.appName} (${m.app})` : m.app}` : m.path ? `in their note ${m.path}${m.line ? `, line ${m.line}` : ""}`
    : m.pane || m.ui ? `in Vaultite, ${m.title ? `"${m.title}"` : m.pane ?? m.ui}${m.url ? ` (${m.url})` : ""}` : ""
  const asked = m ? [
    m.text ? `They ${m.voice ? "said (dictated, so it may hold slips: go by the task)" : "said"}: ${JSON.stringify(cut(m.text, 2000))}` : "",
    where ? `Where: ${where}` : "",
    m.url && !m.pane ? `The page: ${m.url}` : "",
    m.selection ? `Their selection: ${JSON.stringify(cut(m.selection, 2000))}` : "",
    m.under ? `Under their pointer: ${cut(m.under, 600)}` : "",
    m.shot ? `Their screen then (a picture): ${m.shot}` : "",
    m.closeUp ? `A closer look at what they pointed at (${m.closeUp.scale}× as large): ${m.closeUp.shot}` : "",
  ].filter(Boolean) : []
  return asked
}
export const picturesIn = (text: string) => [...new Set(text.match(/(?:[A-Za-z]:)?[\\/][^\n"·:()]*?[\\/]screens[\\/](?:window|display|close)-\d+-\d+\.png/g) ?? [])]
export function worktreeOf(cwd: string, repo: string, id: string) {
  const parent = cwd.replace(/\/+$/, "").replace(/\/[^/]+$/, "") || "/"
  return { tree: `${parent === "/" ? "" : parent}/${repo || "repo"}-${id}`, branch: `job-${id}` }
}
function worktreeLine(w: Pick<Where, "cwd" | "base" | "tree" | "branch" | "live" | "label" | "moved" | "carried">) {
  const at = w.base ? ` ${w.base.slice(0, 12)}` : ""
  return [`Work in your own git worktree, never in ${w.cwd} itself: leave its working tree and branch as they are (${w.live ? "it's the running server's own checkout" : "it may be a live server's, or theirs mid-work"}). Before your first edit, make it: git -C ${w.cwd} worktree add ${w.tree} -b ${w.branch}${at}${w.moved || w.carried ? " (fetch that commit first if need be)" : ""}; then edit, build, test and commit only there (absolute paths, or cd ${w.tree} && … in each command). It has none of the checkout's installed packages: before checks, install them there (npm ci, or as the repo's rules say; a symlink to the checkout's node_modules is fine until you add or change a package, then a real install in the worktree, never into the checkout's). Changing nothing (research, an answer): no worktree.`,
    w.moved ? `They asked over ${w.moved}. You run on ${w.label} instead, from its checkout of that repo: try your change in ${w.label}'s own preview (its dev server or Tailscale Serve), not theirs. In your result, give its link and say it's on ${w.label}.` : ""].filter(Boolean).join(" ")
}
export type ProofMode = "auto" | "always" | "never"
const STEPS = `A step is a numbered line: one short sentence, shown as its caption and said aloud as it plays, with a tag on the thing by its words on that page ([ring "Save"], [point "Jobs"], [frame "Settings"]); two to four steps; (wait: click) or (do: click "Save") on a step clicks it, so the next shows what it led to. Add (before: <a png>) to a step to flip a picture of that thing before your change over it as it is now: take it before you change anything (a headless screenshot of just that element), of the thing alone. The Mac's own UI (the menu bar's menus, the notch, notifications) no browser shows: for a step on it, give (before: <png>) and (after: <png>) stills of it (screenshots cropped to it with sips), shown as a before and after slide, and say in its words what to open to see it.`
export function proofTask(id: string, video = true) {
  const save = `vau companion tour-save "<the change in a few words, as a noun: the blue save button>" --job ${id}`
  if (!video) return `If your change shows on screen, save how to see it before you land it (what Show me plays live in their app once it's on main): ${save} --open <the note or page it shows on> --text '<steps>', with no --record: no video, so no copy of your own to run for it. ${STEPS} Should it not land (Not merged:), it waits for their review: record its video then (vau companion tour-save --help: --record). Nothing to show on screen (research, a backend change): skip it.`
  return `If your change shows on screen, show it working rather than say so: before you end, record a short demo of it (what Show me plays for them when you're ready, wherever your change is): ${save} --record <your own copy's address> --text '<steps>'. --record plays the steps there in a headless Chrome (never on their screen, no sound) and keeps the video (an mp4 of a few MB) with the proof: run your own copy of the change for it, never their live app (your dev server, or for Vaultite a throwaway server from your worktree: vau sandbox <dir>, then its npm start on a free port, as its CLAUDE.md says), and --open the note or page it shows on there. ${STEPS} Then embed the video in your report: vau inbox report ... --video <the video's path tour-save gave>. Nothing to show on screen (research, a backend change): skip it.`
}
export const WRITING = `What you write for them (a report, a proposal, a note): plain, short sentences anyone could follow, each thing called by its full name, no clipped shorthand. Anything about a UI (a proposal, its options, an explanation of how something looks or moves) shows it rather than tells it: each option as a real, high-fidelity picture, a screenshot of a quick prototype of it running on your own copy or a polished HTML mockup in the vault (one element per option), made into PNGs with vau html picture and embedded in the note (![[...png]]) with a line under each saying what it is. Never ASCII art or a layout described in words. Look at each picture before you show it.`
export function jobTask(task: string, m: JobAsk | undefined, w?: Pick<Where, "cwd" | "repo" | "base" | "tree" | "branch" | "live" | "label" | "moved" | "carried" | "preview" | "watched" | "cloud">, id?: string,
  o: { land?: boolean; proof?: ProofMode } = {}) {
  if (w?.cloud) return cloudTask(task, m, w, o.land)
  const asked = askLines(m), coding = !!w?.repo, watching = coding && !!w.watched, lands = coding && !watching && !!o.land && !!w.tree
  const proof = o.proof ?? "auto", video = proof === "always" || !lands
  return [task.trim(), asked.length ? `The user asked for this through their companion in Vaultite:\n${asked.join("\n")}` : "",
    coding && w.tree ? worktreeLine(w) : "",
    watching ? `They watch ${w.preview} reload as you change ${w.cwd}, the checkout serving it: edit it right there (no worktree, no branch), the smallest change that does it, fast, with no checks or summaries unless they ask. Commit only on their word.` : "",
    lands ? `You're a job they handed off, in a terminal of Vaultite they can open and type in. They want it done, not asked about: decide what you can, and ask them (vau inbox ask) only on a real tradeoff, a choice they'd want a say in. Once your checks pass${proof === "never" ? "" : video ? " and your demo is recorded" : " and its tour is saved"}, land it yourself${mergeSteps(w)} Nothing else outward (posts, messages, a publish) unless they say so. End with a few lines: what you did, the files you changed, and where it landed.`
      : `You're a job they handed off, in a terminal of Vaultite they can open and type in. ${coding ? "Change the code freely, but don't push, merge, deploy, publish, post or message anyone unless they say so: it ends in their review (their Keep and merge lands it). End" : "End"} with a few lines: what you found or did, the files you changed, and how to try it (a preview's link if there is one).`,
    watching ? "" : WRITING,
    id && !watching && proof !== "never" ? proofTask(id, video) : ""]
    .filter(Boolean).join("\n\n")
}

function cloudTask(task: string, m: JobAsk | undefined, w: Pick<Where, "cwd" | "tree" | "branch" | "live" | "cloud">, land?: boolean) {
  const asked = askLines(m)
  return [task.trim(), asked.length ? `The user asked for this through their companion in Vaultite:\n${asked.join("\n")}` : "",
    "You're a job they handed off, run in a cloud session of Claude Code: Vaultite follows this session from their machine and tells them how it goes. You have no vau and no way into their vault or their screen: what you'd tell them goes in your messages, and a choice only they can make goes to AskUserQuestion (they answer it from Vaultite), only on a real tradeoff. Pictures or files their words name stay on their machine. Before your checks, set up as this repo's rules say for a cloud session.",
    land ? `They want it done, not asked about. Once your checks pass, land it yourself${mergeSteps(w)} Nothing else outward (posts, messages, a publish) unless they say so. End with a few lines: what you did, the files you changed, and where it landed.`
      : "Change the code freely and commit it on your session's branch, but don't push to main, merge, deploy, publish, post or message anyone unless they say so: it ends in their review (their Keep and merge lands it). End with a few lines: what you found or did, the files you changed, and how to try it."]
    .filter(Boolean).join("\n\n")
}

export function followTask(task: string, m: JobAsk | undefined, id?: string) {
  const asked = askLines(m), watched = !!id && m?.reviewed === id
  return [watched ? "They just watched your demo (Show me) and read its choice card: this is their feedback on what you made, whatever note or page their screen shows." : "",
    task.trim(), asked.length ? `(The user, through their companion: ${asked.join(" · ")})` : ""].filter(Boolean).join(" ")
}

export function jobText(j: Job, now = Date.now()) {
  const r = j.result, l = j.last, said = saidOf(j)
  return [`${j.id} · ${j.state}${unseen(j) ? " (new)" : ""} · "${j.title}" · ${whereLine(j.where)} · ${took(j, now)}`,
    j.where.why ? `why there: ${j.where.why}` : "",
    live(j.state) && j.now && !(said && j.now === gist(said.text)) ? `now: ${j.now}` : "",
    j.state === "needs you" && j.waits ? `waits on: ${waitsLine(j.waits)}${j.waits.choices.length ? ": companion job-answer with the user's choice, only on their words" : ""}` : "",
    j.queued?.length ? `${queuedLine(j)} (sent by itself then: nothing to retry): ${j.queued.map((q) => cut(plain(q.note), 120)).join(" | ")}` : "",
    l?.background ? `in the background: ${l.background} task${l.background > 1 ? "s" : ""} of its still running (a command, a subagent)` : "",
    j.by ? `handed off by ${j.by}` : "", tellsLine(j, now),
    l?.told ? `told last${l.by ? ` (by ${l.by})` : ""}: ${l.told}` : "",
    said ? `it said (${ago(said.at, now)}): ${cut(said.text.trim(), 1500)}` : "", l?.asks?.length ? `asks: ${l.asks.join(" | ")}` : "",
    j.where.tree ? `its worktree: ${j.where.tree} (branch ${j.where.branch}), beside ${j.where.cwd}${j.pruned ? ", removed once it was done" : ""}` : "",
    resultLine(r) ? `results: ${resultLine(r)}` : "", r?.files?.length ? `files: ${r.files.slice(0, 12).join(", ")}` : "",
    j.land ? (j.land.at === undefined ? "kept: told to merge it, merging now" : j.land.merged ? "kept and merged" : "kept, but it didn't say it merged: see what it said")
      : onMain(j) ? "landed on main: nothing left to merge" : "",
    j.going ? `going live: ${j.going.why}` : "",
    j.closed ? "its terminal closed once it was done: a follow-up (handoff --job) or opening it resumes its conversation" : "",
    `open it: vau companion job-open ${j.id}`].filter(Boolean).join("\n")
}

export function jobsText(jobs: Job[], now = Date.now()) {
  if (!jobs.length) return "No jobs: companion handoff starts one."
  return jobs.map((j) => `- ${j.id} · ${j.state}${unseen(j) ? " (new)" : ""} · ${j.title} · ${whereLine(j.where)} · ${took(j, now)}${toldLast(j) ? ` · ${toldLast(j)}` : ""}` +
    (j.queued?.length ? `\n  ${queuedLine(j)}` : unreachableLine(j) ? `\n  ${unreachableLine(j)}` : j.now && live(j.state) ? `\n  now: ${cut(j.now, 120)}` : "") + (j.state === "needs you" && j.waits ? `\n  waits on: ${waitsLine(j.waits)}` : "") + (j.last?.asks?.length ? `\n  asks: ${cut(j.last.asks.join(" | "), 200)}` : "") +
    (resultLine(j.result) ? `\n  ${resultLine(j.result)}` : "") +
    (j.result?.text && !live(j.state) ? `\n  ${cut(j.result.text.replace(/\s+/g, " "), 200)}` : "")).join("\n")
}

export function jobsLine(jobs: Job[], now = Date.now()) {
  const newest = jobs.filter((j) => live(j.state) || (now - j.at < 6 * 3600_000 && j.state !== "stopped")).slice(0, 4)
  const recent = jobs.filter((j) => newest.includes(j) || j.state === "ready for review" || j.state === "needs you")
  return recent.length ? `Your jobs (to tell one more or correct it, and anything about one's result (merge it, try X too): handoff with its job, land for their word to merge it; to stop one: job-stop; how one goes, and who told it what: job; to show them one that's ready, on their screen: job-show; what one waits on, with the choice their words name: job-answer): ${recent.map((j) =>
    `${j.id} "${cut(j.title, 60)}" (${j.state}${j.queued?.length ? `: ${queuedLine(j).toLowerCase()}, sent by itself then` : unreachableLine(j) ? `: ${unreachableLine(j).toLowerCase()}` : j.state === "needs you" && j.waits ? `: waits on ${waitsLine(j.waits)}` : j.now && live(j.state) ? `: ${cut(j.now.replace(/\.$/, ""), 80)}` : ""}${j.last?.asks?.length && !j.waits ? `; asks: ${cut(j.last.asks[0], 80)}` : ""}; ${whereLine(j.where)}; ${took(j, now)}${toldLast(j) ? `; ${toldLast(j)}` : ""})`).join(", ")}.` : ""
}

export function jobTimings(jobs: Job[]) {
  const from = (j: Job) => j.asked ?? j.started
  return jobs.flatMap((j) => (j.carded ? [{ t: j.started, title: j.title, card: j.carded - from(j), ...(j.stepped ? { step: j.stepped - from(j) } : {}) }] : []))
}

export function jobTimingsText(rows: ReturnType<typeof jobTimings>) {
  if (!rows.length) return ""
  const s = (ms?: number) => (ms === undefined ? "-" : (ms / 1000).toFixed(1)).padStart(7)
  const pct = (xs: number[], q: number) => [...xs].sort((a, b) => a - b)[Math.max(0, Math.ceil(q * xs.length) - 1)]
  const sum = (k: "card" | "step") => { const xs = rows.flatMap((r) => r[k] ?? []); return `${k} ${xs.length ? `${s(pct(xs, 0.5)).trim()}/${s(pct(xs, 0.9)).trim()}` : "-"}` }
  return [`Jobs, in seconds from the ask: card (its job card up), step (its worker's first step).`, `${"time".padEnd(8)} ${"card".padStart(7)} ${"step".padStart(7)}  job`,
    ...rows.map((r) => `${new Date(r.t).toTimeString().slice(0, 8)} ${s(r.card)} ${s(r.step)}  ${cut(r.title, 60)}`), `jobs (${rows.length}): ${sum("card")}, ${sum("step")} (median/p90, s)`].join("\n")
}
