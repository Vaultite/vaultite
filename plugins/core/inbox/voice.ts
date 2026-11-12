import path from "node:path"
import { newTerminalId, parseTerminal } from "../../../core/agents.ts"
import { type OpCtx, OpError } from "../../../core/plugins.ts"
import { localStamp, str } from "../../../core/vault.ts"
import { hand } from "./handed.ts"
import { startNew } from "./replies.ts"
import { plugin, settings } from "./server.ts"

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** What the front door (an agent the setting `dispatch` names) is told with a voice note: the setting
 *  `dispatch_prompt`, its {path}, {folder} and {text} filled in. */
const DISPATCH = (file: string, text: string) => settings().prompt.replace(/\{(path|folder|text)\}/g, (_, k: string) =>
  (k === "path" ? file : k === "folder" ? path.posix.dirname(file) : text))

/** Words past which a voice note isn't handed to the front door (about ten minutes of talk). */
const LONG_VOICE = 1500

/** Start the front door with a voice note: a new terminal running the agent (its id), the note its first prompt, given
 *  as it starts (typed in at its prompt, a fresh TUI could drop the start of it). */
async function dispatch(ctx: OpCtx, agent: string, file: string, text: string): Promise<string> {
  const id = newTerminalId(agent)
  const parsed = parseTerminal(id)
  // (its host starts a chat when it has one: agent-chat-new, as a reply's new session)
  const made = await startNew(ctx, parsed?.agent ?? agent, { how: "new", to: id, ago: null, ttl: null, transcript: "", ...(parsed?.profile ? { account: parsed.profile } : {}) }, DISPATCH(file, text))
  if (made.host) return made.session!
  hand(id)
  return id
}

export function register() {
  plugin.op({
    id: "inbox.voice",
    cli: "inbox voice",
    summary: "What the user said into their watch, phone or the app: kept in the inbox, and handed to the front-door agent when the setting dispatch names one.",
    help: `The iPhone app sends it (from the watch's microphone, transcribed on the phone), and so does the app's Record a
voice note for your inbox. The recording (audio) is kept as an attachment, embedded above what was said, unless the
setting voice_audio is off. With dispatch set (claude, codex...), a new terminal runs that agent with the note, to write
it down, do it, or say what it would do; one past 1,500 words (a recording left running, a meeting) is only kept.

  vau inbox voice "Remind me to call Alice about the trip on Friday"`,
    kind: "write",
    params: {
      text: { type: "string", required: true, description: "what was said, transcribed" },
      from: { type: "string", description: "where it was said (Apple Watch, iPhone)" },
      audio: { type: "string", description: "the recording, base64 (a short one; any size goes as the op's input): kept as an attachment, embedded above what was said" },
      ext: { type: "string", description: "the recording's extension (m4a, webm)" },
      keep: { type: "boolean", description: "only kept: never handed to the agent dispatch names" },
    },
    args: ["text"],
    input: "the recording, any size (instead of audio)",
    run: async ({ text, from, audio, ext, keep }, ctx) => {
      const said = text.trim()
      if (!said) throw new OpError("nothing was said")
      const words = said.replace(/[\\/:*?"<>|#^[\]]/g, "").replace(/\s+/g, " ").trim().split(" ")
      const first = words.slice(0, 8).join(" ")
      const title = `${first[0]?.toUpperCase() ?? ""}${first.slice(1)}${words.length > 8 ? "…" : ""}` || "Voice note"
      // The user's own words (Provenance's label for what they write, while it's on); an AI app's (MCP) are its own.
      const origin = (plugin.service(ctx.who.client === "mcp" ? "provenance:agent" : "provenance:user") as (() => string) | null)?.() || undefined
      let body = said
      if ((audio || ctx.input) && settings().audio) {
        const kind = /^[a-z0-9]{1,5}$/i.test(str(ext)) ? str(ext).toLowerCase() : "m4a"
        const name = `Voice note ${localStamp().replace(/(\d\d)(\d\d)(\d\d)$/, "$1.$2.$3")}.${kind}`
        const up = ctx.input ? await ctx.op("file.upload", { name }, ctx.input) : await ctx.op("file.upload", { data: audio, name })
        body = `![[${path.posix.basename(str(up.path))}]]\n\n${said}`
      }
      const r = await ctx.api("POST", "inbox", { title, body, from: str(from).trim() || ctx.who.label, origin })
      const file = `${r.id}.md`
      const agent = keep ? "" : settings().dispatch
      let terminal: string | null = null, why = ""
      // Past a few minutes of talk it's a recording left running or a meeting, not a request: kept, not handed on.
      if (agent && words.length > LONG_VOICE) why = `${words.length} words is a recording, not a request: it's in the inbox`
      else if (agent) {
        try { terminal = await dispatch(ctx, agent, file, said) } catch (e) { why = (e as Error).message }
      }
      return { path: file, terminal, why }
    },
    text: (r) => `In the inbox: ${r.path}${r.terminal ? `; ${cap(String(r.terminal).split(/[-_]/)[0])} has it in ${r.terminal}` : r.why ? ` (not dispatched: ${r.why})` : ""}.`,
  })
}
