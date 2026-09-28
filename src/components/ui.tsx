import Link from "next/link";
import clsx from "clsx";
import type { ComponentProps, ReactNode } from "react";

export const cx = clsx;

type BtnVariant = "primary" | "glass" | "ghost" | "green" | "danger";
const btn = (variant: BtnVariant = "primary", size: "sm" | "md" | "lg" = "md") =>
  cx(
    "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 select-none whitespace-nowrap disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green active:scale-[.98]",
    size === "sm" && "h-9 px-4 text-[13px]",
    size === "md" && "h-11 px-5 text-[14.5px]",
    size === "lg" && "h-13 px-7 text-[15.5px]",
    variant === "primary" && "bg-cta text-[#fcfcfc] shadow-(--shadow-cta) hover:bg-[#2f2c2c]",
    variant === "green" && "bg-green text-white shadow-(--shadow-cta) hover:bg-[#15603e]",
    variant === "glass" && "glass !rounded-full text-head hover:bg-white",
    variant === "ghost" && "text-head hover:bg-white/60",
    variant === "danger" && "bg-rose text-white hover:brightness-110",
  );

export function Button({ variant, size, className, ...p }: ComponentProps<"button"> & { variant?: BtnVariant; size?: "sm" | "md" | "lg" }) {
  return <button className={cx(btn(variant, size), className)} {...p} />;
}
export function ButtonLink({ variant, size, className, ...p }: ComponentProps<typeof Link> & { variant?: BtnVariant; size?: "sm" | "md" | "lg" }) {
  return <Link className={cx(btn(variant, size), className)} {...p} />;
}

export function Card({ className, strong, ...p }: ComponentProps<"div"> & { strong?: boolean }) {
  return <div className={cx(strong ? "glass-strong" : "glass", "p-5 sm:p-6", className)} {...p} />;
}

export function Label({ className, ...p }: ComponentProps<"div">) {
  return <div className={cx("label", className)} {...p} />;
}

export function H({ as: Tag = "h2", size = "m", className, children }: { as?: "h1" | "h2" | "h3" | "div"; size?: "xl" | "l" | "m" | "s"; className?: string; children: ReactNode }) {
  const sz = { xl: "text-[clamp(40px,6vw,76px)]", l: "text-[clamp(30px,4vw,48px)]", m: "text-[clamp(22px,2.4vw,30px)]", s: "text-[19px]" }[size];
  return <Tag className={cx("h-serif", sz, className)}>{children}</Tag>;
}

/** Pinyon Script accent inside serif headlines, like the landing ("your AI Career *Agent*"). */
export const Script = ({ children }: { children: ReactNode }) => <span className="script">{children}</span>;

type Tone = "neutral" | "green" | "teal" | "amber" | "rose" | "dark";
const tones: Record<Tone, string> = {
  neutral: "bg-white/75 text-head border-stroke",
  green: "bg-green-soft text-green border-green/15",
  teal: "bg-teal/10 text-teal border-teal/15",
  amber: "bg-amber-soft text-amber border-amber/15",
  rose: "bg-rose-soft text-rose border-rose/15",
  dark: "bg-cta text-white border-transparent",
};
export function Chip({ tone = "neutral", className, children, dot }: { tone?: Tone; className?: string; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10.5px] uppercase leading-none tracking-[.06em] whitespace-nowrap", tones[tone], className)}>
      {dot && <span className="size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  );
}

export function Stat({ label, value, hint, tone }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "green" | "rose" }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <div className={cx("num text-[32px] leading-none text-head", tone === "green" && "text-green", tone === "rose" && "text-rose")}>{value}</div>
      {hint && <div className="text-[12.5px] text-ink-3">{hint}</div>}
    </div>
  );
}

export function Progress({ value, className, tone = "green" }: { value: number; className?: string; tone?: "green" | "teal" | "amber" | "rose" }) {
  const c = { green: "bg-green", teal: "bg-teal", amber: "bg-amber", rose: "bg-rose" }[tone];
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-head/10", className)}>
      <div className={cx("h-full rounded-full transition-[width] duration-700", c)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}

/** Circular score (0–100). */
export function Ring({ value, size = 88, stroke = 7, label, className }: { value: number; size?: number; stroke?: number; label?: ReactNode; className?: string }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const color = value >= 75 ? "var(--color-green)" : value >= 50 ? "var(--color-teal)" : value >= 30 ? "var(--color-amber)" : "var(--color-rose)";
  return (
    <div className={cx("relative inline-grid place-items-center", className)} style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgb(35 59 59 / .1)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)} style={{ transition: "stroke-dashoffset 1s cubic-bezier(.16,1,.3,1)" }} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="num leading-none text-head" style={{ fontSize: size * 0.3 }}>{Math.round(value)}</div>
          {label && <div className="label mt-1 !text-[9px]">{label}</div>}
        </div>
      </div>
    </div>
  );
}

export function PageHeader({ eyebrow, title, sub, actions }: { eyebrow?: string; title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-7 flex flex-col gap-4 animate-rise sm:flex-row sm:items-end sm:justify-between">
      <div className="flex flex-col gap-2.5">
        {eyebrow && <Label>{eyebrow}</Label>}
        <h1 className="h-serif text-[clamp(30px,3.6vw,46px)]">{title}</h1>
        {sub && <p className="max-w-2xl text-[15px] text-ink-2">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Empty({ title, sub, action }: { title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="glass flex flex-col items-center gap-3 px-6 py-12 text-center">
      <div className="size-2.5 rounded-full bg-green animate-pulse-dot" />
      <div className="h-serif text-[22px]">{title}</div>
      {sub && <p className="max-w-md text-[14px] text-ink-3">{sub}</p>}
      {action}
    </div>
  );
}

export function Field({ label, hint, children, className }: { label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1.5", className)}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function Divider({ className }: { className?: string }) {
  return <div className={cx("h-px w-full bg-line", className)} />;
}

export function DemoBadge() {
  return <Chip tone="amber">demo</Chip>;
}

export const Logo = ({ className, white }: { className?: string; white?: boolean }) => (
  // eslint-disable-next-line @next/next/no-img-element
  <img src={white ? "/brand/nav_logo_white.svg" : "/brand/nav_logo.svg"} alt="Simplify" className={cx("h-[22px] w-auto", className)} />
);
