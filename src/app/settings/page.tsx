"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BookLock, Container, Database, Info, MonitorCog, OctagonX, ScrollText, ShieldCheck, SlidersHorizontal, UserCheck } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import type { SettingsDTO } from "@/lib/types";
import { cn, timeAgo } from "@/lib/utils";
import { Chip, GhostButton, KV, Panel, Toggle } from "@/components/ui";

function AuditTrailPanel() {
  const logs = useQuery({ queryKey: ["audit-logs"], queryFn: () => api.auditLogs(16), refetchInterval: 6000 });
  return (
    <Panel title="Immutable Audit Trail" icon={ScrollText} tone="rose" pad={false} bodyClassName="max-h-[420px] overflow-y-auto p-3">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-line/50 font-mono text-[9px] tracking-[0.18em] text-mute uppercase">
            <th className="py-1.5 pr-2 font-medium">Actor</th>
            <th className="py-1.5 pr-2 font-medium">Action</th>
            <th className="py-1.5 pr-2 font-medium">Resource</th>
            <th className="py-1.5 pr-2 font-medium">Result</th>
            <th className="py-1.5 font-medium">Time</th>
          </tr>
        </thead>
        <tbody>
          {logs.data?.map((l) => (
            <tr key={l.id} className="border-b border-ink/5">
              <td className="py-2 pr-2">
                <span className="font-mono text-[10px] text-cyan/85">{l.actorId}</span>
                <span className="block font-mono text-[8.5px] text-mute/60">{l.actorType}</span>
              </td>
              <td className="py-2 pr-2 font-mono text-[10px] text-ink/90">{l.action}</td>
              <td className="py-2 pr-2 font-mono text-[9.5px] text-mute">
                {l.resourceType}
                {l.resourceId ? `#${String(l.resourceId).slice(0, 8)}` : ""}
              </td>
              <td className="py-2 pr-2">
                <span className={cn("font-mono text-[9px] tracking-wider uppercase", l.result === "success" ? "text-mint" : l.result === "denied" ? "text-amber" : "text-rose")}>
                  {l.result}
                </span>
              </td>
              <td className="py-2 font-mono text-[9.5px] text-mute">{timeAgo(l.createdAt)}</td>
            </tr>
          ))}
          {logs.data?.length === 0 && (
            <tr>
              <td colSpan={5} className="py-6 text-center font-mono text-[10px] text-mute">
                Chưa có bản ghi nào.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </Panel>
  );
}

const RULE_ICONS: Record<string, typeof BookLock> = {
  github: BookLock,
  container: Container,
  database: Database,
  octagon: OctagonX,
  "user-check": UserCheck,
};

const RULE_COLORS: Record<string, string> = {
  cyan: "#37d6ff",
  blue: "#3187ff",
  red: "#ff5f7a",
  green: "#20e3a2",
};

const API_ENDPOINTS = [
  "GET /api/system/health",
  "GET /api/system/components",
  "GET /api/architecture/graph",
  "GET /api/audits",
  "POST /api/audits/run",
  "GET /api/audits/{id}",
  "GET /api/parity/latest",
  "GET /api/findings · PATCH",
  "GET /api/telemetry/summary",
  "GET /api/jobs · POST",
  "GET /api/events",
  "GET /api/artifacts[/id]",
  "GET /api/settings · PUT",
];

type Section = "production_rules" | "workspace" | "notifications";

export default function SettingsPage() {
  const qc = useQueryClient();
  const setRefreshInterval = useUIStore((s) => s.setRefreshInterval);
  const setLoginOpen = useUIStore((s) => s.setLoginOpen);
  const [saved, setSaved] = useState<Section | null>(null);
  const [denied, setDenied] = useState<string | null>(null);

  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings, refetchInterval: 15000 });
  const components = useQuery({ queryKey: ["components"], queryFn: api.components, staleTime: 60000 });

  const put = useMutation({
    mutationFn: ({ section, value }: { section: Section; value: unknown }) => api.putSettings(section, value),
    onSuccess: (_d, v) => {
      setDenied(null);
      qc.invalidateQueries({ queryKey: ["settings"] });
      setSaved(v.section);
      setTimeout(() => setSaved(null), 1800);
    },
    onError: (e) => {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        setDenied(e.message);
        setLoginOpen(true);
      } else {
        setDenied(e.message);
      }
    },
  });

  const data = settings.data;

  useEffect(() => {
    if (data?.workspace.refreshIntervalMs) setRefreshInterval(data.workspace.refreshIntervalMs);
  }, [data?.workspace.refreshIntervalMs, setRefreshInterval]);

  function toggleRule(key: string) {
    if (!data) return;
    const value = data.production_rules.map((r) => (r.key === key ? { ...r, enabled: !r.enabled } : r));
    qc.setQueryData<SettingsDTO>(["settings"], { ...data, production_rules: value });
    put.mutate({ section: "production_rules", value });
  }

  function updateWorkspace(patch: Partial<SettingsDTO["workspace"]>) {
    if (!data) return;
    const value = { ...data.workspace, ...patch };
    qc.setQueryData<SettingsDTO>(["settings"], { ...data, workspace: value });
    put.mutate({ section: "workspace", value });
  }

  function updateNotifications(patch: Partial<SettingsDTO["notifications"]>) {
    if (!data) return;
    const value = { ...data.notifications, ...patch };
    qc.setQueryData<SettingsDTO>(["settings"], { ...data, notifications: value });
    put.mutate({ section: "notifications", value });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {denied && (
        <div className="lg:col-span-2 flex items-center gap-2 rounded-xl border border-amber/40 bg-amber/10 px-4 py-2.5 text-[12px] text-amber">
          {denied}
        </div>
      )}
      {/* production rules */}
      <Panel
        title="Production Rules"
        icon={ShieldCheck}
        tone="amber"
        right={saved === "production_rules" && <Chip tone="mint">saved ✓</Chip>}
      >
        <p className="mb-3 font-mono text-[10px] leading-relaxed text-mute">
          Ràng buộc bất biến mà auditor và dashboard phải tuân thủ. Tắt rule chỉ nên được thực hiện trong staging.
        </p>
        <ul className="space-y-2.5">
          {data?.production_rules.map((r) => {
            const Icon = RULE_ICONS[r.icon] ?? ShieldCheck;
            const color = RULE_COLORS[r.tone] ?? "#37d6ff";
            return (
              <li key={r.key} className="glass-soft flex items-center gap-3 rounded-xl px-3 py-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border" style={{ borderColor: `${color}44`, background: `${color}12` }}>
                  <Icon className="size-4" style={{ color: r.enabled ? color : "#7890aa" }} strokeWidth={2} />
                </span>
                <div className="flex-1 leading-tight">
                  <div className="text-[12.5px] text-ink/90">{r.label}</div>
                  <div className="font-mono text-[9px] tracking-wider text-mute uppercase">{r.key}</div>
                </div>
                <Toggle checked={r.enabled} onChange={() => toggleRule(r.key)} tone={r.tone === "red" ? "rose" : "mint"} />
              </li>
            );
          })}
        </ul>
      </Panel>

      {/* workspace prefs */}
      <Panel
        title="Workspace Preferences"
        icon={SlidersHorizontal}
        tone="cyan"
        right={saved === "workspace" && <Chip tone="mint">saved ✓</Chip>}
      >
        <div className="space-y-4">
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-widest text-mute uppercase">Refresh interval</div>
            <div className="flex flex-wrap gap-1.5">
              {[2000, 4000, 8000, 15000].map((ms) => (
                <GhostButton
                  key={ms}
                  active={data?.workspace.refreshIntervalMs === ms}
                  onClick={() => updateWorkspace({ refreshIntervalMs: ms })}
                >
                  {ms / 1000}s
                </GhostButton>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-2 font-mono text-[10px] tracking-widest text-mute uppercase">Clock format</div>
            <div className="flex gap-1.5">
              <GhostButton active={data?.workspace.clockFormat === "utc"} onClick={() => updateWorkspace({ clockFormat: "utc" })}>UTC</GhostButton>
              <GhostButton active={data?.workspace.clockFormat === "local"} onClick={() => updateWorkspace({ clockFormat: "local" })}>Local</GhostButton>
            </div>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-ink/8 px-3 py-2.5">
            <div>
              <div className="text-[12.5px] text-ink/90">Animations & glow effects</div>
              <div className="font-mono text-[9px] text-mute">HUD motion, radar sweep, node pulses</div>
            </div>
            <Toggle checked={data?.workspace.animationsEnabled ?? true} onChange={(v) => updateWorkspace({ animationsEnabled: v })} />
          </div>
          <div className="flex items-center justify-between rounded-xl border border-ink/8 px-3 py-2.5">
            <div>
              <div className="text-[12.5px] text-ink/90">Compact sidebar</div>
              <div className="font-mono text-[9px] text-mute">Thu nhỏ navigation ở màn hình nhỏ</div>
            </div>
            <Toggle checked={data?.workspace.sidebarCompact ?? false} onChange={(v) => updateWorkspace({ sidebarCompact: v })} />
          </div>
        </div>
      </Panel>

      {/* audit trail */}
      <AuditTrailPanel />

      {/* notifications */}
      <Panel
        title="Notifications"
        icon={Bell}
        tone="violet"
        right={saved === "notifications" && <Chip tone="mint">saved ✓</Chip>}
      >
        <div className="space-y-2.5">
          {(
            [
              { key: "auditCompleted", label: "Audit hoàn tất", desc: "Score, findings và parity mới" },
              { key: "findingCritical", label: "Critical finding", desc: "Cảnh báo ngay khi phát hiện severity critical" },
              { key: "parityWarning", label: "Parity warning", desc: "Khi parity score giảm hoặc check cảnh báo" },
            ] as const
          ).map((n) => (
            <div key={n.key} className="flex items-center justify-between rounded-xl border border-ink/8 px-3 py-2.5">
              <div>
                <div className="text-[12.5px] text-ink/90">{n.label}</div>
                <div className="font-mono text-[9px] text-mute">{n.desc}</div>
              </div>
              <Toggle checked={data?.notifications[n.key] ?? true} onChange={(v) => updateNotifications({ [n.key]: v })} />
            </div>
          ))}
        </div>
      </Panel>

      {/* system info */}
      <Panel title="System & API Surface" icon={Info} tone="azure">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 font-mono text-[10px] tracking-widest text-mute uppercase">
              <MonitorCog className="size-3" /> component versions
            </div>
            <div className="glass-soft max-h-52 overflow-y-auto rounded-xl px-3 py-2">
              {components.data?.map((c) => (
                <KV key={c.id} k={c.id} v={`v${c.version}`} />
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 font-mono text-[10px] tracking-widest text-mute uppercase">api endpoints</div>
            <div className="glass-soft max-h-52 space-y-1 overflow-y-auto rounded-xl px-3 py-2">
              {API_ENDPOINTS.map((e) => (
                <div key={e} className={cn("font-mono text-[9.5px]", e.startsWith("POST") || e.includes("PUT") || e.includes("PATCH") ? "text-violet/90" : "text-cyan/75")}>
                  {e}
                </div>
              ))}
            </div>
          </div>
        </div>
      </Panel>
    </div>
  );
}
