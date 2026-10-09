## Cursor
Read live from Cursor on the machine the server runs on: its chats from the IDE's and the CLI's own files, the plan and
usage from Cursor's dashboard (with the IDE's sign-in, once the user allows it: the `account` setting); nothing is
written to the vault. Clicking a chat goes to the app's terminal it runs in, or opens its conversation in a tab. A
chat's conversation, as JSON: `GET /api/cursor/session/<chat id>?limit=150&before=<n>`.
