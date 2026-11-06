// Do it: a task handed to a worker (companion.do). Its button on a note's line: doitline.ts.
import { notify, notifyError, op, openView, type DoTask } from "@vaultite"

const going = new Set<string>()

/** Hands `task` over: the toast opens its job. Whether it went. */
export async function doTask(task: DoTask) {
  // (a phone's tap can arrive twice: once is what was meant)
  const key = `${task.path ?? ""}\0${task.text}`
  if (going.has(key)) return false
  going.add(key)
  setTimeout(() => going.delete(key), 3000)
  try {
    const job = await op<{ id: string; title: string; link: string | null }>("companion.do", task)
    notify(`Handed off: ${job.title}`, job.link ? { action: { label: "Open", run: () => void openView(job.link!.replace(/^view:/, "")) } } : {})
    return true
  } catch (e) {
    notifyError(e, "Couldn't hand it off")
    return false
  }
}
