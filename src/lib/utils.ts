import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function timeAgo(input: string | Date): string {
  const d = typeof input === "string" ? new Date(input) : input;
  const sec = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return `${Math.round(n)}`;
}

export const SEVERITY_ORDER = ["critical", "high", "medium", "low", "info"] as const;

export const SEVERITY_STYLES: Record<string, { dot: string; text: string; chip: string }> = {
  critical: {
    dot: "bg-[#ff5f7a]",
    text: "text-[#ff8ba0]",
    chip: "border-[#ff5f7a]/40 bg-[#ff5f7a]/10 text-[#ff8ba0]",
  },
  high: {
    dot: "bg-[#ff9f43]",
    text: "text-[#ffb877]",
    chip: "border-[#ff9f43]/40 bg-[#ff9f43]/10 text-[#ffb877]",
  },
  medium: {
    dot: "bg-[#ffd166]",
    text: "text-[#ffe08f]",
    chip: "border-[#ffd166]/40 bg-[#ffd166]/10 text-[#ffe08f]",
  },
  low: {
    dot: "bg-[#37d6ff]",
    text: "text-[#7fe6ff]",
    chip: "border-[#37d6ff]/40 bg-[#37d6ff]/10 text-[#7fe6ff]",
  },
  info: {
    dot: "bg-[#7890aa]",
    text: "text-[#a9bdd4]",
    chip: "border-[#7890aa]/40 bg-[#7890aa]/10 text-[#a9bdd4]",
  },
};

export const STATUS_COLORS: Record<string, string> = {
  healthy: "#20e3a2",
  degraded: "#ffb454",
  offline: "#ff5f7a",
  readonly: "#8b5cf6",
  passed: "#20e3a2",
  warning: "#ffb454",
  failed: "#ff5f7a",
  pending: "#7890aa",
  running: "#37d6ff",
  completed: "#20e3a2",
  queued: "#7890aa",
  active: "#37d6ff",
  done: "#20e3a2",
  open: "#ff9f43",
  acknowledged: "#37d6ff",
  resolved: "#20e3a2",
  waiting_approval: "#ffb454",
  cancelled: "#7890aa",
  timed_out: "#ff5f7a",
  preparing: "#37d6ff",
  pending_approval: "#ffb454",
};

export function sparklinePath(values: number[], w = 90, h = 26, pad = 2): string {
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const step = (w - pad * 2) / (values.length - 1);
  return values
    .map((v, i) => {
      const x = pad + i * step;
      const y = h - pad - ((v - min) / range) * (h - pad * 2);
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}
