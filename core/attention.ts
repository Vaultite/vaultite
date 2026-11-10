// What an agent's session asks of the user, one rule for every surface (the Agents and Terminals panels, the notch):
// it waits on them only while blocked; an answer unread or a job ready for review is news, not a wait.

/** It waits on the user: blocked on a permission, a question or a login. */
export const waitsOnUser = (s: { state?: string }) => s.state === "blocked"
/** It has something to look at, though it waits on nothing: its Inbox row unread, a job in it ready for review. */
export const hasNews = (s: { needs?: boolean; review?: boolean }) => !!s.needs || !!s.review
