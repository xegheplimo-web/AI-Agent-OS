"use client";

import { ListChecks } from "lucide-react";
import { BaselineDiffPanel, ParityChecksTable, ParityGates, ParityHistory } from "@/components/parity/parity-detail";
import { ParityScore } from "@/components/parity/parity-score";
import { Panel } from "@/components/ui";

export default function ParityPage() {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1.5fr_1fr]">
        <ParityScore detailed />
        <div className="grid content-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
          <ParityGates />
          <BaselineDiffPanel />
          <ParityHistory />
        </div>
      </div>
      <Panel title="Baseline ↔ Current — Check Matrix" icon={ListChecks} tone="cyan">
        <ParityChecksTable />
      </Panel>
    </div>
  );
}
