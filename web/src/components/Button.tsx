// The app's buttons: text ones (Button, or buttonClass for a link drawn as one) and the small icon ones of a panel's
// heading. Only React here: the setup window (onboarding.html) draws them without the app.
import type { ButtonHTMLAttributes, ComponentType } from "react"
import { cn } from "@/lib/utils"

const BUTTON = "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 font-medium transition-colors disabled:cursor-default disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:outline-none"
const BUTTON_SIZE = { normal: "h-9 rounded-[8px] px-3.5 text-[15px] md:h-8 md:text-[13px]", small: "h-7 rounded-[6px] px-3 text-[13px]" }
const BUTTON_LOOK = {
  primary: "bg-primary text-primary-foreground hover:bg-primary/85",
  secondary: "bg-foreground/[0.06] text-foreground hover:bg-foreground/[0.1]",
  outline: "border-[0.5px] border-border bg-background hover:bg-foreground/[0.05]",
  quiet: "text-muted-foreground hover:bg-foreground/[0.06] hover:text-foreground",
}
type ButtonLook = { look?: keyof typeof BUTTON_LOOK; size?: keyof typeof BUTTON_SIZE }
/** A button's classes, for a link drawn as one. */
export const buttonClass = ({ look = "secondary", size = "normal" }: ButtonLook = {}, className?: string) => cn(BUTTON, BUTTON_SIZE[size], BUTTON_LOOK[look], className)
/** A text button (an icon may lead): `primary` for what the page is for, `secondary` beside it. */
export function Button({ look, size, className, type = "button", ...rest }: ButtonLook & ButtonHTMLAttributes<HTMLButtonElement> & Record<`data-${string}`, unknown>) {
  return <button type={type} className={buttonClass({ look, size }, className)} {...rest} />
}

/** An icon button in a panel's heading or a row: its label is its tooltip unless `tip` says otherwise. */
export function HeadingButton({ icon: Icon, label, tip = label, strokeWidth = 2.25, className, ...rest }: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>; label: string; tip?: string; strokeWidth?: number
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & Record<`data-${string}`, unknown>) {
  return (
    <button type="button" aria-label={label} data-tip={tip} {...rest}
      className={cn("grid size-5 cursor-pointer place-items-center rounded-[4px] text-muted-foreground hover:bg-foreground/[0.08] hover:text-foreground", className)}>
      <Icon className="size-3.5" strokeWidth={strokeWidth} />
    </button>
  )
}
