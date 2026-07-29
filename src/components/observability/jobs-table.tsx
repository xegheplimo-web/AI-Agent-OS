"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleCheck, ListTodo, LogIn, Play } from "lucide-react";
import { useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { timeAgo } from "@/lib/utils";
import { Chip, GhostButton, Panel, Progress, StatusDot } from "@/components/ui";

const JOB_ACTIONS = [
  { type: "sbom.export", label: "SBOM export", target: "audit/recon/sbom.cyclonedx.json" },
  { type: "artifact.package", label: "Package bundle", target: "audit/recon/bundle.tar.zst" },
  { type: "knowledge.reindex", label: "Reindex corpus", target: "corpus/full" },
];

export function JobsTable() {
  const qc = useQueryClient();
  const setLoginOpen = useUIStore((s) => s.setLoginOpen);
  const [hint, setHint] = useState<string | null>(null);

  const jobs = useQuery({
    queryKey: ["jobs"],
    queryFn: api.jobs,
    refetchInterval: (q) => (q.state.data?.some((j) => j.status === "running") ? 1500 : 6000),
  });

  const create = useMutation({
    mutationFn: ({ type, target }: { type: string; target: string }) => api.createJob(type, target),
    onSuccess: () => {
      setHint(null);
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["events"] });
    },
    onError: (e: Error) => {
      setHint(e.message);
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) setLoginOpen(true);
    },
  });

  return (
    <Panel
      title="Job Queue"
      icon={ListTodo}
      tone="amber"
      pad={false}
      bodyClassName="p-0"
      right={
        <div className="flex gap-1.5">
          {JOB_ACTIONS.map((a) => (
            <GhostButton key={a.type} onClick={() => create.mutate(a)} disabled={create.isPending}>
              <Play className="size-3" /> {a.label}
            </GhostButton>
          ))}
        </div>
      }
    >
      {hint && (
        <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg border border-amber/40 bg-amber/10 px-2.5 py-1.5 font-mono text-[10px] text-amber">
          <LogIn className="size-3.5 shrink-0" /> {hint}
        </div>
      )}
      <div className="overflow-x-auto p-3">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="border-b border-line/50 font-mono text-[9px] tracking-[0.18em] text-mute uppercase">
              <th className="py-1.5 pr-3 font-medium">Job</th>
              <th className="py-1.5 pr-3 font-medium">Target</th>
              <th className="py-1.5 pr-3 font-medium">Worker</th>
              <th className="py-1.5 pr-3 font-medium">Progress</th>
              <th className="py-1.5 pr-3 font-medium">Status</th>
              <th className="py-1.5 font-medium">Age</th>
            </tr>
          </thead>
          <tbody>
            {jobs.data?.map((j) => (
              <tr key={j.id} className="border-b border-ink/5 transition-colors hover:bg-cyan/4">
                <td className="py-2 pr-3"><Chip tone="azure">{j.type}</Chip></td>
                <td className="max-w-[180px] truncate py-2 pr-3 font-mono text-[10.5px] text-mute">{j.target}</td>
                <td className="py-2 pr-3 font-mono text-[10.5px] text-cyan/80">{j.worker ?? "—"}</td>
                <td className="w-[130px] py-2 pr-3">
                  {j.status === "running" ? (
                    <div className="flex items-center gap-2">
                      <Progress value={j.progress} className="w-20" />
                      <span className="font-mono text-[9.5px] text-cyan">{j.progress}%</span>
                    </div>
                  ) : j.status === "completed" ? (
                    <span className="flex items-center gap-1 font-mono text-[9.5px] text-mint"><CircleCheck className="size-3" />100%</span>
                  ) : (
                    <span className="font-mono text-[9.5px] text-mute">0%</span>
                  )}
                </td>
                <td className="py-2 pr-3">
                  <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-wider uppercase">
                    <StatusDot status={j.status} pulse={j.status === "running"} />
                    <span className={j.status === "completed" ? "text-mint" : j.status === "running" ? "text-cyan" : "text-mute"}>{j.status}</span>
                  </span>
                </td>
                <td className="py-2 font-mono text-[10px] text-mute">{timeAgo(j.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
