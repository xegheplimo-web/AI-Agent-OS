"use client";

import { AlertOctagon, Inbox, RefreshCcw, ShieldAlert, WifiOff } from "lucide-react";
import { ApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import { GhostButton } from "@/components/ui";

/* ------------------------------------------------------------------ */
/* Consistent panel states: error / empty / retry / permission.        */
/* ------------------------------------------------------------------ */

export function ApiErrorState({
  error,
  onRetry,
  className,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
}) {
  const status = error instanceof ApiError ? error.status : 0;
  const permission = status === 401 || status === 403;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  const Icon = permission ? ShieldAlert : offline ? WifiOff : AlertOctagon;
  const title = permission
    ? "Không đủ quyền truy cập"
    : offline
      ? "Mất kết nối mạng"
      : "Không tải được dữ liệu";
  const detail =
    error instanceof Error ? error.message : "Đã xảy ra lỗi không xác định khi gọi API.";

  return (
    <div className={cn("flex flex-col items-center justify-center gap-2.5 px-6 py-10 text-center", className)}>
      <span className={cn("flex size-11 items-center justify-center rounded-2xl border", permission ? "border-amber/40 bg-amber/10" : "border-rose/40 bg-rose/10")}>
        <Icon className={cn("size-5", permission ? "text-amber" : "text-rose")} />
      </span>
      <div className="font-display text-[13px] font-semibold text-ink">{title}</div>
      <p className="max-w-sm font-mono text-[10.5px] leading-relaxed text-mute">{detail}</p>
      {onRetry && (
        <GhostButton onClick={onRetry} className="mt-1.5">
          <RefreshCcw className="size-3.5" /> Thử lại
        </GhostButton>
      )}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  icon: Icon = Inbox,
  action,
  className,
}: {
  title: string;
  hint?: string;
  icon?: typeof Inbox;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}>
      <span className="flex size-11 items-center justify-center rounded-2xl border border-line/60 bg-ink/4">
        <Icon className="size-5 text-mute" />
      </span>
      <div className="font-display text-[13px] font-semibold text-ink/90">{title}</div>
      {hint && <p className="max-w-xs font-mono text-[10.5px] leading-relaxed text-mute">{hint}</p>}
      {action}
    </div>
  );
}
