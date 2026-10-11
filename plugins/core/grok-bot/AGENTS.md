## Grok Bot
Grok Bot is Cursor's always-on cloud agent. Read live from Cursor's dashboard with Cursor.app's sign-in on the machine
the server runs on, once the user allows it (the `account` setting; one read serves this plugin and Cursor's): its
week's allowance, its requests' value by day and model, and its conversations (when and with which model, not what was
said: that stays in Grok Bot). Nothing is written to the vault. A conversation as JSON:
`GET /api/grok-bot/session/<conversation id>`.
