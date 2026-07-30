"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { Hourglass, LogIn, Play, Radar, ShieldAlert } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import { isDemoModeClient } from "@/lib/mode-client";
import { cn, formatDuration, timeAgo } from "@/lib/utils";
import { Chip, NeonButton, Panel, StatusDot } from "@/components/ui";

const STAGE_TONES = ["#37d6ff", "#8b5cf6", "#20e3a2"];

function Elapsed({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const update = () => setElapsed(Date.now() - new Date(startedAt).getTime());
    update();
    const t = setInterval(update, 200);
    return () => clearInterval(t);
  }, [startedAt]);
  return <span className="font-mono text-[12px] text-cyan tabular-nums">{(elapsed / 1000).toFixed(1)}s</span>;
}

export function AuditConsole() {
  const qc = useQueryClient();
  const environment = useUIStore((s) => s.environment);
  const setLoginOpen = useUIStore((s) => s.setLoginOpen);

  const audits = useQuery({
    queryKey: ["audits", environment],
    queryFn: () => api.audits(`environment=${environment}`),
    refetchInterval: (q) => (q.state.data?.some((a) => a.status === "running") ? 1000 : 6000),
  });
  const me = useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 30000 });

  const [hint, setHint] = useState<{ tone: "amber" | "cyan" | "mint"; text: string } | null>(null);

  const run = useMutation({
    mutationFn: () =>
      api.runAudit({
        environment: environment as "local" | "development" | "staging" | "production",
        scope: [],
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (res) => {
      if (res.approvalRequired) {
        setHint({
          tone: "amber",
          text: "Audit production đang chờ administrator phê duyệt — xem panel Approvals bên dưới.",
        });
      } else {
        setHint({ tone: "mint", text: res.replayed ? "Idempotency replay: audit đã tồn tại." : `Đã khởi chạy ${res.audit.name} trên ${environment}.` });
      }
      qc.invalidateQueries({ queryKey: ["audits"] });
      qc.invalidateQueries({ queryKey: ["jobs"] });
      qc.invalidateQueries({ queryKey: ["events"] });
      qc.invalidateQueries({ queryKey: ["approvals"] });
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setHint({ tone: "amber", text: e.message });
        setLoginOpen(true);
      } else {
        setHint({ tone: "amber", text: e.message });
      }
    },
  });

  const running = audits.data?.find((a) => a.status === "running");
  const history = audits.data ?? [];
  const isLoggedIn = !!me.data?.user;

  const doneStages = running?.stages.filter((s) => s.status === "done").length ?? 0;
  const activeStage = running?.stages.findIndex((s) => s.status === "active") ?? -1;
  const overallPct = running ? ((doneStages + (activeStage >= 0 ? 0.5 : 0)) / 3) * 100 : 0;

  return (
    <Panel
      title="Audit Pipeline Control"
      icon={Radar}
      tone="violet"
      right={
        <div className="flex items-center gap-2.5">
          <span
            className="rounded-md border px-1.5 py-0.5 font-mono text-[9px] tracking-[0.14em] uppercase"
            title={
              isDemoModeClient()
                ? "APP_MODE=demo — pipeline chạy timeline mô phỏng trong API request"
                : "APP_MODE=production — worker chạy scanner thật (filesystem/SBOM/secrets/DB/routes)"
            }
            style={
              isDemoModeClient()
                ? { borderColor: "rgba(120,144,170,0.4)", background: "rgba(120,144,170,0.1)", color: "#7890aa" }
                : { borderColor: "rgba(32,227,162,0.4)", background: "rgba(32,227,162,0.1)", color: "#20e3a2" }
            }
          >
            engine: {isDemoModeClient() ? "demo timeline" : "real scanners"}
          </span>
          <NeonButton tone="violet" onClick={() => run.mutate()} disabled={run.isPending || !!running}>
            {isLoggedIn ? <Play className="size-3.5" /> : <LogIn className="size-3.5" />}
            {run.isPending ? "Đang khởi tạo…" : running ? "Audit đang chạy" : `Run Audit · ${environment}`}
          </NeonButton>
        </div>
      }
    >
      <AnimatePresence>
        {hint && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className={cn(
              "mb-3 flex items-center gap-2 overflow-hidden rounded-lg border px-3 py-2 text-[12px]",
              hint.tone === "amber" && "border-amber/40 bg-amber/10 text-amber",
              hint.tone === "cyan" && "border-cyan/40 bg-cyan/10 text-cyan",
              hint.tone === "mint" && "border-mint/40 bg-mint/10 text-mint",
            )}
          >
            <ShieldAlert className="size-4 shrink-0" /> {hint.text}
          </motion.div>
        )}
      </AnimatePresence>

      {/* live progress */}
      <AnimatePresence>
        {running && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-4 overflow-hidden"
          >
            <div className="glass-soft rounded-xl p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <StatusDot status="running" pulse />
                  <span className="font-display text-[13px] font-semibold text-ink">{running.name}</span>
                  <Chip tone="violet">3-stage pipeline</Chip>
                  <Chip tone="azure">{running.environment}</Chip>
                </div>
                <Elapsed startedAt={running.startedAt} />
              </div>

              <div className="mt-4 flex items-center gap-0">
                {running.stages.map((s, i) => {
                  const tone = STAGE_TONES[i];
                  const active = s.status === "active";
                  const done = s.status === "done";
                  return (
                    <div key={s.key} className="flex flex-1 items-center last:flex-none">
                      <div className="flex flex-col items-center gap-1.5">
                        <span
                          className={cn("flex size-8 items-center justify-center rounded-full border font-display text-[13px] font-bold", active && "animate-pulse")}
                          style={{
                            color: done ? "#020713" : tone,
                            background: done ? tone : `${tone}14`,
                            borderColor: `${tone}90`,
                            boxShadow: `0 0 ${active ? 18 : 8}px ${tone}${active ? "aa" : "44"}`,
                          }}
                        >
                          {done ? "✓" : i + 1}
                        </span>
                        <span className="font-mono text-[9px] tracking-[0.14em] whitespace-nowrap uppercase" style={{ color: active || done ? tone : "#7890aa" }}>
                          {s.label}
                        </span>
                      </div>
                      {i < 2 && (
                        <div className="mx-2 mb-5 h-1 flex-1 overflow-hidden rounded-full bg-ink/8">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ background: `linear-gradient(90deg, ${STAGE_TONES[i]}, ${STAGE_TONES[i + 1]})` }}
                            initial={{ width: "0%" }}
                            animate={{ width: done ? "100%" : active ? "50%" : "0%" }}
                            transition={{ duration: 0.5 }}
                          />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-3 rounded-lg border border-ink/8 bg-void/40 px-3 py-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] tracking-widest text-mute uppercase">
                    {activeStage >= 0 ? running.stages[activeStage].label : "Finalizing"} · artifacts đang sinh
                  </span>
                  <span className="font-mono text-[10px] text-cyan">{Math.round(overallPct)}%</span>
                </div>
                {activeStage >= 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {running.stages[activeStage].artifacts.map((a) => (
                      <motion.span
                        key={a}
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        className="rounded border border-cyan/25 bg-cyan/8 px-1.5 py-0.5 font-mono text-[9px] text-cyan"
                      >
                        {a}
                      </motion.span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* history */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[780px] text-left">
          <thead>
            <tr className="border-b border-line/50 font-mono text-[9.5px] tracking-[0.18em] text-mute uppercase">
              <th className="py-2 pr-3 font-medium">Audit</th>
              <th className="py-2 pr-3 font-medium">Env</th>
              <th className="py-2 pr-3 font-medium">Actor</th>
              <th className="py-2 pr-3 font-medium">Started</th>
              <th className="py-2 pr-3 font-medium">Duration</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 pr-3 font-medium">Score</th>
              <th className="py-2 font-medium">Findings</th>
            </tr>
          </thead>
          <tbody>
            {history.map((a) => (
              <tr key={a.id} className="border-b border-ink/5 transition-colors hover:bg-cyan/4">
                <td className="py-2.5 pr-3">
                  <span className="font-mono text-[12px] font-medium text-ink">{a.name}</span>
                </td>
                <td className="py-2.5 pr-3"><Chip tone="azure">{a.environment}</Chip></td>
                <td className="py-2.5 pr-3 font-mono text-[10.5px] text-mute">{a.requestedBy}</td>
                <td className="py-2.5 pr-3 font-mono text-[11px] text-mute">{timeAgo(a.startedAt)}</td>
                <td className="py-2.5 pr-3 font-mono text-[11px] text-mute">
                  {a.status === "running" ? <Elapsed startedAt={a.startedAt} /> : a.durationMs ? formatDuration(a.durationMs) : "—"}
                </td>
                <td className="py-2.5 pr-3">
                  <span className="flex items-center gap-1.5 font-mono text-[10px] tracking-wider uppercase">
                    {a.status === "waiting_approval" ? (
                      <Hourglass className="size-3.5 text-amber" />
                    ) : (
                      <StatusDot status={a.status} pulse={a.status === "running"} />
                    )}
                    <span
                      className={
                        a.status === "completed"
                          ? "text-mint"
                          : a.status === "running"
                            ? "text-cyan"
                            : a.status === "waiting_approval"
                              ? "text-amber"
                              : "text-mute"
                      }
                    >
                      {a.status.replace("_", " ")}
                    </span>
                  </span>
                </td>
                <td className="py-2.5 pr-3">
                  {a.score != null ? (
                    <span
                      className="font-display text-[14px] font-bold"
                      style={{ color: a.score >= 95 ? "#20e3a2" : a.score >= 85 ? "#ffb454" : "#ff5f7a" }}
                    >
                      {a.score}
                    </span>
                  ) : (
                    <span className="font-mono text-[11px] text-mute">—</span>
                  )}
                </td>
                <td className="py-2.5">
                  {a.findingsCount ? (
                    <div className="flex gap-1">
                      {a.findingsCount.critical > 0 && <Chip tone="rose">{a.findingsCount.critical} crit</Chip>}
                      {a.findingsCount.high > 0 && <Chip tone="amber">{a.findingsCount.high} high</Chip>}
                      {a.findingsCount.medium > 0 && <Chip tone="amber">{a.findingsCount.medium} med</Chip>}
                      {a.findingsCount.low > 0 && <Chip tone="cyan">{a.findingsCount.low} low</Chip>}
                      {a.findingsCount.info > 0 && <Chip tone="azure">{a.findingsCount.info} info</Chip>}
                    </div>
                  ) : (
                    <span className="font-mono text-[11px] text-mute">…</span>
                  )}
                </td>
              </tr>
            ))}
            {history.length === 0 && (
              <tr>
                <td colSpan={8} className="py-8 text-center font-mono text-[11px] text-mute">
                  Chưa có audit nào trên {environment} — bấm Run Audit để bắt đầu.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
