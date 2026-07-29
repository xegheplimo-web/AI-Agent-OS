"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, ArrowRight, CheckCircle2, GitCompareArrows, GitPullRequestArrow, History, ShieldCheck, XCircle } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { cn, timeAgo } from "@/lib/utils";
import { Chip, GhostButton, Panel } from "@/components/ui";

export function BaselineDiffPanel() {
  const parity = useQuery({ queryKey: ["parity"], queryFn: api.parityLatest, refetchInterval: 8000 });
  const diff = parity.data?.baselineDiff ?? [];

  return (
    <Panel title="Baseline Δ vs báo cáo trước" icon={GitCompareArrows} tone="violet">
      {diff.length === 0 ? (
        <div className="rounded-lg border border-dashed border-mint/25 bg-mint/5 px-3 py-4 text-center font-mono text-[10.5px] text-mint/80">
          Không có drift — mọi check giữ nguyên trạng thái so với báo cáo trước ✓
        </div>
      ) : (
        <div className="space-y-1.5">
          {diff.map((d) => (
            <div key={d.key} className="glass-soft flex items-center gap-2 rounded-lg px-2.5 py-2 text-[11.5px]">
              <span className="min-w-0 flex-1 truncate text-ink/90">{d.label}</span>
              <Chip tone={d.before === "passed" ? "mint" : d.before === "absent" ? "azure" : "amber"}>{d.before}</Chip>
              <ArrowRight className="size-3.5 text-mute" />
              <Chip tone={d.after === "passed" ? "mint" : d.after === "failed" ? "rose" : "amber"}>{d.after}</Chip>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export function ParityGates() {
  const qc = useQueryClient();
  const setLoginOpen = useUIStore((s) => s.setLoginOpen);
  const parity = useQuery({ queryKey: ["parity"], queryFn: api.parityLatest, refetchInterval: 8000 });
  const [hint, setHint] = useState<string | null>(null);

  const gate = useMutation({
    mutationFn: () => api.createJob("parity.gate", "ci/parity-gate"),
    onSuccess: () => {
      setHint("Parity gate đã được xếp hàng — worker đang chạy.");
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => {
      setHint(e.message);
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setLoginOpen(true);
    },
  });

  const gates = parity.data?.gates ?? [];

  return (
    <Panel
      title="CI Gates"
      icon={GitPullRequestArrow}
      tone="azure"
      right={
        <GhostButton onClick={() => gate.mutate()} disabled={gate.isPending}>
          <ShieldCheck className="size-3.5" /> {gate.isPending ? "Đang xếp hàng…" : "Run gate"}
        </GhostButton>
      }
    >
      {hint && <div className="mb-2.5 rounded-lg border border-cyan/25 bg-cyan/8 px-2.5 py-1.5 font-mono text-[10px] text-cyan">{hint}</div>}
      <div className="grid grid-cols-2 gap-2">
        {gates.map((g) => (
          <div
            key={g.key}
            className={cn(
              "glass-soft flex items-center gap-2 rounded-lg px-2.5 py-2",
              g.status === "warning" && "border-amber/40",
            )}
          >
            {g.status === "passed" ? (
              <CheckCircle2 className="size-4 shrink-0 text-mint" />
            ) : g.status === "warning" ? (
              <AlertTriangle className="size-4 shrink-0 text-amber" />
            ) : (
              <XCircle className="size-4 shrink-0 text-rose" />
            )}
            <span className="truncate text-[11.5px] text-ink/90">{g.label}</span>
            <span className={cn("ml-auto font-mono text-[9px] tracking-wider uppercase", g.status === "passed" ? "text-mint" : g.status === "warning" ? "text-amber" : "text-rose")}>
              {g.status}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-3 font-mono text-[9.5px] leading-relaxed text-mute">
        Gate đo <span className="text-cyan/80">hành vi</span>: endpoints, inventory, env contract, port map, schema state — không phải diff source.
      </p>
    </Panel>
  );
}

export function ParityHistory() {
  const parity = useQuery({ queryKey: ["parity"], queryFn: api.parityLatest, refetchInterval: 8000 });
  const history = parity.data?.history ?? [];

  return (
    <Panel title="Score History" icon={History} tone="violet">
      <div className="flex h-28 items-end gap-2">
        {history.slice().reverse().map((h, i) => {
          const color = h.score >= 95 ? "#20e3a2" : h.score >= 85 ? "#ffb454" : "#ff5f7a";
          return (
            <div key={h.id} className="group flex flex-1 flex-col items-center justify-end gap-1">
              <span className="font-mono text-[9px] opacity-0 transition-opacity group-hover:opacity-100" style={{ color }}>
                {h.score}
              </span>
              <div
                className="w-full rounded-t-md transition-all duration-500 group-hover:brightness-125"
                style={{
                  height: `${(h.score / 100) * 84}%`,
                  minHeight: 8,
                  background: `linear-gradient(180deg, ${color}, ${color}33)`,
                  boxShadow: `0 0 12px ${color}44`,
                  transitionDelay: `${i * 40}ms`,
                }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[9px] text-mute">
        {history.length > 0 && <span>{timeAgo(history[history.length - 1].createdAt)}</span>}
        {history.length > 1 && <span>{timeAgo(history[0].createdAt)}</span>}
      </div>
      <div className="mt-3 space-y-1.5">
        {parity.data?.history.slice(0, 3).map((h) => (
          <div key={h.id} className="flex items-center gap-2 text-[11px]">
            <Chip tone={h.overallStatus === "passed" ? "mint" : h.overallStatus === "warning" ? "amber" : "rose"}>
              {h.overallStatus}
            </Chip>
            <span className="font-mono text-mute">{timeAgo(h.createdAt)}</span>
            <span className="ml-auto font-display font-bold" style={{ color: h.score >= 95 ? "#20e3a2" : h.score >= 85 ? "#ffb454" : "#ff5f7a" }}>
              {h.score}
            </span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ParityChecksTable() {
  const parity = useQuery({ queryKey: ["parity"], queryFn: api.parityLatest, refetchInterval: 8000 });
  const checks = parity.data?.checks ?? [];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left">
        <thead>
          <tr className="border-b border-line/50 font-mono text-[9.5px] tracking-[0.18em] text-mute uppercase">
            <th className="py-2 pr-3 font-medium">Check</th>
            <th className="py-2 pr-3 font-medium">Baseline</th>
            <th className="py-2 pr-3 font-medium">Current</th>
            <th className="py-2 pr-3 font-medium">Δ Diff</th>
            <th className="py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {checks.map((c) => (
            <tr key={c.key} className="border-b border-ink/5 transition-colors hover:bg-cyan/4">
              <td className="py-2.5 pr-3 text-[12.5px] text-ink/90">{c.label}</td>
              <td className="py-2.5 pr-3 font-mono text-[11px] text-mute">{c.baselineValue}</td>
              <td className="py-2.5 pr-3 font-mono text-[11px] text-ink">{c.currentValue}</td>
              <td className="py-2.5 pr-3 font-mono text-[10.5px] text-amber">{c.difference ?? "—"}</td>
              <td className="py-2.5">
                {c.status === "passed" ? (
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-mint uppercase"><CheckCircle2 className="size-3.5" />passed</span>
                ) : c.status === "warning" ? (
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-amber uppercase"><AlertTriangle className="size-3.5" />warning</span>
                ) : (
                  <span className="flex items-center gap-1.5 font-mono text-[10px] text-rose uppercase"><XCircle className="size-3.5" />failed</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
