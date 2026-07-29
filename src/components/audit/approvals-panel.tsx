"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Check, GitPullRequestArrow, Hourglass, LogIn, X } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";
import { Chip, GhostButton, Panel } from "@/components/ui";

const ACTION_LABEL: Record<string, string> = {
  "audit.run": "AUDIT RUN",
  "artifact.push": "ARTIFACT PUSH",
  "artifact.package": "PACKAGE",
  "config.change": "CONFIG",
};

export function ApprovalsPanel() {
  const qc = useQueryClient();
  const setLoginOpen = useUIStore((s) => s.setLoginOpen);

  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => api.approvals(), refetchInterval: 5000 });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 30000 });

  const decide = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => api.decideApproval(id, decision),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["approvals"] });
      qc.invalidateQueries({ queryKey: ["audits"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setLoginOpen(true);
    },
  });

  const isAdmin = me.data?.user?.role === "administrator";
  const pending = approvals.data?.filter((a) => a.status === "pending") ?? [];
  const decided = approvals.data?.filter((a) => a.status !== "pending").slice(0, 4) ?? [];

  return (
    <Panel
      title="Human-in-the-loop Approvals"
      icon={GitPullRequestArrow}
      tone="amber"
      right={
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-mute">
          <Hourglass className="size-3 text-amber" />
          {pending.length} pending
        </span>
      }
    >
      {!isAdmin && (
        <button
          onClick={() => setLoginOpen(true)}
          className="mb-3 flex w-full items-center gap-2 rounded-lg border border-cyan/30 bg-cyan/8 px-3 py-2 text-[11.5px] text-cyan transition-colors hover:bg-cyan/15"
        >
          <LogIn className="size-3.5" />
          {me.data?.user ? "Quyền administrator cần thiết để phê duyệt — đổi tài khoản" : "Đăng nhập với quyền administrator để phê duyệt"}
        </button>
      )}

      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {pending.map((a) => (
            <motion.div
              key={a.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -12 }}
              className="glass-soft rounded-xl border-amber/25 px-3 py-2.5"
              style={{ boxShadow: "0 0 18px rgba(255,180,84,0.08)" }}
            >
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 size-2 shrink-0 animate-blink rounded-full bg-amber shadow-[0_0_7px_rgba(255,180,84,0.8)]" />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] leading-snug text-ink/95">{a.title}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <Chip tone="amber">{ACTION_LABEL[a.actionType] ?? a.actionType}</Chip>
                    <Chip tone="azure">{a.environment}</Chip>
                    <span className="font-mono text-[9.5px] text-mute">
                      bởi <span className="text-cyan/80">{a.requestedBy}</span> · {timeAgo(a.requestedAt)}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mt-2.5 flex items-center justify-end gap-2">
                <GhostButton
                  onClick={() => decide.mutate({ id: a.id, decision: "rejected" })}
                  disabled={decide.isPending || !isAdmin}
                  className={cn(isAdmin && "hover:!border-rose/50 hover:!bg-rose/10 hover:!text-rose")}
                >
                  <X className="size-3.5" /> Từ chối
                </GhostButton>
                <GhostButton
                  onClick={() => decide.mutate({ id: a.id, decision: "approved" })}
                  disabled={decide.isPending || !isAdmin}
                  active={isAdmin}
                  className={cn(isAdmin && "!border-mint/50 !bg-mint/10 !text-mint")}
                >
                  <Check className="size-3.5" /> Phê duyệt
                </GhostButton>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {pending.length === 0 && (
          <div className="rounded-lg border border-dashed border-ink/12 px-3 py-4 text-center font-mono text-[10.5px] text-mute">
            Không có yêu cầu nào đang chờ — mọi gate đều thông.
          </div>
        )}

        {decided.length > 0 && (
          <div className="border-t border-ink/8 pt-2">
            <div className="mb-1.5 font-mono text-[9px] tracking-[0.2em] text-mute uppercase">Gần đây</div>
            {decided.map((a) => (
              <div key={a.id} className="flex items-center gap-2 py-1 text-[11px]">
                {a.status === "approved" ? (
                  <Check className="size-3.5 shrink-0 text-mint" />
                ) : (
                  <X className="size-3.5 shrink-0 text-rose" />
                )}
                <span className="min-w-0 flex-1 truncate text-mute">{a.title}</span>
                <span className="shrink-0 font-mono text-[9px] text-mute/70">
                  {a.decidedBy} · {timeAgo(a.decidedAt ?? a.requestedAt)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
