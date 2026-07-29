"use client";

import { useQuery } from "@tanstack/react-query";
import { Layers } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { cn, formatDuration } from "@/lib/utils";
import { Panel, StatusDot } from "@/components/ui";

const STAGE_META = [
  { num: "1", tone: "#37d6ff" },
  { num: "2", tone: "#8b5cf6" },
  { num: "3", tone: "#20e3a2" },
];

export function AuditSummary() {
  const audits = useQuery({
    queryKey: ["audits"],
    queryFn: () => api.audits(),
    refetchInterval: (q) =>
      q.state.data?.some((a) => a.status === "running") ? 1200 : 6000,
  });

  const latest = audits.data?.[0];
  const stages = latest?.stages ?? [];

  return (
    <Panel
      title="3 Tầng Audit"
      icon={Layers}
      tone="cyan"
      right={
        <Link href="/audit" className="font-mono text-[10px] tracking-widest text-cyan/80 uppercase hover:text-cyan">
          mở center →
        </Link>
      }
    >
      <div className="relative space-y-3">
        {/* connector line */}
        <span className="absolute top-7 bottom-7 left-[15px] w-px bg-gradient-to-b from-cyan/50 via-violet/50 to-mint/50" />
        {stages.map((s, i) => {
          const meta = STAGE_META[i];
          const active = s.status === "active";
          return (
            <div key={s.key} className="relative flex gap-3 pl-0.5">
              <div
                className={cn(
                  "z-10 flex size-8 shrink-0 items-center justify-center rounded-full border font-display text-[13px] font-bold",
                  active && "animate-pulse",
                )}
                style={{
                  color: meta.tone,
                  borderColor: `${meta.tone}88`,
                  background: `${meta.tone}14`,
                  boxShadow: active ? `0 0 16px ${meta.tone}88` : `0 0 10px ${meta.tone}33`,
                }}
              >
                {meta.num}
              </div>
              <div className="glass-soft min-w-0 flex-1 rounded-lg px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-display text-[11px] font-semibold tracking-[0.18em] text-ink uppercase">
                    {s.label}
                  </span>
                  <span className="flex items-center gap-1.5 font-mono text-[9px] tracking-widest uppercase">
                    <StatusDot status={s.status === "active" ? "running" : s.status === "done" ? "done" : "pending"} pulse={active} />
                    <span className={cn(s.status === "done" ? "text-mint" : active ? "text-cyan" : "text-mute")}>
                      {s.status === "done" ? formatDuration(s.durationMs ?? 0) : s.status}
                    </span>
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 font-mono text-[9.5px] leading-relaxed text-mute">{s.detail}</p>
                {s.artifacts.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {s.artifacts.slice(0, 3).map((a) => (
                      <span key={a} className="rounded border border-ink/10 bg-ink/5 px-1.5 py-0.5 font-mono text-[8.5px] text-cyan/70">
                        {a.split("/").pop()}
                      </span>
                    ))}
                    {s.artifacts.length > 3 && (
                      <span className="rounded border border-ink/10 bg-ink/5 px-1.5 py-0.5 font-mono text-[8.5px] text-mute">
                        +{s.artifacts.length - 3}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
