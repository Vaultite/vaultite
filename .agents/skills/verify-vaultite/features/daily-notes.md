# Daily notes and routines

Open today's daily note opens `Daily/<YYYY-MM-DD>.md`, made if it isn't there yet. The Daily note panel edits a day's
note beside whatever is open, steps a day back or on, and starts a missing day. The Today page's Routines grid ticks a
routine for a day into that day's note (`done: [Stretch]`), and the status bar counts today's.

## Sub-features
- `today-open`: Open today's daily note (`Control+Alt+d`) opens today's note; it never makes a second.
- `tomorrow-open`: Open tomorrow's daily note makes tomorrow's (bare `type: day`: the sample has no template).
- `daily-panel`: the Daily note panel, shown from the sidebar's menu, kept in `.vaultite/sidebars.json`.
- `daily-step`: Day before, Day after, Today; the heading names the day (Today, Yesterday, Nov 14).
- `daily-start`: a day with no note says `No note for <day> yet. Start it`; Start it makes it, and typing fills it.
- `routines-tick`: a routine's cell for a day is a button; a click ticks it into that day's `done`.
- `routines-chip`: the status bar's `done/due` for today.

## How to get to it (user POV)
- `Control+Alt+d` (`ControlOrMeta+Alt+d`), or the palette's Open today's daily note, Open tomorrow's daily note.
- Right-click the left sidebar's title bar, More, Daily note: the panel.
- The Today page (`Dashboards/Today.md`, the Today plugin's), or the status bar's routines count.

## Driving it with vv
Preconditions:
- `vv doctor` ok; `T=$(vv eval 'new Date().toLocaleDateString("sv")' | tr -d '"')`; T1 and T2 the two days after.
- `D='[data-panel="daily-notes:daily"]'`.

- **Today.** `vv vau read Daily/$T.md`: the sandbox's (`done: []`, `Plan: ...`). `vv open '#file/Projects%2FLighthouse.md'`,
  `vv click --sel "[data-pane-frame][data-focused] .cm-content"`, `vv press Control+Alt+d`: `vv eval
  'decodeURIComponent(location.hash)'` is `#file/Daily/<T>.md`; the file is unchanged.
- **Tomorrow.** Palette `Open tomorrow's daily note`: the hash names T1; `vv vau read Daily/<T1>.md` is `type: day` alone.
- **Panel.** `vv click --sel "aside[data-side=left] [data-titlebar]" --right`, `vv menu More "Daily note"`, `vv press
  Escape` till no `[role=menu]`. `vv eval "[document.querySelector('$D [data-daily-panel]').dataset.dailyPanel,
  document.querySelector('$D [data-heading]').textContent]"`: `[T, "Today"]`. `vv vau panels`: `daily-notes:daily`.
- **Step.** `vv click --sel "$D [aria-label='Day before']"`: `[T-1, "Yesterday"]`. `vv click --sel "$D [aria-label='Today']"`,
  then `Day after` twice: `[T2, "<Mon D>"]`; `vv aria --sel "$D" --out daily-missing` has `No note for <Mon D> yet. Start it`;
  `vv vau files Daily` has no T2.
- **Start it.** `vv click --sel "[data-daily-start]"`, `vv type "From the panel"`: `vv vau read Daily/<T2>.md` ends
  `From the panel`. `vv shot daily-panel`.
- **Routines.** `vv open '#file/Dashboards%2FToday.md'`: `vv aria --sel "[data-pane-frame][data-focused]" --out today-page`
  has heading `Routines · <Weekday D Month>` and a button `Stretch, <T>`; the status chip `vv eval
  'document.querySelector("[data-status-key=\"today:routines\"]").textContent'` reads `0/4` on a Thursday.
- **Tick.** `vv click --label "Stretch, <T>"`: the button is now `Stretch, <T>, done`, `aria-pressed` `true`; the chip
  `1/4`; `vv vau read Daily/<T>.md` has `done: [Stretch]`. `vv shot routines`.

## Gotchas
- The sandbox writes today's note and most of the last three weeks', never a future day's: only tomorrow shows a note
  being made.
- How many routines are due depends on the weekday (Lift is Mon, Wed, Fri); some tick themselves from the sandbox's logs.
  Tick Stretch, which never does.
- A click on a done cell opens its details, not an untick.
- The Today page and the routines come from the Today plugin, which `vv up` installs from QA's pin.
- The panel's heading buttons show on hover only; vv's clicks reach them anyway. The More submenu stays open: Escape.
- Changes `Daily/` and `.vaultite/sidebars.json`: `vv down`, `vv up` after it.
