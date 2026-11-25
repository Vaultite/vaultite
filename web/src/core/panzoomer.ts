import { closestOf } from "@/core/dom"
import { isNumber } from "../../../core/values.ts"
import { closerScale, fitScale, held, mostScale, steppedScale, wheelPx, wheelScale, zoomedAbout, type Pt, type Size, type View } from "@/core/panzoom"

const SLOP = 4, TWICE_MS = 320, TWICE_PX = 32, GLIDE_MS = 200, FLING = 0.35

export type Drawn = View & { fitted: boolean }
export type PanZoomOptions = {
  size: () => Size | null
  paint: (v: Drawn) => void
  pad?: number
  grows?: () => boolean
  clicks?: () => boolean
  taps?: boolean
  moves: () => boolean
}

type Gesture = Event & { scale: number; clientX: number; clientY: number }
const isGesture = (e: Event): e is Gesture => "scale" in e && isNumber(e.scale) && "clientX" in e && "clientY" in e

const gap = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y)
const between = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

export class PanZoom {
  private view: View = { k: 1, x: 0, y: 0 }
  private fitted = true
  private last: Size = { w: 0, h: 0 }
  private frame = 0
  private flying = false
  private fingers = new Map<number, Pt>()
  private start: Pt = { x: 0, y: 0 }
  private moved = false
  private touch = false
  private tap: (Pt & { t: number }) | null = null
  private speed: Pt & { t: number } = { x: 0, y: 0, t: 0 }
  private pinched = 1
  private readonly quit = new AbortController()
  private readonly watch: ResizeObserver
  private readonly box: HTMLElement
  private readonly o: PanZoomOptions

  constructor(box: HTMLElement, o: PanZoomOptions) {
    this.box = box
    this.o = o
    const { signal } = this.quit, live = { signal, passive: false }
    box.addEventListener("wheel", (e) => this.onWheel(e), live)
    box.addEventListener("pointerdown", (e) => this.onDown(e), { signal })
    box.addEventListener("pointermove", (e) => this.onMove(e), { signal })
    for (const end of ["pointerup", "pointercancel"] as const) box.addEventListener(end, (e) => this.onUp(e), { signal })
    box.addEventListener("click", (e) => this.onClick(e), { signal, capture: true })
    // Two fingers scroll the page otherwise, which ends a pinch with a pointercancel.
    for (const t of ["touchstart", "touchmove"] as const) box.addEventListener(t, (e) => { if (e.touches.length > 1 && e.cancelable) e.preventDefault() }, live)
    // Safari on a Mac sends a pinch as its own events; on iOS they only echo the touches.
    if (!navigator.maxTouchPoints) for (const g of ["gesturestart", "gesturechange"]) box.addEventListener(g, (e) => this.onGesture(e), live)
    this.watch = new ResizeObserver(() => this.refresh())
    this.watch.observe(box)
    this.refresh()
  }

  destroy() { this.quit.abort(); this.watch.disconnect(); cancelAnimationFrame(this.frame) }

  get zoomed() { return !this.fitted }
  get scale() { return this.view.k }

  refresh() {
    const c = this.o.size(), b = this.room()
    if (!c || !b.w || !b.h) return
    this.still()
    if (this.fitted) return this.show(this.whole(c, b))
    const mid = { x: this.view.x + (b.w - this.last.w) / 2, y: this.view.y + (b.h - this.last.h) / 2 }
    this.show({ k: this.view.k, ...mid })
  }
  fit() { const c = this.o.size(); if (c) this.glideTo(this.whole(c, this.room())) }
  fitWidth() {
    const c = this.o.size(), b = this.room()
    if (c) this.glideTo({ k: b.w / c.w, x: 0, y: this.view.y * (b.w / c.w / this.view.k) })
  }
  zoomTo(k: number, at: Pt = this.middle()) { this.glideTo(zoomedAbout(this.view, this.within(k), at)) }
  step(dir: 1 | -1) { this.zoomTo(steppedScale(this.view.k, dir)) }
  pan(dx: number, dy: number) { this.glideTo({ ...this.view, x: this.view.x - dx, y: this.view.y - dy }) }
  toggle(at: Pt) { if (this.fitted) this.zoomTo(closerScale(this.view.k, 1 / (devicePixelRatio || 1)), at); else this.fit() }

  private room(): Size { return { w: this.box.clientWidth, h: this.box.clientHeight } }
  private middle(): Pt { const b = this.room(); return { x: b.w / 2, y: b.h / 2 } }
  private least(c: Size) { return fitScale(c, this.room(), this.o.pad, this.o.grows?.()) }
  private within(k: number) {
    const c = this.o.size(), least = c ? this.least(c) : 1
    return Math.max(least, Math.min(mostScale(least), k))
  }
  private whole(c: Size, b: Size): View { const k = this.least(c); return { k, x: (b.w - c.w * k) / 2, y: (b.h - c.h * k) / 2 } }
  private at(e: { clientX: number; clientY: number }): Pt {
    const r = this.box.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  private hasOwn(e: Event) {
    const own = closestOf(e.target, "button, a, input")
    return !!own && own !== this.box && this.box.contains(own)
  }

  private show(to: View) {
    const c = this.o.size()
    if (!c) return
    this.last = this.room()
    const k = this.within(to.k)
    this.view = held({ ...to, k }, c, this.last, this.o.pad)
    this.fitted = k <= this.least(c) * 1.001
    this.o.paint({ ...this.view, fitted: this.fitted })
  }
  private still() { cancelAnimationFrame(this.frame); this.frame = 0; this.flying = false }
  private glideTo(to: View) {
    this.still()
    const c = this.o.size(), b = this.room()
    if (!c) return
    const from = this.view, end = held({ ...to, k: this.within(to.k) }, c, b, this.o.pad)
    if (!this.o.moves()) return this.show(end)
    const t0 = performance.now(), m = this.middle()
    const a = { x: (m.x - from.x) / from.k, y: (m.y - from.y) / from.k }, z = { x: (m.x - end.x) / end.k, y: (m.y - end.y) / end.k }
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / GLIDE_MS), e = 1 - (1 - p) ** 3, k = from.k * (end.k / from.k) ** e
      this.frame = p < 1 ? requestAnimationFrame(tick) : 0
      this.show(p < 1 ? { k, x: m.x - (a.x + (z.x - a.x) * e) * k, y: m.y - (a.y + (z.y - a.y) * e) * k } : end)
    }
    this.frame = requestAnimationFrame(tick)
  }
  private fling() {
    let { x, y } = this.speed, was = performance.now()
    this.flying = true
    const tick = (t: number) => {
      const ms = Math.min(40, t - was), slow = 0.995 ** ms
      was = t; x *= slow; y *= slow
      this.frame = Math.hypot(x, y) > 0.02 ? requestAnimationFrame(tick) : 0
      this.show({ ...this.view, x: this.view.x + x * ms, y: this.view.y + y * ms })
    }
    this.frame = requestAnimationFrame(tick)
  }

  private onWheel(e: WheelEvent) {
    const by = wheelPx(e, this.box.clientHeight), zooms = e.ctrlKey || e.metaKey
    if (!zooms && this.fitted) return
    e.preventDefault()
    this.still()
    this.show(zooms ? zoomedAbout(this.view, this.within(this.view.k * wheelScale(by.y || by.x)), this.at(e)) : { ...this.view, x: this.view.x - by.x, y: this.view.y - by.y })
  }
  private onGesture(e: Event) {
    if (!isGesture(e)) return
    e.preventDefault()
    if (e.type === "gesturestart") { this.still(); this.pinched = this.view.k; return }
    this.show(zoomedAbout(this.view, this.within(this.pinched * e.scale), this.at(e)))
  }

  private onDown(e: PointerEvent) {
    if ((e.pointerType === "mouse" && e.button !== 0) || this.hasOwn(e)) return
    if (this.flying) this.still()
    this.touch = e.pointerType !== "mouse"
    this.fingers.set(e.pointerId, this.at(e))
    this.moved = this.fingers.size > 1
    this.start = this.at(e)
    this.speed = { x: 0, y: 0, t: e.timeStamp }
  }
  private onMove(e: PointerEvent) {
    const was = this.fingers.get(e.pointerId)
    if (!was) return
    const now = this.at(e), other = [...this.fingers].find(([id]) => id !== e.pointerId)?.[1]
    if (!other && !this.moved && gap(now, this.start) < SLOP) return
    this.still()
    if (other) { this.fingers.set(e.pointerId, now); return this.pinch(other, was, now) }
    this.fingers.set(e.pointerId, now)
    this.moved = true
    if (this.fitted) return
    this.box.setPointerCapture(e.pointerId)
    this.box.dataset.panning = ""
    const ms = Math.max(1, e.timeStamp - this.speed.t)
    this.speed = { x: (now.x - was.x) / ms, y: (now.y - was.y) / ms, t: e.timeStamp }
    this.show({ ...this.view, x: this.view.x + now.x - was.x, y: this.view.y + now.y - was.y })
  }
  private pinch(other: Pt, was: Pt, now: Pt) {
    const a = between(other, was), b = between(other, now)
    const v = zoomedAbout(this.view, this.within(this.view.k * (gap(other, now) / Math.max(1, gap(other, was)))), a)
    this.show({ ...v, x: v.x + b.x - a.x, y: v.y + b.y - a.y })
  }
  private onUp(e: PointerEvent) {
    if (!this.fingers.delete(e.pointerId) || this.fingers.size) return
    delete this.box.dataset.panning
    if (this.touch && !this.fitted && this.moved && this.o.moves() && e.timeStamp - this.speed.t < 60 && Math.hypot(this.speed.x, this.speed.y) > FLING) this.fling()
  }
  private onClick(e: MouseEvent) {
    if (this.hasOwn(e)) return
    if (this.moved) { if (!this.fitted) { e.preventDefault(); e.stopPropagation() } return }
    const at = this.at(e)
    if (!this.touch) { if (this.o.clicks?.() && e.detail < 2) this.toggle(at); return }
    const twice = this.tap && e.timeStamp - this.tap.t < TWICE_MS && gap(this.tap, at) < TWICE_PX
    this.tap = twice ? null : { ...at, t: e.timeStamp }
    if (twice && this.o.taps) this.toggle(at)
  }
}
