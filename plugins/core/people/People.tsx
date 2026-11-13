import {
  BookOpen, Cake, Flag, Handshake, Mail, MapPin, MessageCircle, MessageSquare, Phone, StickyNote, Users, type LucideIcon,
} from "lucide-react"
import {
  addDays, AddToTimeline, capitalize, cn, dateText, Editable, Empty, fmtDay, ink, isArchived, KV, List, openFile, Panel, parse, range, Row, Section, Stat, timelineOf,
  today, WeeksGrid, type BlockCtx, type Store, type TimelineEntry, type TimelineKind,
} from "@vaultite"
import { ageOn, birthdayText, bornOn, nearness, nextBirthday, parseBirthday, until, upcoming } from "./birthdays"
import { often } from "./often"
import type { Interaction, Person } from "./types"

const TINT = "var(--people)"
const KINDS: Record<string, { label: string; icon: LucideIcon }> = {
  call: { label: "Call", icon: Phone },
  "hang out": { label: "Hang out", icon: Users },
  meet: { label: "Meet-up", icon: Handshake },
  study: { label: "Study session", icon: BookOpen },
  text: { label: "Text", icon: MessageSquare },
  message: { label: "Message", icon: MessageCircle },
  email: { label: "Email", icon: Mail },
  note: { label: "Note", icon: StickyNote },
}
const kindOf = (k: string) => KINDS[k] ?? { label: capitalize(k), icon: MessageCircle }
export const TIMELINE_KINDS: Record<string, TimelineKind> = Object.fromEntries(
  Object.entries(KINDS).map(([k, v]) => [k, k === "note" ? v : { ...v, tint: TINT }]))
const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 864e5)

const byPerson = new WeakMap<Store, Map<string, Interaction[]>>()
function timeline(s: Store, p: Person) {
  let all = byPerson.get(s)
  if (!all) {
    all = new Map()
    for (const i of s.interactions) { const l = all.get(i.person_id); if (l) l.push(i); else all.set(i.person_id, [i]) }
    byPerson.set(s, all)
  }
  return all.get(p.id) ?? []
}
const contacts = (s: Store, p: Person) => timeline(s, p).filter((i) => i.kind !== "note")
function status(s: Store, p: Person) {
  const last: Interaction | undefined = contacts(s, p)[0]
  const since = last ? daysBetween(last.date, today()) : null
  const every = (p.every_days ?? 0) > 0 ? p.every_days! : 0
  const due = !!every && (since === null || since >= every)
  const overdue = every ? (since === null ? Infinity : since - every) : -Infinity
  return { last, since, due, overdue }
}
const ago = (since: number | null) =>
  since === null ? "Never" : since === 0 ? "Today" : since === 1 ? "Yesterday" : `${since} d ago`
const dayIn = (d: string) => fmtDay(d).replace(/^(Today|Yesterday)$/, (w) => w.toLowerCase())
const lastLine = (last?: Interaction) => (last ? `Last ${kindOf(last.kind).label.toLowerCase()} ${dayIn(last.date)}` : "No check-ins yet")

function Dots({ s, p }: { s: Store; p: Person }) {
  const days = new Set(contacts(s, p).map((i) => i.date))
  return (
    <div className="hidden gap-[3px] sm:flex lg:hidden xl:flex" aria-hidden>
      {range(addDays(today(), -13), 14).map((d) => (
        <span key={d} className={cn("size-2 rounded-full", !days.has(d) && "bg-muted")}
          style={days.has(d) ? { background: TINT } : undefined} />
      ))}
    </div>
  )
}

const open = (p: Person) => () => openFile(`${p.id}.md`)
const everyone = (s: Store) => s.people.filter((p) => !isArchived(p)).map((p) => ({ p, st: status(s, p) }))

export function PeopleDue({ store }: BlockCtx) {
  const all = everyone(store)
  const due = all.filter((x) => x.st.due && x.st.last).sort((a, b) => b.st.overdue - a.st.overdue)
  const fresh = all.filter((x) => !x.st.last).length
  return (
    <Panel title="Reach out" icon={Users} tint={TINT}>
      {!due.length ? (
        <Empty>{fresh ? `Nobody is overdue. ${fresh} people have no check-ins yet: add one to their timeline, or tell Claude.` : "You're caught up with everyone."}</Empty>
      ) : (
        <List>
          {due.map(({ p, st }) => (
            <Row key={p.id} title={p.name} onOpen={open(p)}
              meta={`${lastLine(st.last)} · ${often(p.every_days!)}`}
              right={<span className="font-medium" style={{ color: ink(TINT) }}>{st.overdue ? `${st.overdue} d overdue` : "Due today"}</span>} />
          ))}
        </List>
      )}
    </Panel>
  )
}

export function PeopleWants({ store }: BlockCtx) {
  const wants = everyone(store).filter((x) => x.p.want_to)
  return (
    <Panel title="Want to reach out" icon={Flag} tint={TINT}>
      {!wants.length ? (
        <Empty>Nobody on the list. Tell Claude who you'd like to talk to or meet.</Empty>
      ) : (
        <List>
          {wants.map(({ p, st }) => (
            <Row key={p.id} title={p.name} onOpen={open(p)} wrap
              meta={[p.want_to, p.location].filter(Boolean).join(" · ")}
              right={st.last ? ago(st.since) : p.relation === "contact" ? "Never talked" : undefined} />
          ))}
        </List>
      )}
    </Panel>
  )
}

const NEAR = { soon: "var(--red)", near: "var(--orange)" } as const
const nearTint = (days: number) => { const n = nearness(days); return n ? NEAR[n] : undefined }
const MONTH = { month: "short" } as const, WEEKDAY = { weekday: "long" } as const, MONTH_DAY = { month: "short", day: "numeric" } as const
const MONTH_DAY_YEAR = { ...MONTH_DAY, year: "numeric" } as const

function DayTile({ date, tint }: { date: string; tint?: string }) {
  return (
    <span role="img" aria-label={dateText(parse(date), MONTH_DAY)} className={cn("flex size-10 shrink-0 flex-col items-center justify-center rounded-[8px]", !tint && "bg-muted")}
      style={tint ? { background: `color-mix(in srgb, ${tint} 14%, transparent)`, color: ink(tint) } : undefined}>
      <span className={cn("text-[10px] leading-[12px] font-semibold", !tint && "text-muted-foreground")}>{dateText(parse(date), MONTH)}</span>
      <span className="num text-[16px] leading-[18px] font-semibold">{Number(date.slice(8, 10))}</span>
    </span>
  )
}

export function PeopleBirthdays({ store, options }: BlockCtx) {
  const next = upcoming(store.people.filter((p) => !isArchived(p)), today(), Number(options.count) || 10)
  return (
    <Panel title="Birthdays" icon={Cake} tint={TINT}>
      {!next.length ? (
        <Empty>No birthdays yet. Add one to a person's file, or tell Claude.</Empty>
      ) : (
        <List>
          {next.map(({ person: p, date, days, turns }) => {
            const tint = nearTint(days)
            return (
              <Row key={p.id} title={p.name} onOpen={open(p)} lead={<DayTile date={date} tint={tint} />} data-birthday={days}
                meta={[dateText(parse(date), WEEKDAY), turns !== null && `turns ${turns}`].filter(Boolean).join(" · ")}
                right={<span className={cn(tint && "font-medium")} style={tint ? { color: ink(tint) } : undefined}>{capitalize(until(days))}</span>} />
            )
          })}
        </List>
      )}
    </Panel>
  )
}

function BirthdayValue({ value }: { value: string }) {
  const b = parseBirthday(value)
  if (!b) return <>{value}</>
  const now = today(), n = nextBirthday(b, now), age = ageOn(b, now), tint = nearTint(n.days)
  return (
    <>
      {[dateText(parse(bornOn(b)), b.year !== null ? MONTH_DAY_YEAR : MONTH_DAY), n.days && age !== null && `age ${age}`].filter(Boolean).join(" · ")}
      {tint && <> · <span className="font-medium whitespace-nowrap" style={{ color: ink(tint) }}>{until(n.days)}</span></>}
    </>
  )
}

const strs = (v: unknown) => (Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : []).map((x) => x.trim().toLowerCase()).filter(Boolean)

export function PeopleGroup({ store, options }: BlockCtx) {
  const relations = strs(options.relations)
  const title = typeof options.title === "string" ? options.title : "People"
  const members = store.people.filter((p) => !isArchived(p) && (!relations.length || relations.includes(p.relation)))
  if (!members.length) return <Panel title={title} tint={TINT}><Empty>No one {relations.length ? `with relation ${relations.join(" or ")}` : "yet"}.</Empty></Panel>
  const close = relations.some((r) => ["partner", "family", "roommate", "friend"].includes(r))
  return (
    <Panel title={title} tint={TINT}>
      <List>
        {members.map((p) => {
          const st = status(store, p)
          if (!close) return <Row key={p.id} title={p.name} meta={p.context || capitalize(p.relation)} onOpen={open(p)} wrap right={ago(st.since)} />
          const meta = p.context || [p.relation !== "friend" && p.relation !== "family" && capitalize(p.relation), p.usual && capitalize(p.usual),
            p.every_days && often(p.every_days)].filter(Boolean).map(String).map((x, i) => (i ? x : capitalize(x))).join(" · ")
          return (
            <Row key={p.id} title={p.name} onOpen={open(p)} meta={meta} wrap
              right={<div className="flex items-center gap-3"><Dots s={store} p={p} />
                <span className={cn("w-16 text-right", st.due && "font-medium")} style={st.due ? { color: TINT } : undefined}>{ago(st.since)}</span></div>} />
          )
        })}
      </List>
    </Panel>
  )
}

const isUrl = (v: string) => /^https?:\/\//.test(v)
const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
function ContactValue({ v }: { v: string }) {
  const href = isUrl(v) ? v : isEmail(v) ? `mailto:${v}` : null
  return href ? <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">{v.replace(/^https?:\/\/(www\.)?/, "")}</a> : <>{v}</>
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v))
const list = (v: unknown) => (Array.isArray(v) ? v.map(String) : str(v).split(",")).map((t) => t.trim()).filter(Boolean)

export function PersonBlock({ fm, body, path, setProperty }: BlockCtx) {
  const entries = timelineOf(body)
  const touch = entries.filter((i) => i.kind !== "note").sort((a, b) => b.date.localeCompare(a.date))
  const last = touch[0]
  const since = last ? daysBetween(last.date, today()) : null
  const every = Number(fm.every_days) > 0 ? Number(fm.every_days) : null
  const last30 = touch.filter((i) => i.date >= addDays(today(), -29)).length
  const tags = list(fm.tags)
  const location = str(fm.location), moving = str(fm.moving_to), want = str(fm.want_to), contact = str(fm.contact)
  const usual = str(fm.usual), relation = str(fm.relation), context = str(fm.context)
  const birthday = birthdayText(fm.birthday) || str(fm.birthday)
  const edit = (key: string) => setProperty && ((v: string | undefined) => setProperty(key, v))
  const byDate = new Map<string, TimelineEntry[]>()
  for (const i of touch) byDate.set(i.date, [...(byDate.get(i.date) ?? []), i])
  const keep = [every && capitalize(often(every)), usual && `usually ${usual}`].filter(Boolean).join(", ")
  return (
    <div className="space-y-4">
      {(context || location || !!tags.length || setProperty) && (
        <div>
          <p className="text-[17px] leading-[22px] text-muted-foreground empty:hidden">
            <Editable value={context} set={edit("context")} placeholder="Add how you know them" />
          </p>
          {(location || !!tags.length || setProperty) && (
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px] max-md:text-[15px]">
              {(location || setProperty) && (
                <span className="mr-1 flex items-center gap-1 text-muted-foreground">
                  <MapPin className="size-3.5 shrink-0" strokeWidth={2.25} />
                  <Editable value={location} set={edit("location")} placeholder="Add where they live" />{moving && `, moving to ${moving}`}
                </span>
              )}
              {tags.map((t) => <span key={t} className="rounded-full bg-muted px-2.5 py-0.5">{t}</span>)}
            </div>
          )}
        </div>
      )}
      {want && (
        <div className="flex min-h-11 items-center gap-3 rounded-[10px] px-3 py-2.5 text-[15px] font-medium"
          style={{ background: `color-mix(in srgb, ${TINT} 14%, transparent)` }}>
          <Flag className="size-[18px] shrink-0" style={{ color: TINT }} strokeWidth={2.25} />
          <Editable value={want} set={edit("want_to")} placeholder="Add something to do" className="flex-1" />
        </div>
      )}
      <div className="grid grid-cols-2 gap-4">
        <Stat label="Last in touch" value={last ? ago(since) : "—"}
          hint={last ? kindOf(last.kind).label : relation === "contact" ? "Never talked" : "Nothing logged yet"} />
        <Stat label="Last 30 days" value={last30} hint={last30 === 1 ? "contact" : "contacts"} />
      </div>
      {(keep || contact || birthday) && (
        <div className="rounded-[10px] bg-foreground/[0.04] px-3">
          <List>
            {birthday && <KV label="Birthday"><Editable value={birthday} set={edit("birthday")} placeholder="Add a birthday"><BirthdayValue value={birthday} /></Editable></KV>}
            {keep && <KV label="Keep in touch">{keep}</KV>}
            {contact && <KV label="Contact"><Editable value={contact} set={edit("contact")} placeholder="Add a contact"><ContactValue v={contact} /></Editable></KV>}
          </List>
        </div>
      )}
      {touch.length >= 3 && (
        <Section title="Check-ins">
          <WeeksGrid tint={TINT} weeks={8} tip={(d) => byDate.get(d)?.map((i) => kindOf(i.kind).label).join(", ") ?? null} />
        </Section>
      )}
      {!/^#{1,6}\s+timeline\s*#*\s*$/im.test(body) && <AddToTimeline path={path} kinds={TIMELINE_KINDS} />}
    </div>
  )
}
