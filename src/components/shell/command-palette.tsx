"use client";

import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import {
  Boxes,
  CornerDownLeft,
  FileText,
  Home,
  LayoutDashboard,
  ListChecks,
  Radar,
  ScanSearch,
  Search,
  BookOpenText,
  Settings,
  TriangleAlert,
  Play,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useUIStore } from "@/lib/store";
import type { SearchResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const GROUP_ICONS: Record<SearchResult["group"], typeof Boxes> = {
  component: Boxes,
  audit: ScanSearch,
  finding: TriangleAlert,
  artifact: FileText,
  job: Radar,
};

const GROUP_LABELS: Record<SearchResult["group"], string> = {
  component: "Components",
  audit: "Audits",
  finding: "Findings",
  artifact: "Artifacts",
  job: "Jobs",
};

interface Command {
  id: string;
  label: string;
  hint: string;
  icon: typeof Home;
  run: () => void;
}

export function CommandPalette() {
  const open = useUIStore((s) => s.paletteOpen);
  const setOpen = useUIStore((s) => s.setPaletteOpen);
  const environment = useUIStore((s) => s.environment);
  const router = useRouter();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const commands: Command[] = useMemo(
    () => [
      { id: "nav-overview", label: "Mở Overview", hint: "trang", icon: Home, run: () => router.push("/") },
      { id: "nav-arch", label: "Mở Architecture", hint: "trang", icon: LayoutDashboard, run: () => router.push("/architecture") },
      { id: "nav-audit", label: "Mở Audit Center", hint: "trang", icon: ScanSearch, run: () => router.push("/audit") },
      { id: "nav-parity", label: "Mở Parity Center", hint: "trang", icon: ListChecks, run: () => router.push("/parity") },
      { id: "nav-obs", label: "Mở Observability", hint: "trang", icon: Radar, run: () => router.push("/observability") },
      { id: "nav-knowledge", label: "Mở Knowledge", hint: "trang", icon: BookOpenText, run: () => router.push("/knowledge") },
      { id: "nav-settings", label: "Mở Settings", hint: "trang", icon: Settings, run: () => router.push("/settings") },
      {
        id: "run-audit",
        label: `Run audit (${environment})`,
        hint: "lệnh",
        icon: Play,
        run: () => {
          router.push("/audit");
        },
      },
    ],
    [router, environment],
  );

  const search = useQuery({
    queryKey: ["search", q],
    queryFn: () => api.search(q),
    enabled: open && q.trim().length >= 2,
    staleTime: 4000,
  });

  const filteredCommands = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => c.label.toLowerCase().includes(needle));
  }, [q, commands]);

  const results = search.data ?? [];
  const total = q.trim().length >= 2 ? results.length : filteredCommands.length;

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  useEffect(() => setCursor(0), [q]);

  function pickResult(r: SearchResult) {
    if (r.group === "artifact") {
      const id = Number(r.id);
      if (!Number.isNaN(id)) useUIStore.getState().setSelectedArtifact(id);
      router.push("/knowledge");
    } else {
      router.push(r.href);
    }
    setOpen(false);
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(total - 1, c + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (q.trim().length >= 2) {
        const r = results[cursor];
        if (r) pickResult(r);
      } else {
        const c = filteredCommands[cursor];
        if (c) {
          c.run();
          setOpen(false);
        }
      }
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-start justify-center bg-void/70 pt-[14vh] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="glass hud-corner w-full max-w-xl overflow-hidden rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-line/60 px-4 py-3">
              <Search className="size-4 text-cyan" />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={onKey}
                placeholder="Tìm component, audit, finding, artifact… hoặc gõ lệnh"
                className="flex-1 bg-transparent font-mono text-[13px] text-ink placeholder:text-mute/60 focus:outline-none"
              />
              <kbd className="rounded border border-ink/15 bg-ink/5 px-1.5 py-0.5 font-mono text-[9px] text-mute">ESC</kbd>
            </div>

            <div className="max-h-80 overflow-y-auto p-1.5">
              {q.trim().length < 2 ? (
                <>
                  <div className="px-2.5 pt-1.5 pb-1 font-mono text-[9px] tracking-[0.2em] text-mute uppercase">Lệnh nhanh</div>
                  {filteredCommands.map((c, i) => (
                    <button
                      key={c.id}
                      onClick={() => {
                        c.run();
                        setOpen(false);
                      }}
                      onMouseEnter={() => setCursor(i)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                        cursor === i ? "bg-cyan/12 text-ink" : "text-mute",
                      )}
                    >
                      <c.icon className={cn("size-4", cursor === i ? "text-cyan" : "text-mute")} />
                      <span className="text-[12.5px]">{c.label}</span>
                      <span className="ml-auto font-mono text-[9px] tracking-widest uppercase opacity-60">{c.hint}</span>
                    </button>
                  ))}
                </>
              ) : search.isLoading ? (
                <div className="px-3 py-6 text-center font-mono text-[11px] text-mute">Đang tìm…</div>
              ) : results.length === 0 ? (
                <div className="px-3 py-6 text-center font-mono text-[11px] text-mute">Không có kết quả cho “{q}”.</div>
              ) : (
                <>
                  {(["component", "audit", "finding", "artifact", "job"] as const).map((g) => {
                    const group = results.filter((r) => r.group === g);
                    if (!group.length) return null;
                    return (
                      <div key={g}>
                        <div className="px-2.5 pt-2 pb-1 font-mono text-[9px] tracking-[0.2em] text-mute uppercase">
                          {GROUP_LABELS[g]}
                        </div>
                        {group.map((r) => {
                          const globalIdx = results.indexOf(r);
                          const Icon = GROUP_ICONS[r.group];
                          return (
                            <button
                              key={`${r.group}-${r.id}`}
                              onClick={() => pickResult(r)}
                              onMouseEnter={() => setCursor(globalIdx)}
                              className={cn(
                                "flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors",
                                cursor === globalIdx ? "bg-cyan/12 text-ink" : "text-mute",
                              )}
                            >
                              <Icon className={cn("size-4 shrink-0", cursor === globalIdx ? "text-cyan" : "text-mute")} />
                              <div className="min-w-0 flex-1">
                                <div className="truncate text-[12.5px]">{r.title}</div>
                                <div className="truncate font-mono text-[9.5px] opacity-70">{r.subtitle}</div>
                              </div>
                              {cursor === globalIdx && <CornerDownLeft className="size-3.5 text-cyan" />}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })}
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
