"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, CircleCheck, CircleDot, ListFilter, Search, ShieldAlert } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { cn, SEVERITY_STYLES, timeAgo } from "@/lib/utils";
import { Chip, GhostButton, Panel } from "@/components/ui";
import { ApiErrorState } from "@/components/feedback";

const SEVERITIES = ["all", "critical", "high", "medium", "low", "info"];
const STATUSES = [
  { key: "all", label: "tất cả" },
  { key: "open", label: "open" },
  { key: "acknowledged", label: "acked" },
  { key: "resolved", label: "resolved" },
];

const NEXT_STATUS: Record<string, string> = {
  open: "acknowledged",
  acknowledged: "resolved",
  resolved: "open",
};

export function FindingsTable() {
  const qc = useQueryClient();
  const { findingsFilter, setFindingsFilter } = useUIStore();
  const [expanded, setExpanded] = useState<number | null>(null);

  const params = new URLSearchParams();
  if (findingsFilter.severity !== "all") params.set("severity", findingsFilter.severity);
  if (findingsFilter.status !== "all") params.set("status", findingsFilter.status);
  if (findingsFilter.search) params.set("q", findingsFilter.search);

  const findings = useQuery({
    queryKey: ["findings", findingsFilter.severity, findingsFilter.status, findingsFilter.search],
    queryFn: () => api.findings(params.toString()),
    refetchInterval: 8000,
  });

  const patch = useMutation({
    mutationFn: ({ id, status }: { id: number; status: string }) => api.patchFinding(id, status),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["findings"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) useUIStore.getState().setLoginOpen(true);
    },
  });

  return (
    <Panel
      title="Security & Config Findings"
      icon={ShieldAlert}
      tone="rose"
      right={
        <span className="font-mono text-[10px] text-mute">
          {findings.data ? `${findings.data.length} mục` : "…"}
        </span>
      }
    >
      {/* filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ListFilter className="size-3.5 text-mute" />
        {SEVERITIES.map((s) => (
          <GhostButton key={s} active={findingsFilter.severity === s} onClick={() => setFindingsFilter({ severity: s })}>
            {s !== "all" && <span className={cn("size-1.5 rounded-full", SEVERITY_STYLES[s]?.dot)} />}
            {s}
          </GhostButton>
        ))}
        <span className="mx-1 h-4 w-px bg-line/60" />
        {STATUSES.map((s) => (
          <GhostButton key={s.key} active={findingsFilter.status === s.key} onClick={() => setFindingsFilter({ status: s.key })}>
            {s.label}
          </GhostButton>
        ))}
        <div className="relative ml-auto">
          <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-mute" />
          <input
            value={findingsFilter.search}
            onChange={(e) => setFindingsFilter({ search: e.target.value })}
            placeholder="Tìm theo title / component…"
            className="w-56 rounded-lg border border-line/60 bg-void/60 py-1.5 pr-3 pl-8 font-mono text-[11px] text-ink placeholder:text-mute/60 focus:border-cyan/50 focus:ring-1 focus:ring-cyan/30 focus:outline-none"
          />
        </div>
      </div>

      {/* rows */}
      <div className="space-y-1.5">
        {findings.isError && <ApiErrorState error={findings.error} onRetry={() => findings.refetch()} />}
        {findings.data?.map((f) => {
          const sev = SEVERITY_STYLES[f.severity];
          const open = expanded === f.id;
          return (
            <div key={f.id} className={cn("glass-soft overflow-hidden rounded-lg transition-all", open && "border-cyan/30")}>
              <button onClick={() => setExpanded(open ? null : f.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left">
                <span className={cn("size-2 shrink-0 rounded-full", sev.dot)} style={{ boxShadow: `0 0 7px currentColor` }} />
                <span className={cn("shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] font-semibold tracking-wider uppercase", sev.chip)}>
                  {f.severity}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink/90">{f.title}</span>
                <Chip tone="azure" className="hidden shrink-0 sm:inline-flex">{f.component}</Chip>
                <span className="hidden shrink-0 font-mono text-[10px] text-mute md:block">{f.category}</span>
                <span className="hidden shrink-0 font-mono text-[10px] text-mute lg:block">{timeAgo(f.createdAt)}</span>
                <ChevronDown className={cn("size-3.5 shrink-0 text-mute transition-transform", open && "rotate-180")} />
              </button>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    className="overflow-hidden"
                  >
                    <div className="space-y-2.5 border-t border-ink/8 px-3 py-3">
                      <p className="text-[12px] leading-relaxed text-mute">{f.description}</p>
                      <div className="rounded-lg border border-ink/10 bg-void/60 px-3 py-2 font-mono text-[10.5px] leading-relaxed text-cyan/85">
                        <span className="mr-2 text-mute/70">EVIDENCE</span>
                        {f.evidence}
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-[10px] text-mute">
                          trạng thái:{" "}
                          <span className={f.status === "resolved" ? "text-mint" : f.status === "acknowledged" ? "text-cyan" : "text-amber"}>
                            {f.status}
                          </span>
                        </span>
                        <GhostButton
                          onClick={() => patch.mutate({ id: f.id, status: NEXT_STATUS[f.status] })}
                          disabled={patch.isPending}
                        >
                          {f.status === "resolved" ? <CircleDot className="size-3.5" /> : <CircleCheck className="size-3.5" />}
                          đánh dấu {NEXT_STATUS[f.status]}
                        </GhostButton>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
        {findings.data?.length === 0 && (
          <div className="py-10 text-center font-mono text-[11px] text-mute">
            Không có finding nào khớp bộ lọc.
          </div>
        )}
        {findings.isLoading && (
          <div className="space-y-1.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="shimmer h-10 rounded-lg" />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}
