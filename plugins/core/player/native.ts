// In the iPhone app, sound plays in the shell (ios/App/App/Audio.swift), not the page: this element stands in for an
// <audio>, so the rest of the player moves and drives it as one, and a reload or iOS ending the page can't stop it.
import { phoneAudio, type PhoneAudioState } from "@vaultite"
import { clock, parkEl, take } from "./now"

/** The element the shell plays for: one at a time, as the shell has one player. */
let owner: NativeAudio | null = null
type Err = { code: number; message: string }

class NativeAudio extends HTMLElement {
  private url = ""
  private t = 0
  private sampled = 0 // (performance.now() when t was so)
  private d = NaN
  private rate = 1
  private stopped = true
  private moving = false // playing, not waiting for data
  private done = false
  private err: Err | null = null
  private ready = 0
  private ticker: ReturnType<typeof setInterval> | undefined
  private adopting = false
  private bar: { play: HTMLButtonElement; at: HTMLElement; range: HTMLInputElement; left: HTMLElement } | null = null
  textTracks = [] as unknown as TextTrackList
  preload = "metadata"
  seeking = false

  get src() { return this.url }
  set src(v: string) {
    this.url = v ? new URL(v, location.href).href : ""
    this.d = NaN
    this.ready = 0
    if (this.url) this.probe()
  }
  get currentSrc() { return this.url }
  get duration() { return this.d }
  get paused() { return this.stopped }
  get ended() { return this.done }
  get readyState() { return this.ready }
  get error() { return this.err as MediaError | null }
  get currentTime() {
    const t = this.moving ? this.t + ((performance.now() - this.sampled) / 1000) * this.rate : this.t
    return Number.isFinite(this.d) ? Math.min(t, this.d) : t
  }
  set currentTime(v: number) {
    if (this.adopting || !Number.isFinite(v)) return // (the shell's time is the truth while a reloaded page takes it back)
    this.t = Math.max(0, v)
    this.sampled = performance.now()
    this.done = false
    this.seeking = true
    this.fire("seeking")
    if (owner === this) void phoneAudio!.seek({ t: this.t })
    else queueMicrotask(() => { this.seeking = false; this.fire("seeked"); this.fire("timeupdate") })
  }
  get playbackRate() { return this.rate }
  set playbackRate(v: number) {
    if (!(v > 0) || v === this.rate) return
    this.rate = v
    if (owner === this) void phoneAudio!.rate({ rate: v })
    this.fire("ratechange")
  }
  get controls() { return !!this.bar && !this.bar.play.parentElement!.hidden }
  set controls(on: boolean) {
    if (on && !this.bar) this.drawBar()
    if (this.bar) this.bar.play.parentElement!.hidden = !on
  }

  play(): Promise<void> {
    if (!this.url) return Promise.reject(new DOMException("Nothing to play", "NotSupportedError"))
    const was = owner
    owner = this
    if (was && was !== this) was.letGo()
    this.stopped = false
    this.done = false
    // (asked of the shell first: what the play event sets off, the lock screen's names, comes after it)
    const path = this.dataset.playerFor ?? ""
    const start = was === this ? Promise.resolve() : phoneAudio!.load({ path, url: this.url, t: this.t, rate: this.rate, from: this.dataset.from,
      title: path.split("/").pop()!.replace(/\.[^.]+$/, ""), artist: "", album: "Vaultite", chapters: [] }).then(() => {})
    const playing = start.then(() => phoneAudio!.play()).then((s) => { if (owner === this) this.apply(s) })
    this.fire("play")
    return playing
  }
  pause() {
    if (this.stopped) return
    this.stopped = true
    this.moving = false
    this.fire("pause")
    if (owner === this) void phoneAudio!.pause()
  }
  /** With no address (release(): `removeAttribute("src")`, then this), it lets the shell go. */
  load() {
    if (this.url) return this.probe()
    if (owner === this) { owner = null; void phoneAudio!.stop() }
  }
  removeAttribute(name: string) {
    if (name === "src") this.url = ""
    else super.removeAttribute(name)
  }
  canPlayType(type: string) { return /^audio\//.test(type) ? "maybe" : "" }

  /** What the shell says it does now: the state, and the events an <audio> would fire for the change. */
  apply(s: PhoneAudioState) {
    const was = { d: this.d, rate: this.rate, stopped: this.stopped, moving: this.moving, done: this.done }
    if (typeof s.t === "number") { this.t = s.t; this.sampled = performance.now() }
    if (typeof s.d === "number" && s.d > 0) this.d = s.d
    if (s.rate > 0) this.rate = s.rate
    this.stopped = s.paused
    this.moving = !s.paused && !s.waiting
    this.done = s.ended
    if (Number.isFinite(this.d) && !Number.isFinite(was.d)) { this.ready = 4; this.fire("durationchange"); this.fire("loadedmetadata") }
    if (this.rate !== was.rate) this.fire("ratechange")
    if (s.type === "seeked") { this.seeking = false; this.fire("seeked") }
    if (!this.stopped && was.stopped) this.fire("play")
    if (this.moving && !was.moving) this.fire("playing")
    if (!this.moving && !this.stopped && was.moving) this.fire("waiting")
    if (this.stopped && !was.stopped) this.fire("pause")
    if (this.done && !was.done) this.fire("ended")
    if (s.error && s.type === "error") { this.err = { code: 2, message: s.error }; this.fire("error") }
    this.fire("timeupdate")
    clearInterval(this.ticker)
    if (this.moving) this.ticker = setInterval(() => this.fire("timeupdate"), 250)
  }

  /** A reloaded page: this element takes back what the shell plays, as it is there. */
  adopt(s: PhoneAudioState) {
    owner = this
    this.adopting = true
    try { this.apply({ ...s, paused: true, waiting: false }) } finally { this.adopting = false }
    if (!s.paused) this.apply(s)
  }

  /** Another element plays now: this one stops, as far as anyone watching it knows. */
  private letGo() {
    clearInterval(this.ticker)
    this.moving = false
    if (!this.stopped) { this.stopped = true; this.fire("pause") }
  }

  /** Its length before it ever plays (a view shows it): the page's own <audio> reads the start of the file, and goes. */
  private probe() {
    if (Number.isFinite(this.d)) return
    const a = new Audio()
    a.preload = "metadata"
    a.addEventListener("loadedmetadata", () => {
      if (!Number.isFinite(this.d) && Number.isFinite(a.duration)) { this.d = a.duration; this.ready = 1; this.fire("durationchange"); this.fire("loadedmetadata") }
      a.removeAttribute("src")
      a.load()
    }, { once: true })
    a.addEventListener("error", () => { if (owner !== this) { this.err = { code: 4, message: "It couldn't be read" }; this.fire("error") } }, { once: true })
    a.src = this.url
  }

  private fire(type: string) {
    this.dispatchEvent(new Event(type))
    if (this.bar && (type === "timeupdate" || type === "play" || type === "pause" || type === "durationchange")) this.redraw()
  }

  // The browser's own controls, as a view shows them in a note: play, the time and a scrubber.
  private drawBar() {
    const root = this.attachShadow({ mode: "open" })
    root.innerHTML = `<style>
      :host { display: block; }
      div { display: flex; align-items: center; gap: 8px; height: 40px; padding: 0 4px; font: 12px/1 system-ui, sans-serif; font-variant-numeric: tabular-nums; color: inherit; }
      div[hidden] { display: none; }
      button { all: unset; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 999px; cursor: pointer; }
      button:active { background: color-mix(in srgb, currentColor 12%, transparent); }
      svg { width: 18px; height: 18px; fill: currentColor; }
      input { flex: 1; min-width: 0; accent-color: var(--primary, currentColor); }
      span { opacity: 0.7; }
    </style><div><button type="button" aria-label="Play"></button><span></span><input type="range" min="0" step="1" aria-label="Seek"><span></span></div>`
    const [play, at, range, left] = [root.querySelector("button")!, root.querySelectorAll("span")[0], root.querySelector("input")!, root.querySelectorAll("span")[1]]
    play.onclick = () => { if (this.stopped) void this.play().catch(() => {}); else this.pause() }
    range.oninput = () => { this.currentTime = Number(range.value) }
    this.bar = { play, at, range, left }
    this.redraw()
  }
  private redraw() {
    const b = this.bar!
    const PLAY = '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12.5-7.5z"/></svg>', PAUSE = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>'
    const icon = this.stopped ? PLAY : PAUSE
    if (b.play.innerHTML !== icon) { b.play.innerHTML = icon; b.play.ariaLabel = this.stopped ? "Play" : "Pause" }
    const t = this.currentTime
    b.at.textContent = clock(t)
    b.left.textContent = Number.isFinite(this.d) ? clock(this.d) : "--:--"
    if (Number.isFinite(this.d)) b.range.max = String(Math.floor(this.d))
    if (!this.seeking && document.activeElement !== this) b.range.value = String(Math.floor(t))
  }
}

if (phoneAudio && !customElements.get("vaultite-audio")) customElements.define("vaultite-audio", NativeAudio)

/** An element for a sound in the iPhone app; null elsewhere (the page plays it). */
export const nativeAudio = () => (phoneAudio ? (document.createElement("vaultite-audio") as unknown as HTMLMediaElement) : null)
export const isNative = (el: HTMLMediaElement) => el.localName === "vaultite-audio"

// What the shell does (the lock screen, headphones, a stall, the end) comes here, for the element it plays for.
if (phoneAudio) addEventListener("vaultite:audio", (e) => {
  const s = (e as CustomEvent<PhoneAudioState>).detail
  if (!owner) return
  if (s.type === "stop" || s.path !== owner.dataset.playerFor) { if (s.type === "stop") owner = null; return }
  owner.apply(s)
})

/** As the app starts: what the shell still plays (the page reloaded, or iOS ended it) is taken back, playing on. */
export function adoptNative() {
  if (!phoneAudio) return
  phoneAudio.state().then((s) => {
    if (!s.path || owner?.dataset.playerFor === s.path) return
    // (a view of it drawn before this asked, the note the page reopened, is the one)
    const el = (document.querySelector(`vaultite-audio[data-player-for="${CSS.escape(s.path)}"]`) ?? take(s.path, false)) as unknown as NativeAudio
    if (!isNative(el as unknown as HTMLMediaElement)) return
    if (s.from && !el.dataset.from) el.dataset.from = s.from
    if (!el.isConnected) parkEl(el as unknown as HTMLMediaElement)
    el.adopt(s)
  }, () => {})
}

/** The shell's lock screen and sleep timer, kept in step (now.ts' session and setSleep). */
export const describeNative = (info: Parameters<NonNullable<typeof phoneAudio>["info"]>[0]) => { void phoneAudio?.info(info) }
export const sleepNative = (s: { until?: number; chapter?: boolean }) => { void phoneAudio?.sleep(s) }
