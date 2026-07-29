import { Compass } from "lucide-react";
import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-4 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl border border-violet/40 bg-violet/10 shadow-[0_0_30px_rgba(139,92,246,0.25)]">
        <Compass className="size-6 text-violet" />
      </span>
      <div className="font-display text-[64px] leading-none font-bold hero-title">404</div>
      <p className="max-w-sm font-mono text-[11px] leading-relaxed text-mute">
        Route không tồn tại trong topology của control plane. Có thể nó đã bị auditor gỡ khỏi service catalog.
      </p>
      <Link
        href="/"
        className="rounded-xl border border-cyan/40 bg-cyan/10 px-4 py-2 font-display text-[12px] font-semibold tracking-[0.08em] text-cyan uppercase transition-colors hover:bg-cyan/20"
      >
        ← Về Overview
      </Link>
    </div>
  );
}
