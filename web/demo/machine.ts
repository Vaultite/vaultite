// Plugins that need a machine (a shell, agents, other apps, the network as a server): off in the demo and refused if
// turned on, their backends left out of its bundle (vite.demo.config.ts).
export const MACHINE = ["terminal", "claude-code", "codex", "cursor", "opencode", "openclaw", "hermes", "dispatch", "mcp", "machines",
  "activity", "agent-meters", "ai-import", "audio-recorder", "app-windows", "dock-icon", "clipper", "calendar"]
