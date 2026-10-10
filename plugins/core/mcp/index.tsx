// MCP's frontend: its Plugins page entry, settings sheet (how to connect) and view:connections (apps connected from the
// internet).
import { Copy, Plug } from "lucide-react"
import { copyText, definePlugin, Group, notify, notifyError, openView, Panel, Section, SettingRow } from "@vaultite"
import { ConnectSection, ConnectionsView, SETUP_DETAIL, SetupSheet, setupTitle, type AppId } from "./Connections"
import { GrokBotIcon, MuseIcon } from "./marks"

function Preview() {
  return (
    <Panel title="MCP" icon={Plug}>
      <p className="text-[15px] leading-[20px] text-muted-foreground">
        Lets an AI outside the app use your vault: Claude Code or Claude desktop on this machine search it, read pages as you see them, and
        write notes, logs, timeline lines, facts about you and clipped web pages the vault's way. Everything they do shows in Activity
        as theirs. Only this machine and your own devices on the tailnet can connect.
      </p>
    </Panel>
  )
}

const here = () => (typeof location === "undefined" ? "http://127.0.0.1:8793" : location.origin)

function Connect() {
  const rows = [
    { label: "Claude Code, through vau", sub: "Starts vau mcp for each session", cmd: "claude mcp add --scope user vaultite -- vau mcp" },
    { label: "Claude Code, over HTTP", sub: "This server's address", cmd: `claude mcp add --scope user --transport http vaultite ${here()}/api/mcp` },
  ]
  return (
    <Section title="Connect an AI">
      <Group>
        {rows.map((r) => (
          <SettingRow key={r.label} label={r.label} sub={<code className="break-all text-[12px]">{r.cmd}</code>} onClick={() => copyText(r.cmd).then(() => notify("Copied the command", { id: "copied" }), (e) => notifyError(e))} chevron={Copy} />
        ))}
        <SettingRow label="Claude desktop" sub={<span>In claude_desktop_config.json, a server whose command is vau (its full path) with the argument mcp</span>} />
        <SettingRow label="Claude, ChatGPT, Muse and Grok Bot" sub="On the web and your phone: Connections" onClick={() => openView("connections", { newTab: true })} />
      </Group>
    </Section>
  )
}

export default definePlugin({
  preview: () => <Preview />,
  settingsPanel: () => <Connect />,
  icons: { "grok-bot": GrokBotIcon, muse: MuseIcon },
  details: { [SETUP_DETAIL]: { title: (_s, [id]) => setupTitle(id), render: (_s, [id]) => <SetupSheet id={id as AppId} /> } },
  setup: { label: "Connections", sub: "Claude, ChatGPT, Muse and Grok Bot in your vault", run: () => openView("connections", { newTab: true }) },
  newTab: { connect: { title: "Connect your AI", sort: 5, heading: false, render: () => <ConnectSection /> } },
  views: { connections: { icon: Plug, title: () => "Connections", render: () => <ConnectionsView /> } },
  commands: [{ id: "mcp:connections", name: "Open connections", run: () => openView("connections", { newTab: true }) }],
})
