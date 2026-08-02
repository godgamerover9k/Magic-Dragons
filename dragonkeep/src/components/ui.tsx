"use client";

import type { ReactNode } from "react";

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-lg border border-line bg-panel ${className}`}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  label,
  aside,
}: {
  label: string;
  aside?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="eyebrow min-w-0 truncate">{label}</h2>
      {aside && <div className="shrink-0">{aside}</div>}
    </div>
  );
}

/**
 * Figures read badly inside a heading on a narrow screen — wide letter-spacing
 * plus a long string wraps into an unreadable block. They get their own row,
 * with the number leading and the label underneath.
 */
export function StatStrip({
  items,
}: {
  items: { label: string; value: string }[];
}) {
  return (
    <div className="mb-3 flex flex-wrap gap-x-5 gap-y-2">
      {items.map((item) => (
        <div key={item.label} className="min-w-0">
          <p className="num text-sm leading-tight">{item.value}</p>
          <p className="eyebrow">{item.label}</p>
        </div>
      ))}
    </div>
  );
}

type ButtonProps = {
  children: ReactNode;
  onClick?: () => void;
  variant?: "solid" | "outline" | "ghost" | "danger";
  size?: "sm" | "md";
  disabled?: boolean;
  title?: string;
  full?: boolean;
};

export function Button({
  children,
  onClick,
  variant = "outline",
  size = "sm",
  disabled,
  title,
  full,
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded font-medium transition-colors disabled:opacity-35 disabled:cursor-not-allowed";
  const sizes = size === "sm" ? "px-2.5 py-1.5 text-xs" : "px-3.5 py-2 text-sm";
  const variants = {
    solid: "bg-verdigris text-ink hover:bg-verdigris/85",
    outline: "border border-line text-bone hover:border-verdigris hover:text-verdigris",
    ghost: "text-muted hover:text-bone",
    danger: "border border-warn/50 text-warn hover:bg-warn/10",
  }[variant];
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`${base} ${sizes} ${variants} ${full ? "w-full" : ""}`}
    >
      {children}
    </button>
  );
}

export function Bar({
  value,
  max,
  color = "var(--color-verdigris)",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-line">
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, backgroundColor: color }}
      />
    </div>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="eyebrow mb-1 block">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-lg border border-dashed border-line px-5 py-8 text-center">
      <p className="font-display text-base">{title}</p>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{body}</p>
    </div>
  );
}
