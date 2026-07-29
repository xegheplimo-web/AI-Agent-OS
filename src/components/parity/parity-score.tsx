"use client";

import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, CircleDashed, RefreshCw, Target, XCircle } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { Panel, RadialGauge } from "@/components/ui";

export function ParityScore({ detailed = false }: { detailed?: boolean }) {
  const parity = useQuery({ queryKey: ["parity"], queryFn: api.parityLatest, refetchInterval: 8000 });
  const p = parity.data;

  const tone = !p ? "#37d6ff" : p.overallStatus === "passed" ? "#20e3a2" : p.overallStatus === "warning" ? "#ffb454" : "#ff5f7a";
  const passed = p?.checks.filter((c) => c.status === "passed").length ?? 0;

  return (
    <Panel
      title={p ? `${p.score}% Functional Parity` : "Functional Parity"}
      icon={Target}
      tone={p?.overallStatus === "passed" ? "mint" : "amber"}
      right={
        <Link href="/parity" className="font-mono text-[10px] tracking-widest text-cyan/80 uppercase hover:text-cyan">
          parity center →
        </Link>
      }
    >
      {p ? (
        <div className={detailed ? "grid grid-cols-[auto_1fr] items-center gap-5" : "flex flex-col gap-4"}>
          <div className={detailed ? "" : "mx-auto"}>
            <RadialGauge
              value={p.score}
              tone={tone}
              size={detailed ? 168 : 138}
              sublabel={`${passed}/${p.checks.length} checks`}
            />
          </div>

          <ul className="min-w-0 flex-1 space-y-1.5">
            {p.checks.map((c) => (
              <li key={c.key} className="flex items-center gap-2.5 text-[12px]">
                {c.status === "passed" ? (
                  <CheckCircle2 className="size-4 shrink-0 text-mint" strokeWidth={2.2} />
                ) : c.status === "warning" ? (
                  <AlertTriangle className="size-4 shrink-0 text-amber" strokeWidth={2.2} />
                ) : c.status === "failed" ? (
                  <XCircle className="size-4 shrink-0 text-rose" strokeWidth={2.2} />
                ) : (
                  <CircleDashed className="size-4 shrink-0 text-mute" strokeWidth={2.2} />
                )}
                <span className={c.status === "passed" ? "text-ink/85" : "text-amber"}>{c.label}</span>
                {c.difference && (
                  <span className="ml-auto rounded border border-amber/30 bg-amber/10 px-1.5 py-0.5 font-mono text-[9px] text-amber">
                    {c.difference}
                  </span>
                )}
                {detailed && !c.difference && (
                  <span className="ml-auto font-mono text-[9.5px] text-mute">{c.currentValue}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="flex h-48 items-center justify-center text-mute">
          <RefreshCw className="size-4 animate-spin" />
        </div>
      )}
    </Panel>
  );
}
