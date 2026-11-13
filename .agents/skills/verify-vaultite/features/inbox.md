# Inbox

The Inbox is what agents bring the user: asks (a question with its options as buttons), sessions that need a reply, and
results to review (files in `Inbox/`). The user answers an ask, replies to a session in place, pins, snoozes and settles
rows; with nothing left it reads `Nothing needs you.`

## Sub-features
- `inbox-open`: the sidebar's Inbox button (`Inbox, N new`), the keys `g` `i`, the palette's Open inbox: `#view/inbox`.
- `inbox-empty`: `Nothing needs you.`
- `inbox-ask`: Decisions lists an ask's options; a click answers it and files it in `Inbox/.archive/` with its `answer`.
- `inbox-pin`: a row's menu, Pin: a Pinned section on top, `pinned: true` in the file.
- `inbox-settle`: Settle (a result's button, a row's menu, `e`): a toast with Undo, the row folds into `Settled N`.
- `inbox-reply`: `j`/`k` move between rows, `r` opens a Reply box under the row, Escape folds it.

## How to get to it (user POV)
- The tray button at the top of the left sidebar, `g` then `i`, or the palette's Open inbox.
- On the page: option buttons, a row's right-click menu (Settle, Open, File to…, Pin, Snooze), the keys `j` `k` `r` `e`
  `b` `p`.

## Driving it with vv
Preconditions:
- `vv doctor` ok; the sample has no `Inbox/`.
- `E='env -u VAULTITE_TERMINAL -u VAULTITE_CLIENT -u VAULTITE_TOLD -u CLAUDE_CODE_SESSION_ID -u CLAUDECODE'`: your
  session's ids kept out of what `vau` records.
- Setup, as agents would: `$E vv vau inbox add "Plant care apps compared" --tldr "Planta fits best." --body "Three apps."`;
  `$E vv vau inbox ask "Ship the Lighthouse sidebar to the phone too?" --options "Ship it: the phone gets it today" "Not
  yet: desktop only for now" --default "Not yet" --blocking --title "Lighthouse sidebar on phone" --why "The Lighthouse sidebar job finished on desktop."`; `$E vv vau inbox hook
  claude '{"hook_event_name":"Stop","session_id":"vv-lighthouse","cwd":"/var/tmp/lighthouse","last_assistant_message":"The
  release needs a version bump.\n\nShould I bump to 0.6.1 or retag 0.6.0?"}'`. `vv vau inbox` lists all three.

- **Empty.** Before the setup: `vv open '#view/inbox'`, `vv aria --sel "[data-inbox-view]" --out empty` has
  `Nothing needs you.`; `vv vau inbox` is `Nothing new.`
- **Open.** `vv open '#file/Start%20here.md'`, `vv click --sel "aside [data-inbox-button]"` (named `Inbox, 3 new`): the
  hash is `#view/inbox`. Keys: `vv press Escape`, `vv press g`, `vv press i`.
- **Rows.** `vv aria --sel "[data-inbox-view]" --out rows`: `Decisions 1`, a group named by the question with its two
  options, heading `Active` with the session's row and `Plant care apps compared`.
- **Pin.** `vv click --sel "[data-inbox-view] [data-result='Inbox/Plant care apps compared']" --right`, `vv menu Pin`:
  toast `Pinned “Plant care apps compared”`; `[data-inbox-pinned] [data-result]` is there; `vv vau read "Inbox/Plant care
  apps compared.md"` has `pinned: true`.
- **Settle.** `vv click --sel "[data-inbox-pinned] [data-result] button[aria-label=Settle]"`: toast `Settled “Plant care
  apps compared”`; `vv vau read "Inbox/.archive/Plant care apps compared.md"` has `status: done`.
- **Answer.** `vv click --sel "[data-inbox-decisions] [data-option='1']"`: toast `Answered “Ship it”`; `vv vau inbox
  decisions --recent` has `answered Ship it`; the archived file has `answer: Ship it`.
- **Reply.** `vv click --sel "[data-inbox-view] h1"`, `vv press j`: `vv eval
  'document.activeElement.closest("[data-select-key]")?.dataset.selectKey'` is `e:<id>`. `vv press r`: the keyboard is in
  `textarea[data-reply]`, `[data-row-reply]` quotes the question. `vv type "Bump to 0.6.1"`, `vv shot row-reply`,
  `vv press Escape`: the box folds, the row keeps the keyboard.
- **Settle by key.** `vv press e`: toast `Settled “lighthouse”`. `vv aria --sel "[data-inbox-view]" --out end`:
  `Nothing needs you.`, `Settled 2`, `Clear settled`. `vv shot inbox-end`.

## Gotchas
- Without `$E`, an ask records your own terminal and session, and an answer other than the default is sent to it.
- Never Enter in the Reply box: Send resumes the session or starts an agent in the sandbox's terminals. Show the draft,
  then Escape.
- A hook needs a `session_id` and a last line ending `?` to need the user; it lands a moment later: wait for `vv vau inbox`.
- A session row's Reply, Settle, Snooze and More show on hover only: use the keys, or right-click and `vv menu Settle`.
- `j` skips Decisions. An option's name joins its label, its effect and `Default`: select it by `[data-option]`.
- Results' ids have no `.md`: `data-result='Inbox/<Title>'`.
- `g` `i` and the row keys need the keyboard out of an editor: Escape first.
- Changes the sandbox (`Inbox/`, the inbox's events): `vv down`, `vv up` after it.
