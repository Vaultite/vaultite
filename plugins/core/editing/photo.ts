// Add photo: the system's picker (an iPhone offers its library, the camera and files), each image saved as an
// attachment of the note, as a pasted one is, and embedded on a line of its own.
import { activeFile, dismissNotice, getStore, insertOnOwnLine, notify, notifyError, pasteAttachments, put, readFile, reload } from "@vaultite"

/** Images chosen with the system's picker; none when it's cancelled. Call it while the tap or key that asked is being
 *  handled: WebKit opens a picker for nothing else. */
export function pickImages(): Promise<File[]> {
  const el = document.createElement("input")
  Object.assign(el, { type: "file", accept: "image/*", multiple: true, hidden: true })
  // (inside an open sheet when there is one: outside it the page is inert)
  ;(document.querySelector("dialog[open]") ?? document.body).appendChild(el)
  return new Promise((done) => {
    const end = (files: File[]) => { el.remove(); done(files) }
    el.addEventListener("change", () => end([...(el.files ?? [])]), { once: true })
    el.addEventListener("cancel", () => end([]), { once: true })
    el.click()
  })
}

const p2 = (n: number) => String(n).padStart(2, "0")
/** A photo the iPhone's camera takes is always "image.jpg": named for when it was added instead. */
function named(f: File, d: Date) {
  if (!/^image\.\w+$/i.test(f.name)) return f
  const ext = f.name.split(".").pop()!.toLowerCase().replace("jpeg", "jpg")
  return new File([f], `Photo ${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}.${p2(d.getMinutes())}.${p2(d.getSeconds())}.${ext}`, { type: f.type })
}

/** Pick photos and add them to the note `path`: with `insert` (the slash menu's), else at the cursor when it's the note
 *  being edited, else at its end. */
export async function addPhotos(path: string, insert?: (text: string) => void) {
  const files = await pickImages()
  const s = getStore()
  if (!files.length || !s) return
  const id = "add-photo"
  notify(files.length > 1 ? "Adding the photos…" : "Adding the photo…", { id, duration: Infinity })
  try {
    const now = new Date()
    const embed = await pasteAttachments(s, path, files.map((f) => named(f, now)))
    await reload() // (the store has the file before the embed is drawn)
    if (insert) insert(embed)
    else if (activeFile()?.path === path) insertOnOwnLine(embed)
    else {
      const f = await readFile(path)
      await put("file", { path, text: f.text + (f.text && !f.text.endsWith("\n") ? "\n" : "") + `${embed}\n`, base: f.text })
    }
    dismissNotice(id)
  } catch (e) {
    dismissNotice(id)
    notifyError(e, files.length > 1 ? "Couldn't add the photos" : "Couldn't add the photo")
  }
}
