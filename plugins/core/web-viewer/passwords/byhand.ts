// (an agent may run commands and click what's on screen, never show or copy a password that way: only the user's own key or click does)
export const byHand = () => { const e = window.event; return e instanceof UIEvent && e.isTrusted }
