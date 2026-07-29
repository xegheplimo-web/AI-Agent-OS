"use client";

import { motion } from "framer-motion";
import { Network } from "lucide-react";
import { ArchitectureCanvas } from "@/components/architecture/architecture-canvas";
import { MonorepoPanel } from "@/components/architecture/monorepo-panel";
import { AuditSummary } from "@/components/audit/audit-summary";
import { ProductionRules } from "@/components/audit/production-rules";
import { TelemetryRadar } from "@/components/observability/telemetry-radar";
import { ParityScore } from "@/components/parity/parity-score";
import { LifecyclePipeline } from "@/components/workflow/lifecycle-pipeline";
import { Panel } from "@/components/ui";

export default function OverviewPage() {
  return (
    <div className="space-y-4">
      {/* hero */}
      <div className="relative py-2 text-center">
        <motion.h1
          initial={{ opacity: 0, y: -14, letterSpacing: "0.3em" }}
          animate={{ opacity: 1, y: 0, letterSpacing: "0.08em" }}
          transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
          className="hero-title font-display text-[44px] leading-none font-bold tracking-[0.08em] md:text-[52px]"
        >
          AI AGENT OS
        </motion.h1>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35, duration: 0.6 }}
          className="mt-2.5 flex items-center justify-center gap-3 font-display text-[12.5px] tracking-[0.34em] text-[#bfe0ff]/85 uppercase"
        >
          <span className="hidden h-px w-16 bg-gradient-to-r from-transparent to-cyan/50 sm:block" />
          Audit<span className="text-cyan/70">·</span>Architecture<span className="text-cyan/70">·</span>Recovery
          <span className="text-cyan/70">·</span>Functional Parity
          <span className="hidden h-px w-16 bg-gradient-to-l from-transparent to-cyan/50 sm:block" />
        </motion.div>
      </div>

      {/* main grid */}
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_648px]">
        {/* architecture canvas */}
        <Panel
          title="Runtime Architecture"
          icon={Network}
          tone="azure"
          className="min-w-0"
          pad={false}
          bodyClassName="relative h-[648px] overflow-hidden rounded-b-2xl"
          corner
          right={
            <span className="flex items-center gap-1.5 font-mono text-[9.5px] tracking-widest text-mute uppercase">
              <span className="size-1.5 animate-blink rounded-full bg-mint shadow-[0_0_5px_#20e3a2]" />
              live topology
            </span>
          }
        >
          <ArchitectureCanvas className="h-full w-full" interactive={false} />
          <MonorepoPanel />
          {/* legend */}
          <div className="glass-soft absolute right-3 bottom-3 z-20 flex items-center gap-3 rounded-lg px-3 py-1.5 font-mono text-[9px] tracking-widest text-mute uppercase">
            <span className="flex items-center gap-1.5"><span className="h-px w-5 bg-cyan shadow-[0_0_4px_#37d6ff]" />runtime</span>
            <span className="flex items-center gap-1.5"><span className="h-px w-5 border-t border-dashed border-violet" />read-only audit</span>
          </div>
        </Panel>

        {/* right rail */}
        <div className="grid min-w-0 content-start gap-4 sm:grid-cols-2 xl:grid-cols-2">
          <AuditSummary />
          <ProductionRules />
          <ParityScore />
          <TelemetryRadar compact />
        </div>
      </div>

      {/* lifecycle pipeline */}
      <LifecyclePipeline />
    </div>
  );
}
