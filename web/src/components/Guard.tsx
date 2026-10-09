// One part of the app that fails to draw (a tab, a panel, a header item, a sheet) fails alone, with a way on (Try again,
// Close tab); without it React unmounts the whole app. A file that didn't load is errors.ts's: it reloads.
import { Component, Fragment, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import { isStaleBuild, recoverFromStaleBuild } from "@/core/errors"

type Props = {
  children: ReactNode
  /** What it is, as the message names it: "This tab", "The Terminals panel". */
  what: string
  /** A tab's (the pane's room, with Close tab) or a small one's (a line, in a sidebar or the header). */
  size?: "tab" | "small"
  /** It changed (another file, another view): draw it again. */
  reset?: string
  /** Close what failed (a tab's). */
  close?: () => void
}
type State = { failed: boolean; error: unknown; reset?: string; tries: number; stale: "waiting" | "failed" | null }

/** Calls a plugin's `render` while drawing, inside the Guard around it (called by the parent, what it throws would
 *  pass the Guard by). */
export function Drawn({ draw }: { draw: () => ReactNode }) { return <>{draw()}</> }

/** What fails to draw inside shows `fallback` (given what was thrown) in its place, again drawn when `reset` changes. */
export class Catch extends Component<{ children: ReactNode; fallback: (error: unknown) => ReactNode; reset?: string; onError?: (e: unknown) => void },
  { failed: boolean; error: unknown; reset?: string }> {
  state = { failed: false, error: null as unknown, reset: this.props.reset }
  static getDerivedStateFromError(error: unknown) { return { failed: true, error } }
  static getDerivedStateFromProps(p: { reset?: string }, s: { reset?: string }) { return p.reset === s.reset ? null : { failed: false, error: null, reset: p.reset } }
  componentDidCatch(e: unknown) { this.props.onError?.(e) }
  render() { return this.state.failed ? this.props.fallback(this.state.error) : this.props.children }
}

const textOf = (e: unknown) => (e instanceof Error ? e.stack || `${e.name}: ${e.message}` : String(e))

export class Guard extends Component<Props, State> {
  state: State = { failed: false, error: null, reset: this.props.reset, tries: 0, stale: null }
  static getDerivedStateFromError(error: unknown): Partial<State> { return { failed: true, error, stale: isStaleBuild(error) ? "waiting" : null } }
  static getDerivedStateFromProps(p: Props, s: State): Partial<State> | null {
    return p.reset === s.reset ? null : { failed: false, error: null, reset: p.reset, stale: null }
  }
  componentDidCatch(error: unknown) {
    if (isStaleBuild(error)) void recoverFromStaleBuild(error, false).then((reloading) => { if (!reloading && this.state.error === error) this.setState({ stale: "failed" }) })
  }
  retry = () => this.setState((s) => ({ failed: false, error: null, tries: s.tries + 1, stale: null }))
  render() {
    const { what, size = "small", close, children } = this.props
    const { failed, error, tries, stale } = this.state
    if (!failed) return <Fragment key={tries}>{children}</Fragment>
    const message = textOf(error)
    if (size === "small") {
      return (
        <p role="alert" data-guard-failed={what} data-tip={message} className="px-2 py-1 text-[13px] text-muted-foreground">
          {stale === "waiting" ? "Reconnecting…" : <>{what} couldn't be drawn. <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={this.retry}>Try again</button></>}
        </p>
      )
    }
    return (
      <div role="alert" data-guard-failed={what} className="mx-auto max-w-[720px] px-8 pt-12 pb-6">
        <h2 className="text-[17px] font-semibold">{stale === "waiting" ? "Reconnecting to Vaultite…" : `${what} couldn't be drawn`}</h2>
        <p className="mt-1 text-[15px] text-muted-foreground">
          {stale === "waiting" ? "Part of the app didn't load. It reloads once the server answers."
            : "The rest of the app still works. Trying again may help if it was passing; if it comes back, it's a bug in the app's code (or the plugin's)."}
        </p>
        {stale !== "waiting" && <>
          <pre className="mt-4 max-h-[40vh] overflow-auto rounded-[6px] border border-border px-3 py-2 font-mono text-[12px] leading-normal break-words whitespace-pre-wrap select-text">{message}</pre>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" onClick={stale === "failed" ? () => location.reload() : this.retry}>{stale === "failed" ? "Reload" : "Try again"}</Button>
            {close && <Button variant="outline" onClick={close}>Close tab</Button>}
            <Button variant="ghost" onClick={(e) => { const b = e.currentTarget; void navigator.clipboard?.writeText(`${what} couldn't be drawn\n${message}`).then(() => { b.textContent = "Copied" }, () => {}) }}>Copy error</Button>
          </div>
        </>}
      </div>
    )
  }
}
