"use client";

import { AlertOctagon, RefreshCcw } from "lucide-react";
import { useEffect } from "react";
import { NeonButton } from "@/components/ui";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[ui-error]", error);
  }, [error]);

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl border border-rose/40 bg-rose/10 shadow-[0_0_30px_rgba(255,95,122,0.2)]">
        <AlertOctagon className="size-6 text-rose" />
      </span>
      <div>
        <div className="font-display text-[18px] font-semibold text-ink">Panel gặp sự cố</div>
        <p className="mt-1 max-w-md font-mono text-[11px] leading-relaxed text-mute">
          {error.message || "Unexpected render error"}
          {error.digest && <span className="block mt-1 text-mute/60">digest: {error.digest}</span>}
        </p>
      </div>
      <NeonButton tone="rose" onClick={reset}>
        <RefreshCcw className="size-3.5" /> Thử render lại
      </NeonButton>
    </div>
  );
}
