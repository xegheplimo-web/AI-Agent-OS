"use client";

import { motion } from "framer-motion";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tone = "cyan" | "azure" | "violet" | "mint" | "rose" | "amber";

export const TONE_TEXT: Record<Tone, string> = {
  cyan: "text-cyan",
  azure: "text-azure",
  violet: "text-violet",
  mint: "text-mint",
  rose: "text-rose",
  amber: "text-amber",
};

export const TONE_BG: Record<Tone, string> = {
  cyan: "bg-cyan",
  azure: "bg-azure",
  violet: "bg-violet",
  mint: "bg-mint",
  rose: "bg-rose",
  amber: "bg-amber",
};

const TONE_CHIP: Record<Tone, string> = {
  cyan: "border-cyan/35 bg-cyan/10 text-cyan",
  azure: "border-azure/35 bg-azure/10 text-azure",
  violet: "border-violet/35 bg-violet/10 text-violet",
  mint: "border-mint/35 bg-mint/10 text-mint",
  rose: "border-rose/35 bg-rose/10 text-rose",
  amber: "border-amber/35 bg-amber/10 text-amber",
};

const TONE_ICON: Record<Tone, string> = {
  cyan: "border-cyan/30 bg-cyan/10 text-cyan shadow-[0_0_14px_rgba(55,214,255,0.25)]",
  azure: "border-azure/30 bg-azure/10 text-azure shadow-[0_0_14px_rgba(49,135,255,0.25)]",
  violet: "border-violet/30 bg-violet/10 text-violet shadow-[0_0_14px_rgba(139,92,246,0.3)]",
  mint: "border-mint/30 bg-mint/10 text-mint shadow-[0_0_14px_rgba(32,227,162,0.25)]",
  rose: "border-rose/30 bg-rose/10 text-rose shadow-[0_0_14px_rgba(255,95,122,0.25)]",
  amber: "border-amber/30 bg-amber/10 text-amber shadow-[0_0_14px_rgba(255,180,84,0.25)]",
};

/* ---------------- Panel ---------------- */
export function Panel({
  title,
  icon: Icon,
  tone = "cyan",
  right,
  className,
  bodyClassName,
  children,
  corner = true,
  pad = true,
}: {
  title?: string;
  icon?: LucideIcon;
  tone?: Tone;
  right?: ReactNode;
  className?: string;
  bodyClassName?: string;
  children: ReactNode;
  corner?: boolean;
  pad?: boolean;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
      className={cn("glass rounded-2xl", corner && "hud-corner", className)}
    >
      {title && (
        <header className="flex items-center gap-2.5 border-b border-line/60 px-4 py-3">
          {Icon && (
            <span className={cn("flex size-7 items-center justify-center rounded-lg border", TONE_ICON[tone])}>
              <Icon className="size-3.5" strokeWidth={2.2} />
            </span>
          )}
          <h2 className="font-display text-[11px] font-semibold tracking-[0.22em] text-ink/90 uppercase">
            {title}
          </h2>
          <div className="ml-auto flex items-center gap-2">{right}</div>
        </header>
      )}
      <div className={cn(pad && "p-4", bodyClassName)}>{children}</div>
    </motion.section>
  );
}

/* ---------------- Chips / badges ---------------- */
export function Chip({
  tone = "cyan",
  className,
  children,
}: {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-medium tracking-wide",
        TONE_CHIP[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function StatusDot({ status, pulse = false, className }: { status: string; pulse?: boolean; className?: string }) {
  const color =
    {
      healthy: "#20e3a2",
      passed: "#20e3a2",
      completed: "#20e3a2",
      done: "#20e3a2",
      resolved: "#20e3a2",
      degraded: "#ffb454",
      warning: "#ffb454",
      open: "#ffb454",
      offline: "#ff5f7a",
      failed: "#ff5f7a",
      critical: "#ff5f7a",
      readonly: "#8b5cf6",
      running: "#37d6ff",
      active: "#37d6ff",
      acknowledged: "#37d6ff",
    }[status] ?? "#7890aa";
  return (
    <span className={cn("relative inline-flex size-2", className)}>
      {pulse && (
        <span
          className="absolute inset-0 animate-ping-soft rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
      <span
        className="relative inline-flex size-2 rounded-full"
        style={{ backgroundColor: color, boxShadow: `0 0 8px ${color}` }}
      />
    </span>
  );
}

/* ---------------- Buttons ---------------- */
export function NeonButton({
  children,
  onClick,
  disabled,
  tone = "cyan",
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: Tone;
  className?: string;
}) {
  const tones: Record<Tone, string> = {
    cyan: "from-cyan/80 to-azure/80 text-[#012033] shadow-[0_0_24px_rgba(55,214,255,0.35)] hover:shadow-[0_0_36px_rgba(55,214,255,0.55)]",
    azure: "from-azure/80 to-cyan/70 text-[#011b33] shadow-[0_0_24px_rgba(49,135,255,0.35)] hover:shadow-[0_0_36px_rgba(49,135,255,0.55)]",
    violet: "from-violet/80 to-azure/70 text-white shadow-[0_0_24px_rgba(139,92,246,0.4)] hover:shadow-[0_0_36px_rgba(139,92,246,0.6)]",
    mint: "from-mint/80 to-cyan/70 text-[#013325] shadow-[0_0_24px_rgba(32,227,162,0.35)] hover:shadow-[0_0_36px_rgba(32,227,162,0.55)]",
    rose: "from-rose/80 to-amber/70 text-white shadow-[0_0_24px_rgba(255,95,122,0.35)]",
    amber: "from-amber/80 to-rose/70 text-[#331b01] shadow-[0_0_24px_rgba(255,180,84,0.35)]",
  };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "group inline-flex items-center gap-2 rounded-xl bg-gradient-to-r px-4 py-2 font-display text-[12px] font-semibold tracking-[0.08em] uppercase transition-all duration-300",
        "disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  active,
  className,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg border border-line/60 px-2.5 py-1.5 font-mono text-[11px] text-mute transition-all duration-200",
        "hover:border-cyan/40 hover:bg-cyan/10 hover:text-cyan",
        active && "border-cyan/50 bg-cyan/10 text-cyan",
        disabled && "cursor-not-allowed opacity-40 hover:border-line/60 hover:bg-transparent hover:text-mute",
        className,
      )}
    >
      {children}
    </button>
  );
}

/* ---------------- Progress ---------------- */
export function Progress({
  value,
  tone = "cyan",
  className,
}: {
  value: number;
  tone?: Tone;
  className?: string;
}) {
  const grad =
    tone === "violet"
      ? "from-violet to-cyan"
      : tone === "mint"
        ? "from-mint to-cyan"
        : tone === "rose"
          ? "from-rose to-amber"
          : "from-azure to-cyan";
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-ink/8", className)}>
      <motion.div
        className={cn("h-full rounded-full bg-gradient-to-r", grad)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.min(100, Math.max(0, value))}%` }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        style={{ boxShadow: "0 0 10px rgba(55,214,255,0.5)" }}
      />
    </div>
  );
}

/* ---------------- Radial gauge ---------------- */
export function RadialGauge({
  value,
  size = 148,
  stroke = 9,
  tone = "#20e3a2",
  label,
  sublabel,
}: {
  value: number;
  size?: number;
  stroke?: number;
  tone?: string;
  label?: string;
  sublabel?: string;
}) {
  const r = (size - stroke) / 2 - 4;
  const c = 2 * Math.PI * r;
  const off = c - (Math.min(100, value) / 100) * c;
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(120,160,200,0.12)" strokeWidth={stroke} />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          animate={{ strokeDashoffset: off }}
          transition={{ duration: 1.1, ease: [0.22, 1, 0.36, 1] }}
          style={{ filter: `drop-shadow(0 0 10px ${tone})` }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-3xl font-bold text-ink" style={{ textShadow: `0 0 18px ${tone}66` }}>
          {label ?? `${Math.round(value)}`}
        </span>
        {sublabel && <span className="font-mono text-[10px] tracking-widest text-mute uppercase">{sublabel}</span>}
      </div>
    </div>
  );
}

/* ---------------- Toggle ---------------- */
export function Toggle({ checked, onChange, tone = "mint" }: { checked: boolean; onChange: (v: boolean) => void; tone?: Tone }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-5 w-9.5 rounded-full border transition-colors duration-300",
        checked ? "border-mint/50 bg-mint/25" : "border-line/60 bg-ink/8",
        tone === "rose" && checked && "border-rose/50 bg-rose/25",
      )}
    >
      <motion.span
        layout
        transition={{ type: "spring", stiffness: 500, damping: 32 }}
        className={cn(
          "absolute top-0.5 left-0.5 size-3.5 rounded-full",
          checked ? "translate-x-4.5 bg-mint shadow-[0_0_8px_rgba(32,227,162,0.8)]" : "translate-x-0 bg-mute",
          tone === "rose" && checked && "bg-rose shadow-[0_0_8px_rgba(255,95,122,0.8)]",
        )}
      />
    </button>
  );
}

/* ---------------- KV row ---------------- */
export function KV({ k, v, tone = "text-ink" }: { k: string; v: ReactNode; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="font-mono text-[11px] text-mute">{k}</span>
      <span className={cn("font-mono text-[11px] font-medium", tone)}>{v}</span>
    </div>
  );
}

/* ---------------- Skeleton ---------------- */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("shimmer rounded-lg", className)} />;
}
