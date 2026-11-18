import { activeFile, dismissNotice, getStore, insertOnOwnLine, notify, notifyError, pasteAttachments, put, readFile, reload } from "@vaultite"

/** Call it while the tap or key that asked is being handled: WebKit opens a picker for nothing else. */
function pickMedia(): Promise<File[]> {
  const el = document.createElement("input")
  Object.assign(el, { type: "file", accept: "image/*,video/*", multiple: true, hidden: true })
  // (inside an open sheet when there is one: outside it the page is inert)
  ;(document.querySelector("dialog[open]") ?? document.body).appendChild(el)
  return new Promise((done) => {
    const end = (files: File[]) => { el.remove(); done(files) }
    el.addEventListener("change", () => end([...(el.files ?? [])]), { once: true })
    el.addEventListener("cancel", () => end([]), { once: true })
    el.click()
  })
}

export async function addPhotos(path: string, insert?: (text: string) => void) {
  const files = await pickMedia()
  const s = getStore()
  if (!files.length || !s) return
  const id = "add-photo"
  const what = mediaNoun(files)
  notify(`Adding the ${what}…`, { id, duration: Infinity })
  try {
    // (an iPhone camera names every shot "image.jpg")
    const embed = await pasteAttachments(s, path, files)
    await reload()
    if (insert) insert(embed)
    else if (activeFile()?.path === path) insertOnOwnLine(embed)
    else {
      const f = await readFile(path)
      await put("file", { path, text: f.text + (f.text && !f.text.endsWith("\n") ? "\n" : "") + `${embed}\n`, base: f.text })
    }
    dismissNotice(id)
  } catch (e) {
    dismissNotice(id)
    notifyError(e, `Couldn't add the ${what}`)
  }
}

function mediaNoun(files: File[]) {
  const videos = files.filter((f) => f.type.startsWith("video/")).length, many = files.length > 1
  if (!videos) return many ? "photos" : "photo"
  if (videos === files.length) return many ? "videos" : "video"
  return "photos and videos"
}
