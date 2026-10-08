// Sections Health adds to a log's sheet: a workout's exercises and sets, a session's climbs.
import { cn, Group, Section } from "@vaultite"
import type { Log } from "@plugins/core/logs/types"
import { exercises, fmtSet } from "./gym"

export function LogSections({ log }: { log: Log }) {
  const d = log.data ?? {}
  return (
    <>
      {!!exercises(log).length && (
        <Section title="Exercises">
          <div className="space-y-3">
            {exercises(log).map((e, i) => {
              let n = 0
              return (
                <Group key={i}>
                  <div className="py-2 text-[15px] font-semibold">{e.name}</div>
                  {e.sets.map((s, j) => {
                    const warm = s.type === "warmup"
                    if (!warm) n++
                    const label = warm ? "W" : s.type === "failure" ? "F" : s.type === "dropset" ? "D" : String(n)
                    return (
                      <div key={j} className={cn("flex items-center gap-3 py-1.5 text-[15px]", warm && "text-muted-foreground")}>
                        <span className="num w-5 text-center text-[13px] font-semibold"
                          style={{ color: warm ? undefined : s.type === "failure" ? "var(--red)" : s.type === "dropset" ? "var(--purple)" : undefined }}>
                          {label}
                        </span>
                        <span className="num">{fmtSet(s)}</span>
                      </div>
                    )
                  })}
                </Group>
              )
            })}
          </div>
        </Section>
      )}
      {!!d.climbs?.length && (
        <Section title="Climbs">
          <Group>
            {(d.climbs as { grade: string; color?: string; note?: string }[]).map((c, i) => (
              <div key={i} className="flex min-h-11 items-center gap-3 py-2 text-[15px]">
                <span className="num w-10 font-semibold">{c.grade}</span>
                {c.color && (
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                    <span className="size-3 rounded-full ring-1 ring-foreground/15" style={{ background: c.color }} />{c.color}
                  </span>
                )}
                {c.note && <span className="min-w-0 truncate text-muted-foreground">{c.note}</span>}
              </div>
            ))}
          </Group>
        </Section>
      )}
    </>
  )
}
