// Do it: a task handed to a worker (companion.do). Its button on a note's line: doitline.ts.
import { notify, notifyError, op, openView, type DoTask } from "@vaultite"

/** Hands `task` over: the toast opens its job. Whether it went. */
export async function doTask(task: DoTask) {
  try {
    const job = await op<{ id: string; title: string; link: string | null }>("companion.do", task)
    notify(`Handed off: ${job.title}`, job.link ? { action: { label: "Open", run: () => void openView(job.link!.replace(/^view:/, "")) } } : {})
    return true
  } catch (e) {
    notifyError(e, "Couldn't hand it off")
    return false
  }
}
