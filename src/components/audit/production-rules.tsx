"use client";

import { useQuery } from "@tanstack/react-query";
import { BookLock, Container, Database, OctagonX, ShieldCheck, UserCheck } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Panel } from "@/components/ui";

const RULE_ICONS = {
  github: BookLock,
  container: Container,
  database: Database,
  octagon: OctagonX,
  "user-check": UserCheck,
} as const;

const RULE_COLORS: Record<string, string> = {
  cyan: "#37d6ff",
  blue: "#3187ff",
  red: "#ff5f7a",
  green: "#20e3a2",
};

export function ProductionRules() {
  const settings = useQuery({ queryKey: ["settings"], queryFn: api.settings, refetchInterval: 15000 });
  const rules = settings.data?.production_rules ?? [];

  return (
    <Panel
      title="Production Rules"
      icon={ShieldCheck}
      tone="amber"
      right={
        <Link href="/settings" className="font-mono text-[10px] tracking-widest text-cyan/80 uppercase hover:text-cyan">
          sửa →
        </Link>
      }
    >
      <ul className="space-y-2.5">
        {rules.map((r) => {
          const Icon = RULE_ICONS[r.icon as keyof typeof RULE_ICONS] ?? ShieldCheck;
          const color = RULE_COLORS[r.tone] ?? "#37d6ff";
          return (
            <li key={r.key} className="flex items-center gap-3">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-lg border"
                style={{ borderColor: `${color}44`, background: `${color}12`, boxShadow: `0 0 12px ${color}22` }}
              >
                <Icon className="size-4" style={{ color }} strokeWidth={2} />
              </span>
              <span className="flex-1 text-[12.5px] text-ink/90">{r.label}</span>
              <span
                className="font-mono text-[9px] tracking-[0.18em] uppercase"
                style={{ color: r.enabled ? "#37d6ff" : "#7890aa" }}
              >
                {r.enabled ? "configured" : "off"}
              </span>
            </li>
          );
        })}
        {rules.length === 0 && <li className="text-[12px] text-mute">Đang tải rules…</li>}
      </ul>
    </Panel>
  );
}
