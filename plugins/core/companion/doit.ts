import { notify, notifyError, op, openView, type DoTask } from "@vaultite"

const going = new Set<string>()

export async function doTask(task: DoTask) {
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
