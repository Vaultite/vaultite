# Notes for `plugins/core/terminal/`

- Terminals outlive the server in the terminal server (`termd/`: `termd.ts` the detached process, `host.ts` its core,
  newline JSON over a Unix socket or pipe, `protocol.ts`). It owns each terminal whole: pty, its screen in libghostty-vt
  (`vt/`: pictures, captures as text, vt or html), the app's meta (`name`, `note`: kept there, so they survive
  restarts), what it runs, OSC 7501, size, clients, and how it ended (an hour; whole for ten minutes). Its events (started, exited, status,
  meta...) reach plugin.ts' `onEvent`; an end nobody heard (the server was away) goes to the next to subscribe.
- `vt/vt.ts` is Ghostty's terminal as WebAssembly (`ghostty-vt.wasm`, a release's file: `tools/ghostty_update.ts`
  takes another, checking its signature), one instance per terminal (its memory goes back when it ends). It answers
  programs as the pages do (`asXterm`: what xterm.js answered), since a page answers in its stead while attached; the
  pages draw with the same module (`vt/term.ts`: `screen.ts` its render state, encoders, selection and search;
  `render/` WebGL2 or Canvas2D), so pictures carry no palette. Output is parsed as it's read and passed on at once after input, or
  every few ms while it pours (BATCH in host.ts). `tools/test_vt.ts` checks it against xterm.js, `tools/perf/vt.ts`
  times both.
- Kitty graphics: Ghostty's release wasm has them compiled out (off on wasm32-freestanding, which has no clock), so
  `ghostty-vt.wasm` is built here for wasm32-wasi from the signed source (`tools/ghostty_update.ts --build`), its WASI
  imports given by `vt.ts` (clock, entropy, no files). termd (`termd/kitty.ts`) makes every picture direct pixels
  before anything parses it: a file (t=f, t=t) is read where the pty is, a PNG decoded (a page has no synchronous
  decoder), so termd's terminal and every page's take the same bytes and answer alike; their answers (a=q) are the
  one exception to `asXterm`. `CLAUDE_CODE_FORCE_TERMINAL_IMAGES` (plugin.ts env) makes Claude Code draw them and
  assume file reads; Claude Code draws only mods' pictures, so its terminals load ours (`claude-pictures/`, through
  `CLAUDE_CODE_PLUGIN_DIRS`: no account touched) for what it reads and what's pasted, as Claude got them (Claude Code re-encodes a big paste as JPEG): PNG, JPEG, GIF or WebP, decoded in the mod (`claude-pictures/decode/`: our own decoders, plain TS with no Node, as its worker has none, so PNG twice, termd's with Node's zlib) and sent as pixels as small as their cells need, the pictures of one row sharing the 2 MiB of Image source Claude Code allows a tree; one it can't read is a dim line saying why. A page attaching gets them with its snapshot (`withPictures`, REPLAY_MAX); with the alternate
  screen up, only that screen's. Pages send their cell size in pixels with their size: a picture without `c`/`r`
  covers the same cells in termd as in the page.
- The page's terminal (`vt/term.ts`) is libghostty-vt's too, from the same `ghostty-vt.wasm` (`vt/wasm.ts`, compiled
  with the chunk). Use Ghostty's own encoders, selection and search (`screen.ts`), not hand-written escape codes; only
  what its encoder leaves to the platform's text (Backspace, ⌥←) is in `input.ts`. WebGL's glyphs are drawn on their
  own ground (keyed by colours, shared between terminals): on a clear one text reads heavier. Gotchas: a `bool` the
  module reports is one byte (read `getUint8`); structs passed "by value" go by pointer in the wasm ABI.
- termd's loop never waits on a screen: each terminal's libghostty-vt runs in a thread of its own (`termd/screen.ts`,
  `screenworker.ts`), so its answers (capture, snapshot) are async, and output after a snapshot's point waits for it.
  One that hasn't answered for HUNG (the module stuck on some output, 2026-11-11) starts again blank. termd says what
  went wrong as a `trouble` event, and its loop held up 2 s or more too: the server logs it as an error (vau errors).
  A server that stops answering is marked stalled (backend.ts `watch`): said once, `trouble()` in terminal.list, what's
  asked of it failing at once (new terminals go to the fallback) until anything is heard from it.
- When termd can't start, the same host runs in the server (`localBackend`: an in-process pipe), ending with it. Another
  plugin's `terminal:backend` (herdr, Rex) implements `Backend` (backend.ts); one without `capture` is from before and
  isn't used. Names follow the port (backendName), so a QA server's terminals stay out of the live list, and an app
  serving no port (a test's, `npm run check`'s) never reaches them. Under a systemd unit termd needs its own scope.
- A new protocol (PROTOCOL, in the socket's name) means a new termd beside the old one, which takes over the old one's
  terminals (`termd/adopt.ts`: held through it, mirrored) so live shells survive the upgrade: list the old socket in
  `oldServers`. termd's code changing without the protocol: the running one keeps its old code until it has no
  terminals, so keep changes to it compatible.
- One terminal has one size, the last device's; a view used again that doesn't match sends its own.
- A terminal's state (the list's `state`, the service "inbox:state", the event `terminal.state`, `terminal.wait`, for
  plugins the service "terminal:wait") is one value, `state.ts`' Term: every source is an event into its `step`, each
  transition a line in the server's log, and everything reads only its output (no source read again elsewhere). It
  holds how its shell's life ends too (ended on purpose, ended, whether its tabs close: `ended.json` is `closes`' copy
  kept for after a restart). It comes from OSC 7501 (`osc7501.ts`) when its program speaks it, else its agent's hooks, else a question its agent declares
  seen on its screen. Its program seen gone from in front of its shell, after it last spoke, ends what any of them said
  (idle, `from: "shell"`): the server looks itself while one works or waits (`lookAtBusy`), page or no page. Its agent's own word that it waits ("terminal:agent-waits": Claude Code's session file) blocks it
  whatever those say: Claude Code has dialogs no hook tells. A blocked report without a kind (Codex's, which never
  probes) waits for that question on screen: Approve and Deny need its words. A wait for a state counts only one told
  after the terminal's last input (`lastInput`), so a prompt just sent isn't answered by the idle before it.
- OSC 7501 is answered where the pty is held (termd), in stream order: the probe's answer must reach the program before
  the primary DA answer after it (Claude Code takes a DA answer first as "not spoken here").
- Terminal ids: `<name>-<id>` starts agent `<name>`, `<name>_<account>-<id>` in an account, `resume-<name>-<session>`
  resumes, through the service `agent:<name>` of the plugin that brings it. Ops name a terminal by id, name or the end
  of its id (`target` in targets.ts), `@<machine>` passing the op on to that machine.
- A command alone (`terminal.start --command`, Spec `only`) is the terminal's program: it ends with it, its exit code
  the terminal's. A command typed into a shell (terminal.run's) leaves the shell.
- A tab opened from outside only attaches (a page starts only ids it minted), so `vau terminal open` starts the session
  first.
- The socket answers this machine, or through Tailscale Serve the owner or `allowUsers`; another Origin is refused.
- Shells start through `SHELL_DIR` (launch.ts), which runs the user's login files and then puts the app's `vau` first
  on PATH (path_helper and Homebrew would put theirs first).
- Gotchas: node-pty's `spawn-helper` may lack its exec bit (fixed at start); a termd whose checkout moved can't spawn,
  so it retires; shells drop `ELECTRON_RUN_AS_NODE`; whether a shell runs something is its tty's foreground group
  (`inFront`), not its name.
