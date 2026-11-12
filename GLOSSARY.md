# Glossary

Vaultite's words, as the code and its docs use them. Use these, not the ones under _Avoid_.

## The user's things

**Vault**: the folder of Markdown files that is all of the user's data, and the app's settings in its `.vaultite/`.
_Avoid_: database, workspace (that's a desk, below), library.

**File**: one file in the vault; a **note** when it's Markdown. Its **kind** is its `type:` field (a person, a log, a
task's note), and says its format.
_Avoid_: document, record, entry.

**Block**: a fenced view in a note (```` ```block-person ````) that the app draws in place: a view, never data.
_Avoid_: widget, embed, component.

**Setting**: a choice the user makes about how the app works, kept as a file in `.vaultite/`.
_Avoid_: config (that's the server's own, out of the vault), preference.

**Kept state**: what's open and what's cached (tabs, a place in a video), kept by the server and shared with the
other machines, never in the vault.
_Avoid_: settings, session state.

## The app

**Plugin**: a feature. An **app plugin** ships with Vaultite; a **vault plugin** is installed into a vault.
_Avoid_: extension, add-on, module.

**Op** (operation): one thing the app can do for an agent or the user, with its arguments and answer; the same op is a
`vau` command, an MCP tool and an HTTP call.
_Avoid_: endpoint, action, command (that's the palette's).

**Bundle**: a whole setup at once (plugins, panels, pinned pages, look). A **layout** is one the user picks, a
**pack** adds plugins and pages, a **look** restyles.
_Avoid_: template, theme, preset.

**Workspace**: a desk: its tabs, sidebars, pinned pages and open folders, shared by every device on it.
_Avoid_: vault, project.

**Tab**: one open file, page or terminal. **Pane**: where tabs show, side by side when split.
**Sidebar**: a stack of **panels** on either side. **Palette**: the searchable list of commands and files.
**Sheet**: a dialog that slides over the page. **Look**: the app's appearance (theme, fonts, translucency).
_Avoid_: window (the desktop app's own), view, modal.

## Machines and agents

**Machine**: a computer running Vaultite's server, each with its own terminals and agents; the user's machines share
kept state.
_Avoid_: host, node, device (a device is what the user looks through: a Mac, a phone, a browser).

**Agent**: an AI that works in the vault through `vau` (Claude Code, Codex). Its **session** is one conversation, in a
**terminal** or the app's chat.
_Avoid_: bot, assistant, model.

**Companion**: the one agent the user calls up anywhere, by voice and pointer.
_Avoid_: assistant, helper (that's the desktop app's macOS process).

**Job**: a task the companion hands to an agent session of its own, from start to landing.
_Avoid_: task (that's the user's to-do), run, worker (what a job runs on).

**Inbox**: what agents bring the user to decide or read later; an **ask** is a question there with its options.
A **knock** asks for the user's attention without interrupting, at their next pause.
_Avoid_: notification (a toast), message.
