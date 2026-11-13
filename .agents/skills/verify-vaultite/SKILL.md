---
name: verify-vaultite
description: Drive Vaultite (the web app on a sandbox server of this checkout, in headless Chromium) the way a user does, and prove a change works with screenshots, ARIA snapshots and the files it wrote. Use before calling a UI or behavior change done, to reproduce a bug, or when asked to "verify", "prove it works" or "try it in the app".
---

# Verify Vaultite

`vv.mjs` keeps one sandbox server of this checkout and one headless Chromium on it between commands, so each step is
one command and you read the result before the next. Run it from the checkout's root:
`node .claude/skills/verify-vaultite/vv.mjs <command>` (below, `vv`). Never against the user's own vault or server:
`up` makes a sandbox (`vau sandbox`) and its own server on a free port.

## Launch
- `npm run build` first when web/src changed (the server serves web/dist).
- `vv up` makes the sandbox, starts `server.ts` on it with Vaultite's own plugins (Vaultite/plugins at QA's pin,
  `tools/qa_plugins.json`; their writes answered "not now"), starts Chromium, opens the app and waits till it's idle. It
  prints the address, the vault and the evidence folder. One instance per `VV_HOME` (default: `verify-vaultite` in the
  OS temp folder); a second `up` refuses. `vv up --motion` keeps animations (default: Reduce motion, so a step's end
  state is final at once).
- A backend change needs a fresh instance: `vv down`, `vv up`.

## Doctor
`vv doctor`: the server answers, runs this checkout's HEAD, its vault is a sandbox, Chromium answers and shows the app.
Run it first, after anything surprising, and before believing a failure.

## Drive
- `vv open '#file/Projects%2FLighthouse.md'`: go to an address in the app (a hash route; none: the start).
- `vv viewport phone` (390x844: the phone layout), `vv viewport desktop` (1280x800, the default): it lasts till changed.
  Only the size: no touch, so no swipes.
- `vv click --role button --name "New tab"`, `--label "New name"`, `--text "Lighthouse"`, `--sel "<css>"`; `--right`
  for a context menu. Prefer roles and names; `--sel` for the app's stable data attributes
  (`aside [data-tree-path='<path>']` a file in the tree, `[data-tab-bar] [data-tab-id]` a tab, `[data-pane]` a pane).
- `vv drag <what> --to-sel "<css>"` (or `--to-role`, `--to-name`, `--to-label`, `--to-text`), `--at left|right|top|bottom`
  for a spot in the target other than its middle: a mouse drag as a user's (a file onto a folder, a tab onto a pane's
  side). `<what>` is named as `click` names it.
- `vv type <text>`, `vv press <key>` (`Enter`, `Escape`, `ControlOrMeta+p` the palette, `ControlOrMeta+a`).
- `vv menu <item> [<submenu item>...]`: choose in the open menu (through its submenus). A row with a shortcut is named
  with it: `vv menu Paragraph "Task list Ctrl+Shift+9"`.
- `vv idle`: wait till the app has nothing out, unsaved or moving (every command already ends with it).
- `vv eval '<js>'`: a value from the page (its state as JSON). Read, don't drive with it.
- `vv vau <args>`: the CLI against the instance (`vv vau read <path>`, `vv vau files <folder>`, `vv vau tabs`), with your
  environment: run as an agent's session, what records its asker (`vau inbox ask`) records yours (`features/inbox.md`).

## Evidence
- `vv shot <name>`: a screenshot, `vv aria [--sel <css>] [--out <name>]`: the ARIA tree (to stdout, and kept with
  `--out`). Both land in the evidence folder `up` printed, which `down` keeps.
- A proof drives the user's path (clicks, keys, menus), never an op or a file write standing in for one, and shows the
  end state twice: on screen (a shot or ARIA) and where it lasts (`vv vau read`, the file on disk, `vv vau tabs`).

## Cleanup
`vv down`: stops the server, its terminals' server and Chromium, deletes the sandbox, keeps the evidence. If `up`
failed midway it already stopped what it started. Never kill by name (`pkill`): the user's own apps share the names.

## Features
`features/README.md` maps what a user can do to how to drive and prove it, one file per feature. A change to a
feature: run its file's steps; a new user-facing feature gets a file.
