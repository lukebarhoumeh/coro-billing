import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";

export type ButtonVariant = "default" | "outline" | "ghost";

const styles: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow-brass-glow transition-[transform,box-shadow] duration-150 ease-glass hover:-translate-y-px hover:bg-primary/90 motion-reduce:transition-none motion-reduce:hover:translate-y-0",
  outline: "border border-edge bg-glass-1 hover:bg-glass-2",
  ghost: "bg-glass-1 hover:bg-glass-2",
};

export function Button({
  variant = "default",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        styles[variant],
        className
      )}
      {...props}
    />
  );
}
