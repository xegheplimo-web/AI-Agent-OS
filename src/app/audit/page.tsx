"use client";

import { useQuery } from "@tanstack/react-query";
import { FileSearch, FolderOutput } from "lucide-react";
import Link from "next/link";
import { ApprovalsPanel } from "@/components/audit/approvals-panel";
import { AuditConsole } from "@/components/audit/audit-console";
import { FindingsTable } from "@/components/audit/findings-table";
import { api } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { cn, formatDuration } from "@/lib/utils";
import { Panel, StatusDot } from "@/components/ui";

function StageCards() {
  const environment = useUIStore((s) => s.environment);
  const audits = useQuery({
    queryKey: ["audits", environment],
    queryFn: () => api.audits(`environment=${environment}`),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === "running") ? 1200 : 6000),
  });
  const latest = audits.data?.[0];
  const stages = latest?.stages ?? [];

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {stages.map((s, i) => {
        return (
          <Panel key={s.key} title={`${i + 1} · ${s.label}`} icon={FileSearch} tone={i === 0 ? "cyan" : i === 1 ? "violet" : "mint"}>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-[0.16em] uppercase" style={{ color: s.status === "done" ? "#20e3a2" : s.status === "active" ? "#37d6ff" : "#7890aa" }}>
                <StatusDot status={s.status === "active" ? "running" : s.status === "done" ? "done" : "pending"} pulse={s.status === "active"} />
                {s.status}
              </span>
              {s.durationMs && <span className="font-mono text-[10px] text-mute">{formatDuration(s.durationMs)}</span>}
            </div>
            <p className="mt-2 line-clamp-3 min-h-[42px] font-mono text-[10px] leading-relaxed text-mute">{s.detail}</p>
            <div className="mt-3 border-t border-ink/8 pt-2.5">
              <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[9px] tracking-widest text-mute uppercase">
                <FolderOutput className="size-3 text-cyan/70" /> artifacts ({s.artifacts.length})
              </div>
              <div className="space-y-1">
                {s.artifacts.slice(0, 4).map((a) => (
                  <div key={a} className={cn("truncate rounded border border-ink/8 bg-ink/4 px-2 py-1 font-mono text-[9.5px]", s.status === "done" ? "text-[#9fc4e8]" : "text-mute/60")}>
                    {a}
                  </div>
                ))}
                {s.artifacts.length === 0 && (
                  <div className="rounded border border-dashed border-ink/10 px-2 py-1.5 text-center font-mono text-[9.5px] text-mute/50">
                    chờ stage chạy…
                  </div>
                )}
              </div>
            </div>
          </Panel>
        );
      })}
    </div>
  );
}

export default function AuditPage() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <AuditConsole />
        <ApprovalsPanel />
      </div>
      <div className="flex items-center gap-3">
        <div className="divider-glow flex-1" />
        <span className="font-mono text-[9px] tracking-[0.3em] text-mute uppercase">
          stage detail · <Link href="/knowledge" className="text-cyan/80 hover:text-cyan">artifacts trong Knowledge →</Link>
        </span>
        <div className="divider-glow flex-1" />
      </div>
      <StageCards />
      <FindingsTable />
    </div>
  );
}
