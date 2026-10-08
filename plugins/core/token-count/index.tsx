import { useMemo } from "react"
import { Coins, Gauge } from "lucide-react"
import { cn, definePlugin, openView, useStore, type FileMark, type OpenFile, type Store } from "@vaultite"
import { estimateTokens, tokenText } from "./estimate"
import { levelOf, ruleFor, worse } from "./limits"
import { ContextPanel, ContextView, short, toneOf } from "./AgentContext"
import "./types"

// Token count: an estimate of the Claude tokens in the open file (its whole text, frontmatter included), in the status
// bar after its words and characters, amber near the file's limit and red over it (limits.ts). Never sent anywhere.

const ABOUT = "About how many tokens Claude reads for this file, frontmatter included.\nAn estimate made on this device, not Claude's own tokenizer."

function Tokens({ file }: { file: OpenFile }) {
  const { store } = useStore()
  const n = useMemo(() => estimateTokens(file.text), [file.text])
  if (!file.text.trim()) return null
  const tc = store?.tokenCount
  const md = file.path.endsWith(".md") && tc
  const rule = md ? ruleFor(file.path, file.fm, tc.limits) : { limit: 0, by: null }
  // A load chain's total as the server counted it, with this file's own part as typed.
  const known = md ? tc.files.find((s) => s.path === file.path) : undefined
  const total = known?.total !== undefined ? known.total - known.tokens + n : undefined
  const level = worse(levelOf(n, rule.limit), total !== undefined ? levelOf(total, rule.limit) : "ok")
  const set = rule.by === "max_tokens" ? "its max_tokens" : rule.by ? `set for ${rule.by}` : "any Markdown file"
  const tip = [ABOUT,
    ...(md && rule.limit ? [`${level === "over" ? "Over its limit" : level === "near" ? "Near its limit" : "Its limit"}: ${short(rule.limit)} (${set}).`] : []),
    ...(total !== undefined ? [`With its @imports an agent loads ${tokenText(total)} (${known!.chain!.length + 1} files).`] : []),
  ].join("\n")
  return (
    <span data-tokens={n} data-total={total} data-level={level} data-tip={tip} data-tip-side="top" className={cn(level !== "ok" && toneOf(level))}>
      {tokenText(n)}{total !== undefined && `, ~${short(total)} loaded`}
    </span>
  )
}

/** Files over their limit, marked in the file tree with their size. */
function marks(store: Store): Record<string, FileMark> {
  const out: Record<string, FileMark> = {}
  for (const s of store.tokenCount?.files ?? []) {
    if (s.level !== "over") continue
    const loads = s.total !== undefined && s.total > s.limit && s.tokens <= s.limit
    out[s.path] = { text: short(loads ? s.total! : s.tokens), tip: loads ? `Loads ${tokenText(s.total!)} with its imports: over its limit of ${short(s.limit)}`
      : `${tokenText(s.tokens)}: over its limit of ${short(s.limit)}` }
  }
  return out
}

export default definePlugin({
  icon: Coins,
  status: { tokens: { after: true, render: (file) => <Tokens file={file} /> } },
  fileMarks: marks,
  sidebar: {
    context: {
      title: "Agent context", names: ["agent context", "token limits", "long files", "context size"], heading: false, sort: 45, hidden: true,
      view: "agent-context", flyout: { icon: Gauge }, render: (ctx) => <ContextPanel {...ctx} />,
    },
  },
  views: { "agent-context": { icon: Gauge, title: () => "Agent context", render: ({ store }) => <ContextView store={store} /> } },
  commands: [
    { id: "token-count:open-tab", name: "Open agent context in a tab", run: () => openView("agent-context", { newTab: true }) },
  ],
})
