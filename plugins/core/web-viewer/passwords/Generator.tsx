import { useState, type ReactNode } from "react"
import { RefreshCw, X } from "lucide-react"
import { Segmented, Slider, Switch } from "@vaultite"
import { generatorOptions, keptOptions, type Kind, type Options, type Separator } from "./genoptions"
import { Act } from "./parts"

const KINDS = [["upper", "A–Z"], ["lower", "a–z"], ["digits", "0–9"], ["symbols", "!#$"]] as const
const SEPARATORS: { value: Separator; label: string }[] = [{ value: "-", label: "Dash" }, { value: ".", label: "Dot" }, { value: "_", label: "Underscore" }, { value: " ", label: "Space" }]

export function Generator({ make, close }: { make: (o: Options) => void; close: () => void }) {
  const [o, setO] = useState(generatorOptions)
  const set = (change: Partial<Options>) => { const next = { ...o, ...change }; setO(next); keptOptions.set(next); make(next) }
  const on = KINDS.filter(([k]) => o[k]).length
  return (
    <div className="mt-1 flex flex-col gap-3 rounded-[10px] bg-foreground/[0.04] px-3 py-3" data-password-generator={o.kind}>
      <div className="flex items-center gap-2">
        <Segmented<Kind> value={o.kind} options={[{ value: "password", label: "Password" }, { value: "passphrase", label: "Passphrase" }]} onChange={(kind) => set({ kind })} label="Kind" small className="min-w-0 flex-1" />
        <Act icon={RefreshCw} label="Another one" run={() => make(o)} />
        <Act icon={X} label="Close generator" run={close} />
      </div>
      {o.kind === "password" ? <>
        <Amount label="Length" n={o.length} min={8} max={64} set={(length) => set({ length })} />
        <div className="flex flex-wrap gap-x-5 gap-y-2.5">
          {KINDS.map(([k, label]) => <Choice key={k} label={label} on={o[k]} disabled={o[k] && on === 1} set={(v) => set({ [k]: v })} />)}
        </div>
        <Choice label="Leave out look-alikes (0 O, 1 l I)" on={o.clear} set={(clear) => set({ clear })} />
      </> : <>
        <Amount label="Words" n={o.words} min={3} max={12} set={(words) => set({ words })} />
        <Segmented<Separator> value={o.separator} options={SEPARATORS} onChange={(separator) => set({ separator })} label="Between words" small />
        <div className="flex flex-wrap gap-x-5 gap-y-2.5">
          <Choice label="Capitalize" on={o.capitals} set={(capitals) => set({ capitals })} />
          <Choice label="Add a digit" on={o.number} set={(number) => set({ number })} />
        </div>
      </>}
    </div>
  )
}

function Amount({ label, n, min, max, set }: { label: string; n: number; min: number; max: number; set: (n: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <Says>{label} <span className="text-muted-foreground tabular-nums">{n}</span></Says>
      <Slider value={n} min={min} max={max} label={label} onInput={set} onChange={(v) => { if (v !== n) set(v) }} className="min-w-0 flex-1" />
    </div>
  )
}
const Says = ({ children }: { children: ReactNode }) => <span className="w-20 shrink-0 text-[15px] md:text-[13px]">{children}</span>

function Choice({ label, on, disabled, set }: { label: string; on: boolean; disabled?: boolean; set: (on: boolean) => void }) {
  return (
    <span className="flex items-center gap-2 text-[15px] md:text-[13px]">
      <Switch on={on} label={label} disabled={disabled} onChange={set} />{label}
    </span>
  )
}
