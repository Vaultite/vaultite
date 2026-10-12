/** For the Plugins page: a made-up note, as it looks when opened. */
export function NotePreview() {
  return (
    <article className="p-5">
      <h1 className="text-[28px] leading-[34px] font-bold">Voice-first journaling</h1>
      <div className="mt-5 space-y-3 text-[17px] leading-[26px]">
        <p>Talk through the day on the walk home; Claude turns it into a journal entry and links the people in it.</p>
        <p>Ties into <span style={{ color: "var(--notes)" }} className="font-medium">Vaultite</span> and the daily plan.</p>
      </div>
    </article>
  )
}
