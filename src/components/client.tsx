"use client";
import { useFormStatus } from "react-dom";
import { cx } from "./ui";
import type { ComponentProps } from "react";

/** Submit button for server-action forms: shows a pending shimmer while the action runs. */
export function SubmitButton({ children, pendingText, variant = "primary", size = "md", className, ...p }: ComponentProps<"button"> & { pendingText?: string; variant?: "primary" | "green" | "glass" | "ghost" | "danger"; size?: "sm" | "md" | "lg" }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || p.disabled}
      className={cx(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-200 whitespace-nowrap disabled:opacity-60 active:scale-[.98] focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-green",
        size === "sm" ? "h-9 px-4 text-[13px]" : size === "lg" ? "h-13 px-7 text-[15.5px]" : "h-11 px-5 text-[14.5px]",
        variant === "primary" && "bg-cta text-[#fcfcfc] shadow-(--shadow-cta) hover:bg-[#2f2c2c]",
        variant === "green" && "bg-green text-white shadow-(--shadow-cta) hover:bg-[#15603e]",
        variant === "glass" && "glass !rounded-full text-head hover:bg-white",
        variant === "ghost" && "text-head hover:bg-white/60",
        variant === "danger" && "bg-rose text-white",
        className,
      )}
      {...p}
    >
      {pending && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {pending ? pendingText ?? children : children}
    </button>
  );
}
