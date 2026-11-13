/** Why the server closed a terminal page's socket (WebSocket leaves 4000-4999 to the application). */
export const CLOSE = { exited: 4000, refused: 4003, gone: 4004 } as const
