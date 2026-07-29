"use client";

import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Box,
  ChevronRight,
  FileText,
  GitBranch,
  Package,
  PieChart,
  ScanSearch,
  ShieldCheck,
  Workflow,
} from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/ui";

const STAGES = [
  { key: "audit", label: "Audit", sub: "Thu thập & kiểm kê toàn hệ thống", icon: ScanSearch, tone: "#37d6ff" },
  { key: "analyze", label: "Analyze", sub: "Chuẩn hóa & phân tích đồ thị phụ thuộc", icon: PieChart, tone: "#8b5cf6" },
  { key: "document", label: "Document", sub: "Sinh báo cáo, sơ đồ, SBOM, runbook", icon: FileText, tone: "#3187ff" },
  { key: "build", label: "Build on clean VM", sub: "Dựng lại hệ thống trên môi trường sạch", icon: Box, tone: "#20e3a2" },
  { key: "verify", label: "Verify", sub: "Kiểm thử & đối chiếu 100% parity", icon: ShieldCheck, tone: "#20e3a2" },
  { key: "package", label: "Package", sub: "Đóng gói artifact, SBOM, tài liệu", icon: Package, tone: "#ffb454" },
  { key: "push", label: "Push to GitHub", sub: "Đẩy lên repo (read-only source)", icon: GitBranch, tone: "#e9f6ff" },
] as const;

type StageState = "done" | "active" | "pending";

export function LifecyclePipeline() {
  const audits = useQuery({
    queryKey: ["audits"],
    queryFn: () => api.audits(),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === "running") ? 1200 : 8000),
  });
  const jobs = useQuery({ queryKey: ["jobs"], queryFn: api.jobs, refetchInterval: 4000 });

  const approvals = useQuery({ queryKey: ["approvals"], queryFn: () => api.approvals(), refetchInterval: 6000 });
  const pushApproval = approvals.data?.find((a) => a.actionType === "artifact.package" && a.status === "pending");

  const latest = audits.data?.[0];
  const auditRunning = latest?.status === "running";
  const auditDone = latest?.status === "completed";
  const packagingJob = jobs.data?.find((j) => j.type === "artifact.package");

  const states: StageState[] = [
    auditRunning ? "active" : auditDone ? "done" : "pending",
    auditRunning ? (latest?.stages[1]?.status === "active" || latest?.stages[2]?.status === "active" ? "active" : "pending") : auditDone ? "done" : "pending",
    auditRunning ? (latest?.stages[2]?.status === "active" ? "active" : latest?.stages[2]?.status === "done" ? "done" : "pending") : auditDone ? "done" : "pending",
    auditDone ? "done" : "pending",
    auditDone ? "done" : "pending",
    packagingJob?.status === "running"
      ? "active"
      : packagingJob?.status === "completed"
        ? "done"
        : auditDone
          ? "pending"
          : "pending",
    pushApproval ? "active" : "pending", // human-in-the-loop approval gate (real data)
  ];

  return (
    <Panel
      title="Chuẩn hóa & Triển khai — AI Audit Lifecycle"
      icon={Workflow}
      tone="azure"
      pad={false}
      right={
        <div className="flex items-center gap-3 font-mono text-[9px] tracking-widest text-mute uppercase">
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-mint shadow-[0_0_5px_#20e3a2]" />done</span>
          <span className="flex items-center gap-1"><span className="size-1.5 animate-blink rounded-full bg-cyan shadow-[0_0_5px_#37d6ff]" />active</span>
          <span className="flex items-center gap-1"><span className="size-1.5 rounded-full bg-mute/50" />gated</span>
        </div>
      }
    >
      <div className="flex items-stretch gap-0 overflow-x-auto p-3">
        {STAGES.map((s, i) => {
          const state = states[i];
          return (
            <div key={s.key} className="flex min-w-[152px] flex-1 items-stretch">
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "glass-soft relative flex-1 rounded-xl px-3 py-3 transition-all duration-300",
                  state === "active" && "border-cyan/50 shadow-[0_0_22px_rgba(55,214,255,0.25)]",
                  state === "done" && "border-mint/25",
                  i === 6 && state === "pending" && "opacity-75",
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span
                    className={cn("flex size-9 shrink-0 items-center justify-center rounded-lg border", state === "active" && "animate-pulse")}
                    style={{
                      borderColor: `${s.tone}55`,
                      background: `${s.tone}12`,
                      boxShadow: state === "active" ? `0 0 16px ${s.tone}66` : `0 0 10px ${s.tone}22`,
                    }}
                  >
                    <s.icon className="size-4.5" style={{ color: s.tone }} strokeWidth={1.9} />
                  </span>
                  <div className="leading-tight">
                    <div className="font-display text-[12px] font-semibold text-ink">{s.label}</div>
                    <div
                      className="font-mono text-[8.5px] tracking-[0.12em] uppercase"
                      style={{ color: state === "done" ? "#20e3a2" : state === "active" ? (i === 6 ? "#ffb454" : "#37d6ff") : "#7890aa" }}
                    >
                      {state === "done"
                        ? "completed"
                        : state === "active"
                          ? i === 6
                            ? "chờ phê duyệt"
                            : "running"
                          : i === 6
                            ? "approval gate"
                            : "queued"}
                    </div>
                  </div>
                </div>
                <p className="mt-2 line-clamp-2 text-[10.5px] leading-snug text-mute">{s.sub}</p>
                <span className="absolute top-2 right-2 font-mono text-[9px] text-mute/60">{String(i + 1).padStart(2, "0")}</span>
              </motion.div>
              {i < STAGES.length - 1 && (
                <div className="flex items-center px-0.5">
                  <ChevronRight
                    className={cn("size-4", state === "done" ? "text-mint" : "text-azure/60")}
                    strokeWidth={2.5}
                    style={state === "done" ? { filter: "drop-shadow(0 0 4px rgba(32,227,162,0.6))" } : undefined}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
